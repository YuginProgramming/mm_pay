import { appendFile } from "fs/promises";
import path from "path";

export type SubscriptionStatusReadEvent = {
  kind: "subscription_status_read";
  at: string;
  userId: string;
  ok: boolean;
  status?: string;
  planCode?: string | null;
  daysLeft?: number;
  error?: string;
};

const eventsPath = path.resolve(process.cwd(), "subscription-events.jsonl");

export async function logSubscriptionStatusReadSuccess(input: {
  userId: string;
  status: string;
  planCode: string | null;
  daysLeft: number;
}): Promise<void> {
  const event: SubscriptionStatusReadEvent = {
    kind: "subscription_status_read",
    at: new Date().toISOString(),
    userId: input.userId,
    ok: true,
    status: input.status,
    planCode: input.planCode,
    daysLeft: input.daysLeft,
  };
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function logSubscriptionStatusReadFailure(input: {
  userId: string;
  error: unknown;
}): Promise<void> {
  const event: SubscriptionStatusReadEvent = {
    kind: "subscription_status_read",
    at: new Date().toISOString(),
    userId: input.userId,
    ok: false,
    error:
      input.error instanceof Error
        ? input.error.message
        : typeof input.error === "string"
          ? input.error
          : "unknown_error",
  };
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}
