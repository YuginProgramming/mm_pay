import { Op } from "sequelize";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { getActiveMultimaskingPaymentSummaryForContact } from "../telegram/paid-chat-janitor/paid-chat-allowlist";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "./multimasking-product";
import { isMultimaskingRecurringPlanCode } from "./subscription-plan-codes";
import { isActiveSubscriptionAutoRecord } from "./subscription-auto-active";
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

/** Дефолт grace для всіх типів доступу (janitor, gate, profile). */
export const MULTIMASKING_ACCESS_GRACE_DAYS_DEFAULT = 5;

/** @deprecated використовуйте `MULTIMASKING_ACCESS_GRACE_DAYS_DEFAULT` */
export const SUBSCRIPTION_AUTO_GRACE_DAYS_DEFAULT = MULTIMASKING_ACCESS_GRACE_DAYS_DEFAULT;

/**
 * Дні після `end_at`, коли доступ (і право лишатися в paid chats) ще вважається активним.
 * Env: `MULTIMASKING_ACCESS_GRACE_DAYS`, інакше `SUBSCRIPTION_AUTO_GRACE_DAYS`, інакше 5.
 */
export function getMultimaskingAccessGraceDays(): number {
  for (const envName of ["MULTIMASKING_ACCESS_GRACE_DAYS", "SUBSCRIPTION_AUTO_GRACE_DAYS"] as const) {
    const raw = process.env[envName]?.trim();
    if (!raw) {
      continue;
    }
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return MULTIMASKING_ACCESS_GRACE_DAYS_DEFAULT;
}

/** @deprecated використовуйте `getMultimaskingAccessGraceDays` */
export function getSubscriptionAutoGraceDays(): number {
  return getMultimaskingAccessGraceDays();
}

/**
 * Єдине джерело для gate / janitor / profile (S2).
 * `hasAccess` = активний grant, user_subscriptions active, або grace після `end_at` (усі типи).
 */
export type MultimaskingAccessStatus = {
  hasAccess: boolean;
  source: MultimaskingAccessSource | null;
  grantEndAt: Date | null;
  autoRenew: MultimaskingAutoRenewSnapshot | null;
  userSubscriptionPlanCode: string | null;
  userSubscriptionEndAt: Date | null;
  /** `true` — період формально минув, але в межах grace після `end_at`. */
  inGracePeriod: boolean;
};

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function maxDate(dates: Date[]): Date | null {
  if (dates.length === 0) {
    return null;
  }
  return dates.reduce((latest, candidate) =>
    candidate.getTime() >= latest.getTime() ? candidate : latest,
  );
}

async function findActiveSubscriptionAutoForUser(
  userId: string,
): Promise<MultimaskingAutoRenewSnapshot | null> {
  const rows = await SubscriptionAuto.findAll({
    where: { userId, cancelledAt: null },
  });

  for (const row of rows) {
    if (!isActiveSubscriptionAutoRecord(row)) {
      continue;
    }
    const plan = await SubscriptionPlan.findByPk(row.planId, { attributes: ["code"] });
    if (!plan || !isMultimaskingRecurringPlanCode(plan.code)) {
      continue;
    }
    return {
      planCode: plan.code,
      wayforpayStatus: row.wayforpayStatus?.trim() || "Active",
      wayforpayMode: row.wayforpayMode,
      nextChargeAt: row.nextChargeAt,
      anchorOrderReference: row.anchorOrderReference,
    };
  }

  return null;
}

/** S3-3: активний WayForPay recurring (`monthly_1m`, `yearly_12m` або `subscription_auto`) — renewal-reminder не потрібен. */
export async function hasActiveMultimaskingRecurringAuto(userId: string): Promise<boolean> {
  return (await findActiveSubscriptionAutoForUser(userId)) != null;
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

function isWithinGraceAfterEndAt(
  periodEndAt: Date,
  now: Date,
  graceDays: number,
): boolean {
  if (graceDays <= 0) {
    return false;
  }
  return (
    periodEndAt.getTime() <= now.getTime() &&
    now.getTime() <= addDaysUtc(periodEndAt, graceDays).getTime()
  );
}

function resolveGraceSource(args: {
  autoRenew: MultimaskingAutoRenewSnapshot | null;
  effectiveEndAt: Date;
  latestGrantEndAt: Date | null;
  userSubscriptionEndAt: Date | null;
}): MultimaskingAccessSource {
  if (args.autoRenew != null) {
    return "subscription_auto";
  }
  const grantMs = args.latestGrantEndAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const subMs = args.userSubscriptionEndAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (subMs >= grantMs && subMs === args.effectiveEndAt.getTime()) {
    return "user_subscription";
  }
  return "payment_hook";
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
  const userSubscriptionEndAt = userSub.endAtIso ? new Date(userSub.endAtIso) : null;

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

  if (!hasAccess) {
    const latestGrantEndAt = await getLatestMultimaskingGrantEndAt(contactId);
    const expiredEndCandidates: Date[] = [];

    if (
      latestGrantEndAt != null &&
      latestGrantEndAt.getTime() <= now.getTime()
    ) {
      expiredEndCandidates.push(latestGrantEndAt);
    }
    if (
      userSubscriptionEndAt != null &&
      userSubscriptionEndAt.getTime() <= now.getTime()
    ) {
      expiredEndCandidates.push(userSubscriptionEndAt);
    }

    const effectiveEndAt = maxDate(expiredEndCandidates);
    if (
      effectiveEndAt != null &&
      isWithinGraceAfterEndAt(effectiveEndAt, now, getMultimaskingAccessGraceDays())
    ) {
      hasAccess = true;
      inGracePeriod = true;
      grantEndAt = latestGrantEndAt ?? effectiveEndAt;
      source = resolveGraceSource({
        autoRenew,
        effectiveEndAt,
        latestGrantEndAt,
        userSubscriptionEndAt,
      });
    }
  }

  const userSubscriptionPlanCode =
    userSubActive || (inGracePeriod && source === "user_subscription")
      ? userSub.planCode
      : null;

  return {
    hasAccess,
    source,
    grantEndAt,
    autoRenew,
    userSubscriptionPlanCode,
    userSubscriptionEndAt,
    inGracePeriod,
  };
}
