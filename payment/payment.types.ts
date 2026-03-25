export type PaymentStatus =
  | "Approved"
  | "Declined"
  | "Pending"
  | "Expired"
  | "Refunded"
  | string;

export type ProductLine = {
  name: string;
  price: number;
  count: number;
};

export type WayForPayWebhookPayload = {
  merchantAccount: string;
  merchantSignature: string;
  orderReference: string;
  /** Callback may send amount as string (docs example). */
  amount: number | string;
  currency: string;
  authCode: string;
  cardPan: string;
  transactionStatus: PaymentStatus;
  reasonCode: number | string;
  /** Invoice payment notifications often omit this; use pending order map instead. */
  products?: ProductLine[];
};

export type PaymentMetadata = {
  courseName: string;
  chatId: string;
};

export type WayForPayAckResponse = {
  orderReference: string;
  status: "accept" | "decline";
  time: number;
  signature: string;
};

export type CreateInvoiceInput = {
  orderReference: string;
  courseName: string;
  chatId: string;
  price: number;
};

export type CreateInvoiceResult = {
  invoiceUrl: string;
};