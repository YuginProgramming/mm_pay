import crypto from "crypto";
import paymentConfig from "./payment.config";

const WAYFORPAY_API_URL = "https://api.wayforpay.com/api";
const WFP_INVOICE_SUCCESS_REASON_CODE = 1100;

export type WayforpayRegularInvoiceOptions = {
  regularMode: string;
  regularAmount: number;
  /** First recurring debit date, DD.MM.YYYY (must be > today per WayForPay). */
  dateNext: string;
  regularBehavior?: "preset";
  regularOn?: 1;
};

export type CreateWayforpayInvoiceWithRegularInput = {
  orderReference: string;
  courseName: string;
  chatId: string;
  price: number;
  regular: WayforpayRegularInvoiceOptions;
};

function buildCreateInvoiceSignature(args: {
  merchantAccount: string;
  merchantDomainName: string;
  orderReference: string;
  orderDate: number;
  amount: number;
  currency: string;
  productName: string[];
  productCount: number[];
  productPrice: number[];
  merchantSecret: string;
}): string {
  const forHash = [
    args.merchantAccount,
    args.merchantDomainName,
    args.orderReference,
    args.orderDate,
    args.amount,
    args.currency,
    args.productName.join(";"),
    args.productCount.join(";"),
    args.productPrice.join(";"),
  ].join(";");
  return crypto.createHmac("md5", args.merchantSecret).update(forHash).digest("hex");
}

/** UTC calendar date + `daysFromNow` as DD.MM.YYYY (WayForPay `dateNext`). */
export function formatWayforpayDateNextUtc(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * CREATE_INVOICE with regular-payment fields (not exposed by overshom-wayforpay).
 * If WayForPay rejects unknown fields, fall back to Purchase flow in a follow-up.
 */
export async function createWayforpayInvoiceWithRegular(
  input: CreateWayforpayInvoiceWithRegularInput,
): Promise<{ invoiceUrl: string }> {
  const productName = [`${input.courseName},${input.chatId}`];
  const productCount = [1];
  const productPrice = [input.price];
  const amount = input.price;
  const orderDate = Date.now();
  const currency = paymentConfig.currency;

  const merchantSignature = buildCreateInvoiceSignature({
    merchantAccount: paymentConfig.merchantAccount,
    merchantDomainName: paymentConfig.merchantDomainName,
    orderReference: input.orderReference,
    orderDate,
    amount,
    currency,
    productName,
    productCount,
    productPrice,
    merchantSecret: paymentConfig.merchantSecret,
  });

  const body: Record<string, unknown> = {
    transactionType: "CREATE_INVOICE",
    merchantAccount: paymentConfig.merchantAccount,
    merchantAuthType: "SimpleSignature",
    merchantDomainName: paymentConfig.merchantDomainName,
    merchantSignature,
    apiVersion: 1,
    serviceUrl: paymentConfig.serviceUrl,
    orderReference: input.orderReference,
    orderDate,
    amount,
    currency,
    productName,
    productCount,
    productPrice,
    regularMode: input.regular.regularMode,
    regularAmount: input.regular.regularAmount,
    regularBehavior: input.regular.regularBehavior ?? "preset",
    regularOn: input.regular.regularOn ?? 1,
    dateNext: input.regular.dateNext,
  };

  const res = await fetch(WAYFORPAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[wayforpay] CREATE_INVOICE invalid JSON (HTTP ${res.status}): ${rawText.slice(0, 500)}`,
    );
  }

  const reasonCode = Number(data.reasonCode);
  if (reasonCode !== WFP_INVOICE_SUCCESS_REASON_CODE) {
    throw new Error(
      `[wayforpay] CREATE_INVOICE failed: ${JSON.stringify({
        reasonCode: data.reasonCode,
        reason: data.reason,
      })}`,
    );
  }

  const invoiceUrl = data.invoiceUrl;
  if (typeof invoiceUrl !== "string" || !invoiceUrl.trim()) {
    throw new Error(
      `[wayforpay] CREATE_INVOICE missing invoiceUrl: ${JSON.stringify(data)}`,
    );
  }

  return { invoiceUrl: invoiceUrl.trim() };
}
