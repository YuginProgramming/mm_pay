import { randomUUID } from "crypto";
import { Op } from "sequelize";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { createInvoice } from "./client";
import { isConsultationProductCode } from "./consultation-product";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import { peekPendingOrder, putPendingOrder, takePendingOrder } from "./pending-orders";
import type {
  CreateInvoiceResult,
  PaymentMetadata,
  WayForPayAckResponse,
  WayForPayWebhookPayload,
} from "./payment.types";
import { buildAckSignature, verifyWebhookSignature } from "./signature";
import {
  parentWayforpayOrderReference,
  wayforpayOrderReferenceLookupKeys,
} from "./wayforpay-order-reference";

const parseMetadataFromProductName = (name: string): PaymentMetadata => {
  const [courseNameRaw, chatIdRaw] = String(name ?? "").split(",");

  const courseName = (courseNameRaw ?? "").trim();
  const chatId = (chatIdRaw ?? "").trim();

  if (!courseName || !chatId) {
    throw new Error("[payment] Invalid metadata in product name");
  }

  return {
    courseName,
    chatId,
    flowType: isConsultationProductCode(courseName)
      ? "consultation_one_time"
      : "legacy_course",
    productCode: isConsultationProductCode(courseName) ? courseName : undefined,
  };
};

const createCheckoutForCourse = async (
  price: number,
  courseName: string,
  chatId: string
): Promise<CreateInvoiceResult> => {
  const orderReference = randomUUID();
  await putPendingOrder(orderReference, { chatId, courseName });

  try {
    const invoice = await createInvoice({
      orderReference,
      courseName,
      chatId,
      price,
    });
    return { orderReference, invoiceUrl: invoice.invoiceUrl };
  } catch (err) {
    await takePendingOrder(orderReference);
    throw err;
  }
};

function metadataFromChatId(chatId: string): PaymentMetadata {
  return {
    courseName: MULTIMASKING_PRODUCT_NAME,
    chatId,
    flowType: "legacy_course",
  };
}

async function resolveWebhookMetadataFromLedger(
  orderReference: string,
): Promise<PaymentMetadata | null> {
  const parent = parentWayforpayOrderReference(orderReference);
  const order = await SubscriptionPaymentOrder.findOne({
    where: { orderReference: parent },
    attributes: ["userId"],
  });
  if (order?.userId?.trim()) {
    return metadataFromChatId(order.userId.trim());
  }

  const auto = await SubscriptionAuto.findOne({
    where: {
      [Op.or]: [
        { anchorOrderReference: parent },
        { latestOrderReference: parent },
      ],
    },
    attributes: ["userId"],
  });
  if (auto?.userId?.trim()) {
    return metadataFromChatId(auto.userId.trim());
  }

  return null;
}

/**
 * Invoice serviceUrl callbacks often omit `products[]`; then pending row, then ledger.
 * Recurring `*_WFPREG-*` webhooks have neither products nor pending — resolve via parent UUID.
 */
const resolveWebhookMetadata = async (
  data: WayForPayWebhookPayload,
): Promise<PaymentMetadata | null> => {
  const name = data.products?.[0]?.name;
  if (name) {
    try {
      return parseMetadataFromProductName(name);
    } catch {
      return null;
    }
  }

  for (const ref of wayforpayOrderReferenceLookupKeys(data.orderReference)) {
    const pending = await peekPendingOrder(ref);
    if (pending) {
      return { courseName: pending.courseName, chatId: pending.chatId };
    }
  }

  return resolveWebhookMetadataFromLedger(data.orderReference);
};

const TERMINAL_FAILURE = new Set(["Declined", "Voided", "Refunded", "Expired"]);
const PENDING_OR_SUSPENDED = new Set([
  "Pending",
  "InProcessing",
  "WaitingAuthComplete",
  "Suspended",
]);

const isTerminalPaymentFailure = (payload: WayForPayWebhookPayload): boolean => {
  return TERMINAL_FAILURE.has(String(payload.transactionStatus));
};

const releasePendingIfTerminal = async (
  payload: WayForPayWebhookPayload,
): Promise<void> => {
  const status = String(payload.transactionStatus);
  if (status === "Approved" || TERMINAL_FAILURE.has(status)) {
    for (const ref of wayforpayOrderReferenceLookupKeys(payload.orderReference)) {
      await takePendingOrder(ref);
    }
  }
};

const isApprovedPayment = (payload: WayForPayWebhookPayload): boolean => {
  return payload.transactionStatus === "Approved";
};

const isPendingOrSuspendedPayment = (payload: WayForPayWebhookPayload): boolean => {
  return PENDING_OR_SUSPENDED.has(String(payload.transactionStatus));
};

const verifyIncomingWebhook = (payload: WayForPayWebhookPayload): boolean => {
  return verifyWebhookSignature({
    merchantAccount: payload.merchantAccount,
    orderReference: payload.orderReference,
    amount: payload.amount,
    currency: payload.currency,
    authCode: payload.authCode,
    cardPan: payload.cardPan,
    transactionStatus: payload.transactionStatus,
    reasonCode: payload.reasonCode,
    merchantSignature: payload.merchantSignature,
  });
};

const buildAcceptAck = (orderReference: string): WayForPayAckResponse => {
  const time = Date.now();
  const status: WayForPayAckResponse["status"] = "accept";

  return {
    orderReference,
    status,
    time,
    signature: buildAckSignature({ orderReference, status, time }),
  };
};

const buildDeclineAck = (orderReference: string): WayForPayAckResponse => {
  const time = Date.now();
  const status: WayForPayAckResponse["status"] = "decline";

  return {
    orderReference,
    status,
    time,
    signature: buildAckSignature({ orderReference, status, time }),
  };
};

export {
  parseMetadataFromProductName,
  createCheckoutForCourse,
  isApprovedPayment,
  isTerminalPaymentFailure,
  verifyIncomingWebhook,
  buildAcceptAck,
  buildDeclineAck,
  resolveWebhookMetadata,
  releasePendingIfTerminal,
  isPendingOrSuspendedPayment,
};