import { appendFile } from "fs/promises";
import path from "path";
import type { WayForPayWebhookPayload } from "./payment.types";

export type PaymentEvent = {
  at: string; // ISO time
  orderReference: string;
  transactionStatus: string;
  amount: number | string;
  currency: string;
  reasonCode: number | string;
  chatId?: string;
  courseName?: string;
};

const eventsPath = path.resolve(process.cwd(), "payment-events.jsonl");

export async function logPaymentEvent(input: {
  payload: WayForPayWebhookPayload;
  metadata?: { chatId: string; courseName: string } | null;
}): Promise<void> {
  const event: PaymentEvent = {
    at: new Date().toISOString(),
    orderReference: input.payload.orderReference,
    transactionStatus: String(input.payload.transactionStatus),
    amount: input.payload.amount,
    currency: input.payload.currency,
    reasonCode: input.payload.reasonCode,
    ...(input.metadata?.chatId ? { chatId: input.metadata.chatId } : {}),
    ...(input.metadata?.courseName ? { courseName: input.metadata.courseName } : {}),
  };

  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

