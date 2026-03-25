import { WFP, WFP_CONFIG } from "overshom-wayforpay";
import paymentConfig from "./payment.config";
import type { CreateInvoiceInput, CreateInvoiceResult } from "./payment.types";

WFP_CONFIG.DEFAULT_PAYMENT_CURRENCY = paymentConfig.currency;

const wfp = new WFP({
  MERCHANT_ACCOUNT: paymentConfig.merchantAccount,
  MERCHANT_SECRET_KEY: paymentConfig.merchantSecret,
  MERCHANT_DOMAIN_NAME: paymentConfig.merchantDomainName,
  SERVICE_URL: paymentConfig.serviceUrl,
});

const createInvoice = async (input: CreateInvoiceInput): Promise<CreateInvoiceResult> => {
  const session = await wfp.createInvoiceUrl({
    orderReference: input.orderReference,
    productName: [`${input.courseName},${input.chatId}`], // keep current metadata flow
    productCount: [1],
    productPrice: [input.price],
  });

  const invoiceUrl = session?.value?.invoiceUrl;
  if (!invoiceUrl) {
    throw new Error("[wayforpay] Invoice URL was not returned");
  }

  return { invoiceUrl };
};

export { wfp, createInvoice };