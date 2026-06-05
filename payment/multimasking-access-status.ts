import { Op } from "sequelize";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { getActiveMultimaskingPaymentSummaryForContact } from "../telegram/paid-chat-janitor/paid-chat-allowlist";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "./multimasking-product";
import { isMultimaskingRecurringPlanCode } from "./subscription-plan-codes";
import { getSubscriptionStatusForUserId } from "./subscription-status.service";

export type MultimaskingAccessSource =
  | "payment_hook"
  | "subscription_auto"
  | "user_subscription";

export type MultimaskingAutoRenewSnapshot = {
  planCode: string;
  wayforpayStatus: string | null;
  wayforpayMode: string | null;
  nextChargeAt: Date | null;
  anchorOrderReference: string | null;
};

/** Дефолт grace, якщо `SUBSCRIPTION_AUTO_GRACE_DAYS` не задано в env. */
export const SUBSCRIPTION_AUTO_GRACE_DAYS_DEFAULT = 5;

/**
 * S2-5 / Q3: дні після `contact_product_access.endAt`, коли `subscription_auto` ще Active,
 * але renewal webhook ще не продовжив grant (janitor / gate / allowlist).
 */
export function getSubscriptionAutoGraceDays(): number {
  const raw = process.env.SUBSCRIPTION_AUTO_GRACE_DAYS?.trim();
  if (!raw) {
    return SUBSCRIPTION_AUTO_GRACE_DAYS_DEFAULT;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    return SUBSCRIPTION_AUTO_GRACE_DAYS_DEFAULT;
  }
  return n;
}

/**
 * Єдине джерело для gate / janitor / profile (S2).
 * `hasAccess` = активний grant, user_subscriptions active, або grace (recurring Active + прострочений grant).
 */
export type MultimaskingAccessStatus = {
  hasAccess: boolean;
  source: MultimaskingAccessSource | null;
  grantEndAt: Date | null;
  autoRenew: MultimaskingAutoRenewSnapshot | null;
  userSubscriptionPlanCode: string | null;
  userSubscriptionEndAt: Date | null;
  /** `true` — grant формально минув, але в межах SUBSCRIPTION_AUTO_GRACE_DAYS. */
  inGracePeriod: boolean;
};

function isWayforpayActiveStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "active";
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function findActiveSubscriptionAutoForUser(
  userId: string,
): Promise<MultimaskingAutoRenewSnapshot | null> {
  const rows = await SubscriptionAuto.findAll({
    where: { userId, cancelledAt: null },
  });

  for (const row of rows) {
    if (!isWayforpayActiveStatus(row.wayforpayStatus)) {
      continue;
    }
    const plan = await SubscriptionPlan.findByPk(row.planId, { attributes: ["code"] });
    if (!plan || !isMultimaskingRecurringPlanCode(plan.code)) {
      continue;
    }
    return {
      planCode: plan.code,
      wayforpayStatus: row.wayforpayStatus,
      wayforpayMode: row.wayforpayMode,
      nextChargeAt: row.nextChargeAt,
      anchorOrderReference: row.anchorOrderReference,
    };
  }

  return null;
}

/** Останній `endAt` payment_hook (навіть якщо вже прострочений) — для grace-вікна. */
async function getLatestMultimaskingGrantEndAt(contactId: number): Promise<Date | null> {
  const row = await ContactProductAccess.findOne({
    where: {
      contactId,
      source: "payment_hook",
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      revokedAt: null,
      isActive: true,
      endAt: { [Op.ne]: null },
    },
    order: [["endAt", "DESC"]],
    attributes: ["endAt"],
  });
  return row?.endAt ?? null;
}

function isWithinGraceAfterGrantEnd(
  latestGrantEndAt: Date,
  now: Date,
  graceDays: number,
): boolean {
  if (graceDays <= 0) {
    return false;
  }
  return now.getTime() <= addDaysUtc(latestGrantEndAt, graceDays).getTime();
}

/**
 * Чи є активний доступ до MULTIMASKING зараз (OR: payment_hook, recurring+grant, user_subscriptions, grace).
 */
export async function hasActiveMultimaskingAccess(
  contactId: number,
  userId: string,
  now = new Date(),
): Promise<MultimaskingAccessStatus> {
  const [grantSummary, autoRenew, userSub] = await Promise.all([
    getActiveMultimaskingPaymentSummaryForContact(contactId),
    findActiveSubscriptionAutoForUser(userId),
    getSubscriptionStatusForUserId(userId, now),
  ]);

  const grantActive = grantSummary.active;
  let grantEndAt = grantSummary.active ? (grantSummary.grantEndAt ?? null) : null;

  const userSubActive = userSub.status === "active";
  const userSubscriptionEndAt =
    userSubActive && userSub.endAtIso ? new Date(userSub.endAtIso) : null;

  let hasAccess = grantActive || userSubActive;
  let inGracePeriod = false;

  let source: MultimaskingAccessSource | null = null;
  if (grantActive && autoRenew != null) {
    source = "subscription_auto";
  } else if (grantActive) {
    source = "payment_hook";
  } else if (userSubActive) {
    source = "user_subscription";
  }

  if (!hasAccess && autoRenew != null) {
    const graceDays = getSubscriptionAutoGraceDays();
    const latestGrantEndAt = await getLatestMultimaskingGrantEndAt(contactId);
    if (
      latestGrantEndAt != null &&
      latestGrantEndAt.getTime() <= now.getTime() &&
      isWithinGraceAfterGrantEnd(latestGrantEndAt, now, graceDays)
    ) {
      hasAccess = true;
      inGracePeriod = true;
      grantEndAt = latestGrantEndAt;
      source = "subscription_auto";
    }
  }

  return {
    hasAccess,
    source,
    grantEndAt,
    autoRenew,
    userSubscriptionPlanCode: userSubActive ? userSub.planCode : null,
    userSubscriptionEndAt,
    inGracePeriod,
  };
}
