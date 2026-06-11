import { Op } from "sequelize";
import { SubscriptionRenewalReminderLog } from "../database/SubscriptionRenewalReminderLog";
import { UserSubscription } from "../database/UserSubscription";
import { hasActiveMultimaskingRecurringAuto } from "./multimasking-access-status";
import { sendTelegramBotMessage } from "./telegram-notify";
import { subscriptionFlags } from "./subscription-flags";

const RENEWAL_DAY_MARKERS = [7, 3, 1] as const;

function parseEnvSeconds(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function includeDPlusOne(): boolean {
  const raw = String(process.env.SUBSCRIPTION_RENEWAL_DPLUS1_ENABLED ?? "").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function daysUntil(endAt: Date, now: Date): number {
  const endDay = startOfUtcDay(endAt);
  const nowDay = startOfUtcDay(now);
  return Math.floor((endDay.getTime() - nowDay.getTime()) / (24 * 60 * 60 * 1000));
}

function daysAfter(endAt: Date, now: Date): number {
  return -daysUntil(endAt, now);
}

async function sendRenewalReminderIfFirst(input: {
  userId: string;
  subscriptionId: number;
  alertType: string;
  dedupeKey: string;
  subscriptionEndAt: Date | null;
  text: string;
}): Promise<void> {
  try {
    await SubscriptionRenewalReminderLog.create({
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      alertType: input.alertType,
      dedupeKey: input.dedupeKey,
      subscriptionEndAt: input.subscriptionEndAt,
    });
  } catch (err: unknown) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: string }).name)
        : "";
    if (name === "SequelizeUniqueConstraintError") {
      return;
    }
    throw err;
  }

  await sendTelegramBotMessage(input.userId, input.text);
}

export async function sendDueSubscriptionRenewalReminders(
  now: Date = new Date(),
): Promise<void> {
  if (!subscriptionFlags.subscriptionRenewalJobsEnabled) return;

  const candidates = await UserSubscription.findAll({
    where: {
      status: { [Op.in]: ["active", "lapsed"] },
    },
    limit: 500,
    order: [["endAt", "ASC"]],
  });

  for (const row of candidates) {
    if (await hasActiveMultimaskingRecurringAuto(row.userId)) {
      continue;
    }

    const endAt = row.endAt;
    const left = daysUntil(endAt, now);

    if (RENEWAL_DAY_MARKERS.includes(left as (typeof RENEWAL_DAY_MARKERS)[number])) {
      const alertType = `renewal_d${left}`;
      const dedupeKey = `${row.id}:${alertType}:${startOfUtcDay(endAt).toISOString()}`;
      await sendRenewalReminderIfFirst({
        userId: row.userId,
        subscriptionId: row.id,
        alertType,
        dedupeKey,
        subscriptionEndAt: endAt,
        text:
          `Нагадування про підписку: до завершення доступу залишилось ${left} дн.\n\n` +
          "Щоб продовжити доступ без перерви, оновіть підписку через /payment.",
      });
      continue;
    }

    if (includeDPlusOne()) {
      const after = daysAfter(endAt, now);
      if (after === 1) {
        const alertType = "renewal_dplus1";
        const dedupeKey = `${row.id}:${alertType}:${startOfUtcDay(endAt).toISOString()}`;
        await sendRenewalReminderIfFirst({
          userId: row.userId,
          subscriptionId: row.id,
          alertType,
          dedupeKey,
          subscriptionEndAt: endAt,
          text:
            "Нагадування про підписку: доступ завершився вчора.\n\n" +
            "Щоб відновити доступ, оформіть продовження підписки через /payment.",
        });
      }
    }
  }
}

function getTickMs(): number {
  const seconds = parseEnvSeconds("SUBSCRIPTION_RENEWAL_TICK_SECONDS", 3600);
  return seconds * 1000;
}

export function startSubscriptionRenewalReminderLoop(): void {
  if (!subscriptionFlags.subscriptionRenewalJobsEnabled) {
    console.log("[subscription] renewal reminder loop disabled by flags");
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await sendDueSubscriptionRenewalReminders();
    } catch (err) {
      console.error("[subscription] renewal reminder loop error", err);
    }
  };

  const tickMs = getTickMs();
  void run();
  const timer = setInterval(() => {
    void run();
  }, tickMs);
  timer.unref();
  console.log("[subscription] renewal reminder loop started", { tickMs });
}
