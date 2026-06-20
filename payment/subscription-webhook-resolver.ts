/**
 * Ledger `subscription_payment_orders` + дзеркало `user_subscriptions`.
 *
 * S1-8 / Q1 (TZ multimasking-recurring): для recurring (`monthly_1m`, `yearly_12m`, `subscription_auto`)
 * паралельно оновлюємо `user_subscriptions`, щоб `GET /subscription/status` і renewal-reminder
 * лишались коректними до S2. Канонічний доступ після S1 — `contact_product_access` +
 * `subscription_auto`; `user_subscriptions` — сумісний ledger (не джерело gate/janitor).
 */
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { UserSubscription } from "../database/UserSubscription";
import { sequelize } from "../database/db";
import type { WayForPayWebhookPayload } from "./payment.types";

const TERMINAL_FAILURE = new Set(["Declined", "Voided", "Refunded", "Expired"]);
const PENDING_OR_SUSPENDED = new Set([
  "Pending",
  "InProcessing",
  "WaitingAuthComplete",
  "Suspended",
]);

type ResolveSubscriptionWebhookResult =
  | { handled: false; reason: "order_not_found" | "plan_not_found" }
  | { handled: true; orderReference: string; status: string; updatedSubscription: boolean };

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Ідемпотентно продовжує `user_subscriptions` за `lastPaymentOrderReference`.
 * Повертає true, якщо рядок створено або оновлено; false — якщо цей payment вже застосовано.
 */
export async function applyApprovedUserSubscriptionExtension(args: {
  userId: string;
  planId: number;
  orderReference: string;
  durationDays: number;
}): Promise<boolean> {
  const now = new Date();

  return sequelize.transaction(async (tx) => {
    const alreadyApplied = await UserSubscription.findOne({
      where: {
        userId: args.userId,
        planId: args.planId,
        lastPaymentOrderReference: args.orderReference,
      },
      transaction: tx,
    });
    if (alreadyApplied) {
      return false;
    }

    const current = await UserSubscription.findOne({
      where: { userId: args.userId, planId: args.planId },
      order: [["endAt", "DESC"]],
      transaction: tx,
    });

    if (!current) {
      await UserSubscription.create(
        {
          userId: args.userId,
          planId: args.planId,
          status: "active",
          startAt: now,
          endAt: addDays(now, args.durationDays),
          lastPaymentOrderReference: args.orderReference,
        },
        { transaction: tx },
      );
      return true;
    }

    const isCurrentActive = current.endAt > now && current.status === "active";
    const extensionBase = isCurrentActive ? current.endAt : now;
    const nextEndAt = addDays(extensionBase, args.durationDays);
    const nextStartAt = isCurrentActive ? current.startAt : now;

    await current.update(
      {
        status: "active",
        startAt: nextStartAt,
        endAt: nextEndAt,
        lastPaymentOrderReference: args.orderReference,
      },
      { transaction: tx },
    );
    return true;
  });
}

/**
 * Renewal recurring без `subscription_payment_orders`: дзеркалимо в `user_subscriptions`
 * за `subscription_plans.duration_days` (для `monthly_1m` = 30, `yearly_12m` = 365).
 */
export async function reconcileUserSubscriptionFromRecurringWebhook(args: {
  userId: string;
  planId: number;
  orderReference: string;
}): Promise<boolean> {
  const plan = await SubscriptionPlan.findByPk(args.planId, {
    attributes: ["durationDays"],
  });
  if (!plan) {
    return false;
  }

  return applyApprovedUserSubscriptionExtension({
    userId: args.userId,
    planId: args.planId,
    orderReference: args.orderReference,
    durationDays: plan.durationDays,
  });
}

export async function reconcileSubscriptionOrderFromWebhook(
  payload: WayForPayWebhookPayload,
): Promise<ResolveSubscriptionWebhookResult> {
  const order = await SubscriptionPaymentOrder.findOne({
    where: { orderReference: payload.orderReference },
  });
  if (!order) {
    return { handled: false, reason: "order_not_found" };
  }

  const now = new Date();
  const txStatus = String(payload.transactionStatus);

  if (txStatus === "Approved") {
    const plan = await SubscriptionPlan.findByPk(order.planId);
    if (!plan) {
      return { handled: false, reason: "plan_not_found" };
    }

    await SubscriptionPaymentOrder.update(
      { status: "approved", terminalAt: now },
      { where: { id: order.id } },
    );

    const updatedSubscription = await applyApprovedUserSubscriptionExtension({
      userId: order.userId,
      planId: order.planId,
      orderReference: order.orderReference,
      durationDays: plan.durationDays,
    });

    return {
      handled: true,
      orderReference: order.orderReference,
      status: "approved",
      updatedSubscription,
    };
  }

  if (TERMINAL_FAILURE.has(txStatus)) {
    await SubscriptionPaymentOrder.update(
      { status: "failed", terminalAt: now },
      { where: { id: order.id } },
    );
    return {
      handled: true,
      orderReference: order.orderReference,
      status: "failed",
      updatedSubscription: false,
    };
  }

  if (PENDING_OR_SUSPENDED.has(txStatus)) {
    await SubscriptionPaymentOrder.update(
      { status: "pending" },
      { where: { id: order.id, terminalAt: null } },
    );
    return {
      handled: true,
      orderReference: order.orderReference,
      status: "pending",
      updatedSubscription: false,
    };
  }

  return {
    handled: true,
    orderReference: order.orderReference,
    status: String(order.status),
    updatedSubscription: false,
  };
}
