import { Op, literal } from "sequelize";
import { randomUUID } from "crypto";
import { ConsultationCase } from "../database/ConsultationCase";
import { ConsultationPaymentOrder } from "../database/ConsultationPaymentOrder";
import { TelegramUser } from "../database/TelegramUser";
import {
  getConsultationClientPriceUah,
  getConsultationMasterPriceUah,
} from "../database/app-settings-queries";
import { createInvoice } from "./client";
import type { WayForPayWebhookPayload } from "./payment.types";
import {
  CONSULTATION_CLIENT_PRODUCT_CODE,
  CONSULTATION_MASTER_PRODUCT_CODE,
  isConsultationProductCode,
  type ConsultationProductCode,
} from "./consultation-product";
import {
  notifyConsultationPaymentApproved,
  notifyConsultationPaymentFailed,
  notifyConsultationPaymentPending,
} from "./consultation-payment-notify";
import { putPendingOrder } from "./pending-orders";
import {
  createForumTopic,
  sendMessageInTopic,
} from "../telegram/consultation/forum-api";
import { buildConsultationTopicTitle } from "../telegram/consultation/topic-title";

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];
const TERMINAL_FAILURE = new Set(["Declined", "Voided", "Refunded", "Expired"]);
const PENDING_OR_SUSPENDED = new Set([
  "Pending",
  "InProcessing",
  "WaitingAuthComplete",
  "Suspended",
]);

export async function getConsultationPriceByProduct(
  productCode: ConsultationProductCode,
): Promise<number> {
  if (productCode === CONSULTATION_MASTER_PRODUCT_CODE) {
    return getConsultationMasterPriceUah();
  }
  return getConsultationClientPriceUah();
}

export type ConsultationCheckoutResult = {
  orderReference: string;
  checkoutUrl: string;
  productCode: ConsultationProductCode;
  amountUah: number;
};

export type ConsultationAccessState =
  | { status: "approved" }
  | { status: "pending_with_url"; checkoutUrl: string }
  | { status: "no_access" };

export async function getConsultationAccessState(input: {
  telegramUserId: string;
  productCode: ConsultationProductCode;
}): Promise<ConsultationAccessState> {
  const latest = await ConsultationPaymentOrder.findOne({
    where: {
      telegramUserId: input.telegramUserId,
      productCode: input.productCode,
    },
    order: literal("\"created_at\" DESC"),
  });
  if (!latest) return { status: "no_access" };
  if (latest.status === "approved") return { status: "approved" };
  if (
    ["created", "pending", "processing", "suspended"].includes(latest.status) &&
    latest.checkoutUrl
  ) {
    return { status: "pending_with_url", checkoutUrl: latest.checkoutUrl };
  }
  return { status: "no_access" };
}

export async function createConsultationCheckout(input: {
  telegramUserId: string;
  telegramChatId: string;
  productCode: ConsultationProductCode;
  forceNew?: boolean;
}): Promise<ConsultationCheckoutResult> {
  const existing = await ConsultationPaymentOrder.findOne({
    where: {
      telegramUserId: input.telegramUserId,
      productCode: input.productCode,
      status: { [Op.in]: ACTIVE_ORDER_STATUSES },
    },
    order: literal("\"created_at\" DESC"),
  });

  if (existing && !input.forceNew && existing.checkoutUrl) {
    return {
      orderReference: existing.orderReference,
      checkoutUrl: existing.checkoutUrl,
      productCode: input.productCode,
      amountUah: Number(existing.amount),
    };
  }

  if (existing && input.forceNew) {
    await ConsultationPaymentOrder.update(
      { status: "replaced", terminalAt: new Date() },
      {
        where: {
          telegramUserId: input.telegramUserId,
          productCode: input.productCode,
          status: { [Op.in]: ACTIVE_ORDER_STATUSES },
        },
      },
    );
  }

  const orderReference = randomUUID();
  const amountUah = await getConsultationPriceByProduct(input.productCode);

  await ConsultationPaymentOrder.create({
    orderReference,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    productCode: input.productCode,
    status: "created",
    amount: String(amountUah),
    currency: "UAH",
    provider: "wayforpay",
    checkoutUrl: null,
    terminalAt: null,
    failureReasonCode: null,
  });

  await putPendingOrder(orderReference, {
    chatId: input.telegramChatId,
    courseName: input.productCode,
  });

  try {
    const invoice = await createInvoice({
      orderReference,
      courseName: input.productCode,
      chatId: input.telegramChatId,
      price: amountUah,
    });

    await ConsultationPaymentOrder.update(
      { checkoutUrl: invoice.invoiceUrl, status: "pending" },
      { where: { orderReference } },
    );

    return {
      orderReference,
      checkoutUrl: invoice.invoiceUrl,
      productCode: input.productCode,
      amountUah,
    };
  } catch (err) {
    await ConsultationPaymentOrder.update(
      {
        status: "failed",
        terminalAt: new Date(),
        failureReasonCode: "invoice_create_failed",
      },
      { where: { orderReference } },
    );
    throw err;
  }
}

type ReconcileResult =
  | { handled: false; reason: "order_not_found" | "not_consultation_order" }
  | { handled: true; orderReference: string; status: string };

export async function reconcileConsultationOrderFromWebhook(
  payload: WayForPayWebhookPayload,
): Promise<ReconcileResult> {
  const order = await ConsultationPaymentOrder.findOne({
    where: { orderReference: payload.orderReference },
  });
  if (!order) {
    return { handled: false, reason: "order_not_found" };
  }
  if (!isConsultationProductCode(order.productCode)) {
    return { handled: false, reason: "not_consultation_order" };
  }

  const txStatus = String(payload.transactionStatus);
  const now = new Date();

  if (txStatus === "Approved") {
    const [updated] = await ConsultationPaymentOrder.update(
      { status: "approved", terminalAt: now, failureReasonCode: null },
      {
        where: {
          orderReference: order.orderReference,
          status: { [Op.ne]: "approved" },
        },
      },
    );
    if (updated > 0) {
      if (order.productCode === CONSULTATION_MASTER_PRODUCT_CODE) {
        await startMasterForumFlow(order);
      }
      await notifyConsultationPaymentApproved({
        chatId: order.telegramChatId,
        productCode: order.productCode,
        orderReference: order.orderReference,
      });
    }
    return {
      handled: true,
      orderReference: order.orderReference,
      status: "approved",
    };
  }

  if (TERMINAL_FAILURE.has(txStatus)) {
    const [updated] = await ConsultationPaymentOrder.update(
      {
        status: "failed",
        terminalAt: now,
        failureReasonCode:
          payload.reasonCode == null ? null : String(payload.reasonCode),
      },
      {
        where: {
          orderReference: order.orderReference,
          status: { [Op.ne]: "failed" },
        },
      },
    );
    if (updated > 0) {
      await notifyConsultationPaymentFailed({
        chatId: order.telegramChatId,
        productCode: order.productCode,
        orderReference: order.orderReference,
        transactionStatus: txStatus,
      });
    }
    return {
      handled: true,
      orderReference: order.orderReference,
      status: "failed",
    };
  }

  if (PENDING_OR_SUSPENDED.has(txStatus)) {
    const [updated] = await ConsultationPaymentOrder.update(
      { status: "pending" },
      {
        where: {
          orderReference: order.orderReference,
          terminalAt: null,
        },
      },
    );
    if (updated > 0) {
      await notifyConsultationPaymentPending({
        chatId: order.telegramChatId,
        productCode: order.productCode,
        orderReference: order.orderReference,
        transactionStatus: txStatus,
      });
    }
    return {
      handled: true,
      orderReference: order.orderReference,
      status: "pending",
    };
  }

  return {
    handled: true,
    orderReference: order.orderReference,
    status: String(order.status),
  };
}

async function startMasterForumFlow(
  order: ConsultationPaymentOrder,
): Promise<void> {
  const token = process.env.CONSULTATION_BOT_TOKEN;
  const managerChatIdRaw = process.env.CONSULTATION_MANAGER_CHAT_ID;
  const managerChatId = managerChatIdRaw ? Number(managerChatIdRaw) : NaN;
  if (!token || !Number.isFinite(managerChatId)) {
    console.warn(
      "[consultation-payment] skip master forum flow: token/chat not configured",
      { hasToken: Boolean(token), managerChatIdRaw },
    );
    return;
  }

  const user = await TelegramUser.findOne({
    where: { telegramId: order.telegramUserId },
  });
  const topicName = buildConsultationTopicTitle({
    telegramId: order.telegramUserId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    username: user?.username ?? null,
  });
  const { message_thread_id } = await createForumTopic(token, managerChatId, topicName);

  const userIdentity =
    user?.firstName || user?.lastName
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
      : user?.username
        ? `@${user.username}`
        : `tg_${order.telegramUserId}`;
  await sendMessageInTopic(
    token,
    managerChatId,
    message_thread_id,
    [
      "🎓 Нова консультація для майстра",
      `Order: ${order.orderReference}`,
      `User ID: ${order.telegramUserId}`,
      `Identity: ${userIdentity}`,
      `Chat ID: ${order.telegramChatId}`,
      "Старт: прямий формат через форум (без intake-анкети).",
    ].join("\n"),
  );

  await ConsultationCase.upsert({
    consultationId: `master-${order.orderReference}`,
    telegramUserId: order.telegramUserId,
    telegramChatId: order.telegramChatId,
    status: "ACTIVE_CONVERSATION",
    productCode: order.productCode,
    orderReference: order.orderReference,
    managerChatId: String(managerChatId),
    messageThreadId: String(message_thread_id),
  });
}
