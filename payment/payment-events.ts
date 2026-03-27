import { appendFile, readFile } from "fs/promises";
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

export async function readRecentPaymentEvents(limit = 20): Promise<PaymentEvent[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 20;

  try {
    const raw = await readFile(eventsPath, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .slice(-safeLimit)
      .map((line) => {
        try {
          return JSON.parse(line) as PaymentEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is PaymentEvent => e !== null);
  } catch {
    return [];
  }
}

