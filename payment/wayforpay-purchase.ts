import crypto from "crypto";
import paymentConfig from "./payment.config";
import {
  WayforpayPurchaseCheckout,
  type WayforpayPurchaseFormFields,
} from "../database/WayforpayPurchaseCheckout";
import { formatWayforpayDateNextUtc } from "./wayforpay-invoice";

export const WAYFORPAY_PURCHASE_URL = "https://secure.wayforpay.com/pay";

export type WayforpayPurchaseRegularOptions = {
  regularMode: string;
  regularAmount: number;
  /** DD.MM.YYYY, must be > today per WayForPay Purchase docs. */
  dateNext: string;
  regularBehavior?: "preset";
  regularOn?: 1;
  regularCount?: number;
  dateEnd?: string;
};

export type CreateWayforpayPurchaseWithRegularInput = {
  orderReference: string;
  courseName: string;
  chatId: string;
  price: number;
  regular: WayforpayPurchaseRegularOptions;
};

function buildPurchaseSignature(args: {
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
    ...args.productName,
    ...args.productCount.map(String),
    ...args.productPrice.map(String),
  ].join(";");
  return crypto.createHmac("md5", args.merchantSecret).update(forHash).digest("hex");
}

export function buildPurchaseCheckoutPageUrl(orderReference: string): string {
  const origin = new URL(paymentConfig.serviceUrl).origin;
  return `${origin}/wayforpay/purchase/${encodeURIComponent(orderReference)}`;
}

/**
 * WayForPay Purchase (POST secure.wayforpay.com/pay) з regular-полями.
 * Зберігає поля форми в БД; checkoutUrl — наша сторінка auto-submit.
 */
export async function createWayforpayPurchaseWithRegular(
  input: CreateWayforpayPurchaseWithRegularInput,
): Promise<{ checkoutUrl: string }> {
  const productName = [`${input.courseName},${input.chatId}`];
  const productCount = ["1"];
  const productPrice = [String(input.price)];
  const amount = input.price;
  const orderDate = Math.floor(Date.now() / 1000);
  const currency = paymentConfig.currency;

  const merchantSignature = buildPurchaseSignature({
    merchantAccount: paymentConfig.merchantAccount,
    merchantDomainName: paymentConfig.merchantDomainName,
    orderReference: input.orderReference,
    orderDate,
    amount,
    currency,
    productName,
    productCount: [1],
    productPrice: [input.price],
    merchantSecret: paymentConfig.merchantSecret,
  });

  const scalars: Record<string, string | number> = {
    merchantAccount: paymentConfig.merchantAccount,
    merchantAuthType: "SimpleSignature",
    merchantDomainName: paymentConfig.merchantDomainName,
    merchantTransactionType: "AUTO",
    merchantTransactionSecureType: "AUTO",
    merchantSignature,
    apiVersion: 1,
    serviceUrl: paymentConfig.serviceUrl,
    orderReference: input.orderReference,
    orderDate,
    amount,
    currency,
    regularMode: input.regular.regularMode,
    regularAmount: input.regular.regularAmount,
    regularBehavior: input.regular.regularBehavior ?? "preset",
    regularOn: input.regular.regularOn ?? 1,
    dateNext: input.regular.dateNext,
  };

  if (input.regular.regularCount != null && input.regular.regularCount > 0) {
    scalars.regularCount = input.regular.regularCount;
  }
  if (input.regular.dateEnd?.trim()) {
    scalars.dateEnd = input.regular.dateEnd.trim();
  }

  const formFields: WayforpayPurchaseFormFields = {
    scalars,
    arrays: {
      productName,
      productCount,
      productPrice,
    },
  };

  await WayforpayPurchaseCheckout.create({
    orderReference: input.orderReference,
    formFields,
  });

  return { checkoutUrl: buildPurchaseCheckoutPageUrl(input.orderReference) };
}

export { formatWayforpayDateNextUtc };
