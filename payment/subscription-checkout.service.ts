import { literal, Op } from "sequelize";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { createMultimaskingMonthlyCheckout } from "./multimasking-monthly-checkout.service";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "./subscription-plan-codes";

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];

export type SubscriptionCheckoutResult =
  | {
      ok: true;
      reused: true;
      orderReference: string;
      checkoutUrl: string;
      planCode: string;
    }
  | {
      ok: true;
      reused: false;
      orderReference: string;
      checkoutUrl: string;
      planCode: string;
    }
  | {
      ok: false;
      reason: "plan_not_found" | "active_order_without_checkout_url";
      planCode?: string;
      orderReference?: string;
    };

type CreateSubscriptionCheckoutInput = {
  userId: string;
  planCode: string;
  forceNew: boolean;
};

type RenewSubscriptionInput = {
  userId: string;
  planCode?: string;
  forceNew?: boolean;
};

export type SubscriptionCheckoutRecoveryResult =
  | {
      ok: true;
      hasActiveOrder: true;
      orderReference: string;
      checkoutUrl: string | null;
      planCode: string | null;
      status: string;
      canContinue: boolean;
      canRecreate: boolean;
    }
  | {
      ok: true;
      hasActiveOrder: false;
      canContinue: false;
      canRecreate: true;
    };

export async function createSubscriptionCheckout(
  input: CreateSubscriptionCheckoutInput,
): Promise<SubscriptionCheckoutResult> {
  const planCode = input.planCode.trim();
  if (planCode !== MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return { ok: false, reason: "plan_not_found", planCode };
  }

  const result = await createMultimaskingMonthlyCheckout(input.userId, {
    forceNew: input.forceNew,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    reused: result.reused,
    orderReference: result.orderReference,
    checkoutUrl: result.checkoutUrl,
    planCode: result.planCode,
  };
}

export async function recoverSubscriptionCheckout(
  userId: string,
): Promise<SubscriptionCheckoutRecoveryResult> {
  const existing = await SubscriptionPaymentOrder.findOne({
    where: {
      userId,
      status: { [Op.in]: ACTIVE_ORDER_STATUSES },
    },
    order: literal('"created_at" DESC'),
  });

  if (!existing) {
    return {
      ok: true,
      hasActiveOrder: false,
      canContinue: false,
      canRecreate: true,
    };
  }

  const plan = await SubscriptionPlan.findByPk(existing.planId, {
    attributes: ["code"],
  });

  return {
    ok: true,
    hasActiveOrder: true,
    orderReference: existing.orderReference,
    checkoutUrl: existing.checkoutUrl,
    planCode: plan?.code ?? null,
    status: existing.status,
    canContinue: Boolean(existing.checkoutUrl),
    canRecreate: true,
  };
}

export async function recreateSubscriptionCheckout(input: {
  userId: string;
  planCode?: string;
}): Promise<SubscriptionCheckoutResult> {
  const planCode = input.planCode?.trim() || MONTHLY_SUBSCRIPTION_PLAN_CODE;
  return createSubscriptionCheckout({
    userId: input.userId,
    planCode,
    forceNew: true,
  });
}

export async function renewSubscriptionCheckout(
  input: RenewSubscriptionInput,
): Promise<SubscriptionCheckoutResult> {
  const planCode = input.planCode?.trim() || MONTHLY_SUBSCRIPTION_PLAN_CODE;
  return createSubscriptionCheckout({
    userId: input.userId,
    planCode,
    forceNew: Boolean(input.forceNew),
  });
}
