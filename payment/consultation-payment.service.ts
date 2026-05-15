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
  createForumTopicIdempotent,
  sendMessageInTopic,
} from "../telegram/consultation/forum-api";
import { ConsultationCaseStatus } from "../telegram/consultation/consultation-case-status";
import { buildConsultationTopicTitle } from "../telegram/consultation/topic-title";
import { consultationDebug } from "../telegram/consultation/debug-log";

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];
const TERMINAL_FAILURE = new Set(["Declined", "Voided", "Refunded", "Expired"]);
const PENDING_OR_SUSPENDED = new Set([
  "Pending",
  "InProcessing",
  "WaitingAuthComplete",
  "Suspended",
]);
const TOPIC_RETRY_DELAYS_MS = [2 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000] as const;
const scheduledTopicRetries = new Set<string>();

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

type ReconcileCaseMappingsResult = {
  scanned: number;
  issues: number;
  fixed: number;
  rows: Array<{
    consultationId: string;
    telegramUserId: string;
    orderReference: string | null;
    hasManagerChatId: boolean;
    hasMessageThreadId: boolean;
    reason: string;
    fixed: boolean;
  }>;
};

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
    await ensurePaidCaseTopicMapping(order);
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

async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      },
    );
    if (!res.ok) {
      console.error("[consultation-payment] sendTelegramMessage failed", {
        chatId,
        status: res.status,
        body: await res.text(),
      });
    }
  } catch (error) {
    console.error("[consultation-payment] sendTelegramMessage exception", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function reconcileConsultationCaseMappings(input?: {
  fix?: boolean;
}): Promise<ReconcileCaseMappingsResult> {
  const fix = input?.fix === true;
  const rows: ReconcileCaseMappingsResult["rows"] = [];
  let fixed = 0;
  const cases = await ConsultationCase.findAll({
    order: literal("\"updated_at\" DESC"),
  });

  for (const c of cases) {
    const hasManagerChatId = Boolean(c.managerChatId && c.managerChatId.trim());
    const hasMessageThreadId = Boolean(c.messageThreadId && c.messageThreadId.trim());
    if (hasManagerChatId && hasMessageThreadId) {
      continue;
    }

    const baseRow = {
      consultationId: c.consultationId,
      telegramUserId: c.telegramUserId,
      orderReference: c.orderReference,
      hasManagerChatId,
      hasMessageThreadId,
      reason: "incomplete_mapping",
      fixed: false,
    };

    if (!fix) {
      rows.push(baseRow);
      continue;
    }

    let sourceOrder = c.orderReference
      ? await ConsultationPaymentOrder.findOne({
          where: {
            orderReference: c.orderReference,
            status: "approved",
          },
        })
      : null;

    if (!sourceOrder) {
      sourceOrder = await ConsultationPaymentOrder.findOne({
        where: {
          telegramUserId: c.telegramUserId,
          status: "approved",
        },
        order: literal("\"created_at\" DESC"),
      });
    }

    if (sourceOrder && isConsultationProductCode(sourceOrder.productCode)) {
      await ensurePaidCaseTopicMapping(sourceOrder);

      const mapped = await ConsultationCase.findOne({
        where: {
          telegramUserId: c.telegramUserId,
          managerChatId: { [Op.ne]: null },
          messageThreadId: { [Op.ne]: null },
        },
        order: literal("\"updated_at\" DESC"),
      });

      if (mapped?.managerChatId && mapped?.messageThreadId) {
        await c.update({
          managerChatId: mapped.managerChatId,
          messageThreadId: mapped.messageThreadId,
          orderReference: c.orderReference ?? sourceOrder.orderReference,
          productCode: c.productCode ?? sourceOrder.productCode,
          status: "ACTIVE_CONVERSATION",
        });
        fixed += 1;
        rows.push({
          ...baseRow,
          reason: "fixed_from_approved_order",
          fixed: true,
        });
        consultationDebug("topic.reconcile.fixed", {
          consultationId: c.consultationId,
          telegramUserId: c.telegramUserId,
          managerChatId: mapped.managerChatId,
          messageThreadId: mapped.messageThreadId,
          source: "reconcile_case_mappings",
        });
        continue;
      }
    }

    rows.push({
      ...baseRow,
      reason: "no_fix_source",
      fixed: false,
    });
  }

  return {
    scanned: cases.length,
    issues: rows.length,
    fixed,
    rows,
  };
}

async function ensurePaidCaseTopicMapping(
  order: ConsultationPaymentOrder,
): Promise<void> {
  const consultationId = `${
    order.productCode === CONSULTATION_MASTER_PRODUCT_CODE ? "master" : "client"
  }-${order.orderReference}`;

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

  const existingMappedByOrder = await ConsultationCase.findOne({
    where: {
      orderReference: order.orderReference,
      managerChatId: { [Op.ne]: null },
      messageThreadId: { [Op.ne]: null },
    },
  });
  if (existingMappedByOrder) {
    return;
  }

  const mappedCaseForUser = await ConsultationCase.findOne({
    where: {
      telegramUserId: order.telegramUserId,
      productCode: order.productCode,
      managerChatId: { [Op.ne]: null },
      messageThreadId: { [Op.ne]: null },
    },
    order: literal("\"updated_at\" DESC"),
  });
  if (mappedCaseForUser) {
    const hasDisplayName = Boolean(mappedCaseForUser.displayName?.trim());
    const reusedStatus = !hasDisplayName
      ? ConsultationCaseStatus.AWAITING_DISPLAY_NAME
      : order.productCode === CONSULTATION_MASTER_PRODUCT_CODE
        ? ConsultationCaseStatus.ACTIVE_CONVERSATION
        : ConsultationCaseStatus.AWAITING_INTAKE;
    await ConsultationCase.upsert({
      consultationId: mappedCaseForUser.consultationId,
      telegramUserId: mappedCaseForUser.telegramUserId,
      telegramChatId: order.telegramChatId,
      status: reusedStatus,
      productCode: order.productCode,
      orderReference: order.orderReference,
      managerChatId: mappedCaseForUser.managerChatId,
      messageThreadId: mappedCaseForUser.messageThreadId,
      displayName: mappedCaseForUser.displayName,
    });
    consultationDebug("topic.reconcile.fixed", {
      orderReference: order.orderReference,
      consultationId: mappedCaseForUser.consultationId,
      telegramUserId: order.telegramUserId,
      managerChatId: mappedCaseForUser.managerChatId,
      messageThreadId: mappedCaseForUser.messageThreadId,
      source: "ensure_paid_case_topic_mapping",
    });
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
  consultationDebug("topic.create.start", {
    consultationId,
    orderReference: order.orderReference,
    telegramUserId: order.telegramUserId,
    managerChatId,
    topicName,
    source: "ensure_paid_case_topic_mapping",
  });

  const userIdentity =
    user?.firstName || user?.lastName
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
      : user?.username
        ? `@${user.username}`
        : `tg_${order.telegramUserId}`;

  const finalizeTopicMapping = async (messageThreadId: number): Promise<void> => {
    await sendMessageInTopic(
      token,
      managerChatId,
      messageThreadId,
      [
        order.productCode === CONSULTATION_MASTER_PRODUCT_CODE
          ? "🎓 Нова консультація для майстра"
          : "👤 Нова персональна консультація",
        `Order: ${order.orderReference}`,
        `User ID: ${order.telegramUserId}`,
        `Identity: ${userIdentity}`,
        `Chat ID: ${order.telegramChatId}`,
        order.productCode === CONSULTATION_MASTER_PRODUCT_CODE
          ? "Старт: прямий формат через форум (без intake-анкети)."
          : "Очікуємо імʼя клієнта та заповнення intake-анкети.",
      ].join("\n"),
    );

    await ConsultationCase.upsert({
      consultationId,
      telegramUserId: order.telegramUserId,
      telegramChatId: order.telegramChatId,
      status: ConsultationCaseStatus.AWAITING_DISPLAY_NAME,
      productCode: order.productCode,
      orderReference: order.orderReference,
      managerChatId: String(managerChatId),
      messageThreadId: String(messageThreadId),
    });
    console.log("[consultation-payment] created topic mapping for paid order", {
      orderReference: order.orderReference,
      consultationId,
      managerChatId,
      messageThreadId,
      productCode: order.productCode,
    });
  };

  const scheduleTopicCreationRetries = (initialError: unknown): void => {
    const retryKey = `${managerChatId}:${consultationId}`;
    if (scheduledTopicRetries.has(retryKey)) {
      return;
    }
    scheduledTopicRetries.add(retryKey);
    consultationDebug("topic.create.error", {
      consultationId,
      orderReference: order.orderReference,
      telegramUserId: order.telegramUserId,
      managerChatId,
      topicName,
      source: "ensure_paid_case_topic_mapping_retry_schedule",
      error: initialError instanceof Error ? initialError.message : String(initialError),
    });

    TOPIC_RETRY_DELAYS_MS.forEach((delayMs, index) => {
      const retryNo = index + 1;
      setTimeout(() => {
        void (async () => {
          await sendTelegramMessage(
            token,
            order.telegramChatId,
            `Виникла технічна затримка зі створенням теми консультації. Повторна спроба #${retryNo} зараз виконується.`,
          );

          consultationDebug("topic.create.start", {
            consultationId,
            orderReference: order.orderReference,
            telegramUserId: order.telegramUserId,
            managerChatId,
            topicName,
            source: "ensure_paid_case_topic_mapping_retry",
            retryNo,
            delayMs,
          });

          try {
            const result = await createForumTopicIdempotent({
              token,
              chatId: managerChatId,
              name: topicName,
              consultationId,
              findExistingThreadId: async () => {
                const existingByConsultationId = await ConsultationCase.findOne({
                  where: {
                    consultationId,
                    managerChatId: String(managerChatId),
                    messageThreadId: { [Op.ne]: null },
                  },
                });
                if (!existingByConsultationId?.messageThreadId) {
                  return null;
                }
                return Number(existingByConsultationId.messageThreadId);
              },
            });
            await finalizeTopicMapping(result.message_thread_id);
            consultationDebug("topic.create.success", {
              consultationId,
              orderReference: order.orderReference,
              telegramUserId: order.telegramUserId,
              managerChatId,
              messageThreadId: result.message_thread_id,
              topicName,
              source: "ensure_paid_case_topic_mapping_retry",
              retryNo,
            });
            scheduledTopicRetries.delete(retryKey);
          } catch (error) {
            consultationDebug("topic.create.error", {
              consultationId,
              orderReference: order.orderReference,
              telegramUserId: order.telegramUserId,
              managerChatId,
              topicName,
              source: "ensure_paid_case_topic_mapping_retry",
              retryNo,
              error: error instanceof Error ? error.message : String(error),
            });

            const isLast = retryNo === TOPIC_RETRY_DELAYS_MS.length;
            if (isLast) {
              await sendTelegramMessage(
                token,
                order.telegramChatId,
                "Не вдалося автоматично створити тему консультації після кількох спроб. Адміністратор вже повідомлений і зв'яжеться з вами.",
              );
              await sendTelegramMessage(
                token,
                managerChatId,
                [
                  "⚠️ Помилка створення теми консультації після 3 спроб",
                  `Consultation ID: ${consultationId}`,
                  `Order: ${order.orderReference}`,
                  `User ID: ${order.telegramUserId}`,
                  `Chat ID: ${order.telegramChatId}`,
                  `Topic name: ${topicName}`,
                  `Error: ${error instanceof Error ? error.message : String(error)}`,
                ].join("\n"),
              );
              scheduledTopicRetries.delete(retryKey);
            }
          }
        })();
      }, delayMs);
    });
  };

  let message_thread_id: number;
  try {
    const result = await createForumTopicIdempotent({
      token,
      chatId: managerChatId,
      name: topicName,
      consultationId,
      findExistingThreadId: async () => {
        const existingByConsultationId = await ConsultationCase.findOne({
          where: {
            consultationId,
            managerChatId: String(managerChatId),
            messageThreadId: { [Op.ne]: null },
          },
        });
        if (!existingByConsultationId?.messageThreadId) {
          return null;
        }
        return Number(existingByConsultationId.messageThreadId);
      },
    });
    message_thread_id = result.message_thread_id;
    consultationDebug("topic.create.success", {
      consultationId,
      orderReference: order.orderReference,
      telegramUserId: order.telegramUserId,
      managerChatId,
      messageThreadId: message_thread_id,
      topicName,
      source: "ensure_paid_case_topic_mapping",
    });
  } catch (err) {
    scheduleTopicCreationRetries(err);
    return;
  }
  await finalizeTopicMapping(message_thread_id);
}
