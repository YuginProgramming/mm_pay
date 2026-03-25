import crypto from "crypto";
import paymentConfig from "./payment.config";

type VerifyWebhookSignatureInput = {
  merchantAccount: string;
  orderReference: string;
  amount: number | string;
  currency: string;
  authCode: string;
  cardPan: string;
  transactionStatus: string;
  reasonCode: number | string;
  merchantSignature: string;
};

type AckSignatureInput = {
  orderReference: string;
  status: "accept" | "decline";
  time: number;
};

const toHashString = (parts: Array<string | number>): string => {
  return parts.map((part) => String(part)).join(";");
};

const makeMd5Hmac = (value: string): string => {
  return crypto
    .createHmac("md5", paymentConfig.merchantSecret)
    .update(value)
    .digest("hex");
};

const buildExpectedWebhookSignature = (
  input: Omit<VerifyWebhookSignatureInput, "merchantSignature">
): string => {
  const forHash = toHashString([
    input.merchantAccount,
    input.orderReference,
    input.amount,
    input.currency,
    input.authCode,
    input.cardPan,
    input.transactionStatus,
    input.reasonCode,
  ]);

  return makeMd5Hmac(forHash);
};

const verifyWebhookSignature = (input: VerifyWebhookSignatureInput): boolean => {
  const expected = buildExpectedWebhookSignature({
    merchantAccount: input.merchantAccount,
    orderReference: input.orderReference,
    amount: input.amount,
    currency: input.currency,
    authCode: input.authCode,
    cardPan: input.cardPan,
    transactionStatus: input.transactionStatus,
    reasonCode: input.reasonCode,
  });

  return expected === input.merchantSignature;
};

const buildAckSignature = (input: AckSignatureInput): string => {
  const forHash = toHashString([input.orderReference, input.status, input.time]);
  return makeMd5Hmac(forHash);
};

export type { VerifyWebhookSignatureInput, AckSignatureInput };
export {
  buildExpectedWebhookSignature,
  verifyWebhookSignature,
  buildAckSignature,
};