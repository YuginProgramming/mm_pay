import { randomUUID } from "crypto";
import { createInvoice } from "./client";
import { peekPendingOrder, putPendingOrder, takePendingOrder } from "./pending-orders";
import { buildAckSignature, verifyWebhookSignature } from "./signature";
import type {
  CreateInvoiceResult,
  PaymentMetadata,
  WayForPayAckResponse,
  WayForPayWebhookPayload,
} from "./payment.types";

const parseMetadataFromProductName = (name: string): PaymentMetadata => {
  const [courseNameRaw, chatIdRaw] = String(name ?? "").split(",");

  const courseName = (courseNameRaw ?? "").trim();
  const chatId = (chatIdRaw ?? "").trim();

  if (!courseName || !chatId) {
    throw new Error("[payment] Invalid metadata in product name");
  }

  return { courseName, chatId };
};

const createCheckoutForCourse = async (
  price: number,
  courseName: string,
  chatId: string
): Promise<CreateInvoiceResult> => {
  const orderReference = randomUUID();
  putPendingOrder(orderReference, { chatId, courseName });

  try {
    return await createInvoice({
      orderReference,
      courseName,
      chatId,
      price,
    });
  } catch (err) {
    takePendingOrder(orderReference);
    throw err;
  }
};

/** Invoice serviceUrl callbacks often omit `products[]`; then we use pending order by orderReference. */
const resolveWebhookMetadata = (
  data: WayForPayWebhookPayload
): { courseName: string; chatId: string } | null => {
  const name = data.products?.[0]?.name;
  if (name) {
    try {
      return parseMetadataFromProductName(name);
    } catch {
      return null;
    }
  }
  const pending = peekPendingOrder(data.orderReference);
  if (pending) {
    return { courseName: pending.courseName, chatId: pending.chatId };
  }
  return null;
};

const TERMINAL_FAILURE = new Set(["Declined", "Voided", "Refunded", "Expired"]);

const releasePendingIfTerminal = (payload: WayForPayWebhookPayload): void => {
  const status = String(payload.transactionStatus);
  if (status === "Approved" || TERMINAL_FAILURE.has(status)) {
    takePendingOrder(payload.orderReference);
  }
};

const isApprovedPayment = (payload: WayForPayWebhookPayload): boolean => {
  return payload.transactionStatus === "Approved";
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
  verifyIncomingWebhook,
  buildAcceptAck,
  buildDeclineAck,
  resolveWebhookMetadata,
  releasePendingIfTerminal,
};