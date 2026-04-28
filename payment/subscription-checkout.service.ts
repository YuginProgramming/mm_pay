import { Op } from "sequelize";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import { createCheckoutForCourse } from "./payment.service";

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
  const plan = await SubscriptionPlan.findOne({
    where: { code: input.planCode, isActive: true },
  });
  if (!plan) {
    return { ok: false, reason: "plan_not_found", planCode: input.planCode };
  }

  const existing = await SubscriptionPaymentOrder.findOne({
    where: {
      userId: input.userId,
      planId: plan.id,
      status: { [Op.in]: ACTIVE_ORDER_STATUSES },
    },
    order: [["createdAt", "DESC"]],
  });

  if (existing && !input.forceNew) {
    if (!existing.checkoutUrl) {
      return {
        ok: false,
        reason: "active_order_without_checkout_url",
        planCode: plan.code,
        orderReference: existing.orderReference,
      };
    }
    return {
      ok: true,
      reused: true,
      orderReference: existing.orderReference,
      checkoutUrl: existing.checkoutUrl,
      planCode: plan.code,
    };
  }

  if (existing && input.forceNew) {
    await SubscriptionPaymentOrder.update(
      { status: "replaced", terminalAt: new Date() },
      {
        where: {
          userId: input.userId,
          planId: plan.id,
          status: { [Op.in]: ACTIVE_ORDER_STATUSES },
        },
      },
    );
  }

  const { orderReference, invoiceUrl } = await createCheckoutForCourse(
    Number(plan.price),
    MULTIMASKING_PRODUCT_NAME,
    input.userId,
  );

  await SubscriptionPaymentOrder.create({
    orderReference,
    userId: input.userId,
    planId: plan.id,
    status: "created",
    amount: String(plan.price),
    currency: plan.currency,
    provider: "wayforpay",
    checkoutUrl: invoiceUrl,
    terminalAt: null,
  });

  return {
    ok: true,
    reused: false,
    orderReference,
    checkoutUrl: invoiceUrl,
    planCode: plan.code,
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
    order: [["createdAt", "DESC"]],
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
  const planCode = input.planCode?.trim() || "monthly_1m";
  return createSubscriptionCheckout({
    userId: input.userId,
    planCode,
    forceNew: true,
  });
}

export async function renewSubscriptionCheckout(
  input: RenewSubscriptionInput,
): Promise<SubscriptionCheckoutResult> {
  const planCode = input.planCode?.trim() || "monthly_1m";
  return createSubscriptionCheckout({
    userId: input.userId,
    planCode,
    forceNew: Boolean(input.forceNew),
  });
}
