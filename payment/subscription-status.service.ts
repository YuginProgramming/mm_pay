import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { UserSubscription } from "../database/UserSubscription";
import { isMultimaskingRecurringPlanCode } from "./subscription-plan-codes";

export type SubscriptionStatusValue = "active" | "inactive" | "lapsed" | "canceled";

export type SubscriptionStatusView = {
  status: SubscriptionStatusValue;
  planCode: string | null;
  startAtIso: string | null;
  endAtIso: string | null;
  daysLeft: number;
  canRenew: boolean;
  /** S2-7: чи є активне автопродовження WayForPay у `subscription_auto`. */
  autoRenew: boolean;
  wayforpayStatus: string | null;
  nextChargeAt: string | null;
};

type ActiveSubscriptionAutoRenew = {
  wayforpayStatus: string | null;
  nextChargeAt: Date | null;
};

function isWayforpayActiveStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "active";
}

/** Активний recurring-рядок `subscription_auto` (узгоджено з `multimasking-access-status`). */
async function findActiveSubscriptionAutoRenew(
  userId: string,
): Promise<ActiveSubscriptionAutoRenew | null> {
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
      wayforpayStatus: row.wayforpayStatus,
      nextChargeAt: row.nextChargeAt,
    };
  }

  return null;
}

const msPerDay = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function computeDaysLeft(endAt: Date, now: Date): number {
  const endDay = startOfUtcDay(endAt);
  const nowDay = startOfUtcDay(now);
  const diffDays = Math.ceil((endDay.getTime() - nowDay.getTime()) / msPerDay);
  return Math.max(0, diffDays);
}

function toView(args: {
  status: SubscriptionStatusValue;
  planCode: string | null;
  startAt: Date | null;
  endAt: Date | null;
  now: Date;
  autoRenew: ActiveSubscriptionAutoRenew | null;
}): SubscriptionStatusView {
  const { status, planCode, startAt, endAt, now, autoRenew } = args;
  const daysLeft = endAt ? computeDaysLeft(endAt, now) : 0;
  return {
    status,
    planCode,
    startAtIso: startAt?.toISOString() ?? null,
    endAtIso: endAt?.toISOString() ?? null,
    daysLeft,
    canRenew: status !== "inactive",
    autoRenew: autoRenew != null,
    wayforpayStatus: autoRenew?.wayforpayStatus ?? null,
    nextChargeAt: autoRenew?.nextChargeAt?.toISOString() ?? null,
  };
}

/**
 * Single source of truth for user subscription state.
 * This is internal domain logic and intentionally independent
 * from transport (HTTP/bot handlers).
 */
export async function getSubscriptionStatusForUserId(
  userId: string,
  now = new Date(),
): Promise<SubscriptionStatusView> {
  const [row, autoRenew] = await Promise.all([
    UserSubscription.findOne({
      where: { userId },
      order: [["endAt", "DESC"]],
    }),
    findActiveSubscriptionAutoRenew(userId),
  ]);

  if (!row) {
    return toView({
      status: "inactive",
      planCode: null,
      startAt: null,
      endAt: null,
      now,
      autoRenew,
    });
  }

  const plan = await SubscriptionPlan.findByPk(row.planId, {
    attributes: ["code"],
  });
  const planCode = plan?.code ?? null;

  if (row.status === "canceled") {
    return toView({
      status: "canceled",
      planCode,
      startAt: row.startAt,
      endAt: row.endAt,
      now,
      autoRenew,
    });
  }

  if (row.endAt <= now || row.status === "lapsed") {
    return toView({
      status: "lapsed",
      planCode,
      startAt: row.startAt,
      endAt: row.endAt,
      now,
      autoRenew,
    });
  }

  return toView({
    status: "active",
    planCode,
    startAt: row.startAt,
    endAt: row.endAt,
    now,
    autoRenew,
  });
}
