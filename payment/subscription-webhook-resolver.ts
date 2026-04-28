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

    await sequelize.transaction(async (tx) => {
      await SubscriptionPaymentOrder.update(
        { status: "approved", terminalAt: now },
        { where: { id: order.id }, transaction: tx },
      );

      // Idempotency: if this exact payment reference has already been applied, do nothing else.
      const alreadyApplied = await UserSubscription.findOne({
        where: {
          userId: order.userId,
          planId: order.planId,
          lastPaymentOrderReference: order.orderReference,
        },
        transaction: tx,
      });
      if (alreadyApplied) return;

      const current = await UserSubscription.findOne({
        where: { userId: order.userId, planId: order.planId },
        order: [["endAt", "DESC"]],
        transaction: tx,
      });

      if (!current) {
        await UserSubscription.create(
          {
            userId: order.userId,
            planId: order.planId,
            status: "active",
            startAt: now,
            endAt: addDays(now, plan.durationDays),
            lastPaymentOrderReference: order.orderReference,
          },
          { transaction: tx },
        );
        return;
      }

      const isCurrentActive = current.endAt > now && current.status === "active";
      const extensionBase = isCurrentActive ? current.endAt : now;
      const nextEndAt = addDays(extensionBase, plan.durationDays);
      const nextStartAt = isCurrentActive ? current.startAt : now;

      await current.update(
        {
          status: "active",
          startAt: nextStartAt,
          endAt: nextEndAt,
          lastPaymentOrderReference: order.orderReference,
        },
        { transaction: tx },
      );
    });

    return {
      handled: true,
      orderReference: order.orderReference,
      status: "approved",
      updatedSubscription: true,
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
