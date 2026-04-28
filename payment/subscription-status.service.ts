import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { UserSubscription } from "../database/UserSubscription";

export type SubscriptionStatusValue = "active" | "inactive" | "lapsed" | "canceled";

export type SubscriptionStatusView = {
  status: SubscriptionStatusValue;
  planCode: string | null;
  startAtIso: string | null;
  endAtIso: string | null;
  daysLeft: number;
  canRenew: boolean;
};

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
}): SubscriptionStatusView {
  const { status, planCode, startAt, endAt, now } = args;
  const daysLeft = endAt ? computeDaysLeft(endAt, now) : 0;
  return {
    status,
    planCode,
    startAtIso: startAt?.toISOString() ?? null,
    endAtIso: endAt?.toISOString() ?? null,
    daysLeft,
    canRenew: status !== "inactive",
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
  const row = await UserSubscription.findOne({
    where: { userId },
    order: [["endAt", "DESC"]],
  });

  if (!row) {
    return toView({
      status: "inactive",
      planCode: null,
      startAt: null,
      endAt: null,
      now,
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
    });
  }

  if (row.endAt <= now || row.status === "lapsed") {
    return toView({
      status: "lapsed",
      planCode,
      startAt: row.startAt,
      endAt: row.endAt,
      now,
    });
  }

  return toView({
    status: "active",
    planCode,
    startAt: row.startAt,
    endAt: row.endAt,
    now,
  });
}
