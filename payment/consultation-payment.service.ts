import { Op } from "sequelize";
import { randomUUID } from "crypto";
import { ConsultationPaymentOrder } from "../database/ConsultationPaymentOrder";
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
    order: [["createdAt", "DESC"]],
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
