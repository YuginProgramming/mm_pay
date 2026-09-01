import { Op } from "sequelize";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { SubscriptionRenewalReminderLog } from "../database/SubscriptionRenewalReminderLog";
import { UserSubscription } from "../database/UserSubscription";
import { hasActiveMultimaskingRecurringAuto } from "./multimasking-access-status";
import {
  MANAGE_SUBSCRIPTION_BUTTON_TEXT,
  sendTelegramBotMessage,
  UNSUBSCRIBE_MANAGE_CALLBACK,
  type TelegramCallbackButton,
} from "./telegram-notify";
import { subscriptionFlags } from "./subscription-flags";

const RENEWAL_DAY_MARKERS = [7, 3, 1] as const;
/** Recurring auto-charge reminder (`subscription_auto`) — Kyiv calendar D-1. */
const CHARGE_REMINDER_ALERT_TYPE = "charge_d1" as const;
const KYIV_TZ = "Europe/Kyiv";
const KYIV_WORK_START_MINUTES = 9 * 60;
const KYIV_WORK_END_MINUTES = 18 * 60;

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

type KyivDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function kyivDateTimeParts(date: Date): KyivDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
  };
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

export function kyivCalendarDateKey(date: Date): string {
  const p = kyivDateTimeParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Kyiv local time in [09:00, 18:00). */
export function isKyivWorkingHours(now: Date): boolean {
  const p = kyivDateTimeParts(now);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= KYIV_WORK_START_MINUTES && minutes < KYIV_WORK_END_MINUTES;
}

/** True when Kyiv calendar date of `now` is the day before Kyiv date of `target`. */
export function isKyivCalendarDayBefore(now: Date, target: Date): boolean {
  const today = kyivDateTimeParts(now);
  const charge = kyivDateTimeParts(target);
  const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
  return (
    tomorrow.year === charge.year &&
    tomorrow.month === charge.month &&
    tomorrow.day === charge.day
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

const DEFAULT_CHARGE_REMINDER_PRICE_UAH = 500;

export function formatChargeReminderPriceUah(price: string | number | null | undefined): string {
  const n = typeof price === "number" ? price : Number(price);
  if (!Number.isFinite(n)) return String(DEFAULT_CHARGE_REMINDER_PRICE_UAH);
  return String(Math.round(n));
}

/** HTML (`parse_mode: HTML`). `{PRICE}` from the subscription plan (monthly 500). */
export function buildSubscriptionAutoChargeReminderTextUa(
  priceUah: string | number = DEFAULT_CHARGE_REMINDER_PRICE_UAH,
): string {
  const price = formatChargeReminderPriceUah(priceUah);
  return (
    "Невелике нагадування від Multimasking 💛\n" +
    `Завтра продовжується ваша підписка на участь у закритому чаті Multimasking — з картки буде автоматично списано ${price} грн.\n` +
    "Дякуємо, що ви з нами! 🙌\n" +
    "Якщо хочете продовжити участь — нічого робити не потрібно. Підписка продовжиться автоматично.\n" +
    "Якщо ви вирішили зробити паузу, скасувати підписку можна до моменту наступного списання:\n\n" +
    `<i>Невеликий момент: назва операції у банківській виписці іноді може відрізнятися від назви Multimasking. Якщо ви побачите списання на ${price} грн за підписку приблизно в цю дату — найімовірніше, це оплата участі в Multimasking.</i>`
  );
}

function chargeReminderManageButton(): TelegramCallbackButton {
  return {
    text: MANAGE_SUBSCRIPTION_BUTTON_TEXT,
    callbackData: UNSUBSCRIBE_MANAGE_CALLBACK,
  };
}

function priceUahFromAutoRow(row: SubscriptionAuto): string {
  const plan = (row as SubscriptionAuto & { plan?: SubscriptionPlan | null }).plan;
  return formatChargeReminderPriceUah(plan?.price ?? DEFAULT_CHARGE_REMINDER_PRICE_UAH);
}

async function sendRenewalReminderIfFirst(input: {
  userId: string;
  subscriptionId: number;
  alertType: string;
  dedupeKey: string;
  subscriptionEndAt: Date | null;
  text: string;
  parseMode?: "HTML";
  callbackButtons?: TelegramCallbackButton[];
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

  const notifyOptions =
    input.parseMode || (input.callbackButtons && input.callbackButtons.length > 0)
      ? {
          parseMode: input.parseMode,
          callbackButtons: input.callbackButtons,
        }
      : undefined;
  if (notifyOptions) {
    await sendTelegramBotMessage(input.userId, input.text, undefined, notifyOptions);
  } else {
    await sendTelegramBotMessage(input.userId, input.text);
  }
}

async function sendDueSubscriptionAutoChargeReminders(now: Date): Promise<void> {
  if (!isKyivWorkingHours(now)) return;

  const rows = await SubscriptionAuto.findAll({
    where: {
      autoRenewEnabled: true,
      cancelledAt: null,
      nextChargeAt: { [Op.ne]: null },
    },
    include: [{ model: SubscriptionPlan, as: "plan", attributes: ["price"] }],
    limit: 500,
    order: [["nextChargeAt", "ASC"]],
  });

  for (const row of rows) {
    const nextChargeAt = row.nextChargeAt;
    if (!nextChargeAt) continue;
    if (now.getTime() >= nextChargeAt.getTime()) continue;
    if (!isKyivCalendarDayBefore(now, nextChargeAt)) continue;

    const alertType = CHARGE_REMINDER_ALERT_TYPE;
    const dedupeKey = `auto:${row.id}:${alertType}:${kyivCalendarDateKey(nextChargeAt)}`;
    await sendRenewalReminderIfFirst({
      userId: row.userId,
      subscriptionId: row.id,
      alertType,
      dedupeKey,
      subscriptionEndAt: nextChargeAt,
      text: buildSubscriptionAutoChargeReminderTextUa(priceUahFromAutoRow(row)),
      parseMode: "HTML",
      callbackButtons: [chargeReminderManageButton()],
    });
  }
}

export async function sendDueSubscriptionRenewalReminders(
  now: Date = new Date(),
): Promise<void> {
  if (!subscriptionFlags.subscriptionRenewalJobsEnabled) return;

  await sendDueSubscriptionAutoChargeReminders(now);

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
