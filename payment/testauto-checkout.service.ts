import { randomUUID } from "crypto";
import { literal, Op } from "sequelize";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import {
  formatWayforpayDateNextUtc,
  createWayforpayInvoiceWithRegular,
} from "./wayforpay-invoice";
import {
  getYearlySubscriptionTestPriceUah,
  getYearlySubscriptionTestRegularMode,
  YEARLY_SUBSCRIPTION_TEST_PLAN_CODE,
} from "./yearly-subscription-test-settings";

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];

export type TestAutoRenewCheckoutResult =
  | {
      ok: true;
      reused: true;
      orderReference: string;
      checkoutUrl: string;
      planCode: string;
      priceUah: number;
    }
  | {
      ok: true;
      reused: false;
      orderReference: string;
      checkoutUrl: string;
      planCode: string;
      priceUah: number;
    }
  | {
      ok: false;
      reason: "plan_not_found" | "active_order_without_checkout_url";
      planCode?: string;
      orderReference?: string;
    };

export async function createTestAutoRenewCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<TestAutoRenewCheckoutResult> {
  const plan = await SubscriptionPlan.findOne({
    where: { code: YEARLY_SUBSCRIPTION_TEST_PLAN_CODE, isActive: true },
  });
  if (!plan) {
    return {
      ok: false,
      reason: "plan_not_found",
      planCode: YEARLY_SUBSCRIPTION_TEST_PLAN_CODE,
    };
  }

  const forceNew = Boolean(options?.forceNew);

  const existing = await SubscriptionPaymentOrder.findOne({
    where: {
      userId,
      planId: plan.id,
      status: { [Op.in]: ACTIVE_ORDER_STATUSES },
    },
    order: literal('"created_at" DESC'),
  });

  if (existing && !forceNew) {
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
      priceUah: Number(existing.amount),
    };
  }

  if (existing && forceNew) {
    await SubscriptionPaymentOrder.update(
      { status: "replaced", terminalAt: new Date() },
      {
        where: {
          userId,
          planId: plan.id,
          status: { [Op.in]: ACTIVE_ORDER_STATUSES },
        },
      },
    );
  }

  const priceUah = await getYearlySubscriptionTestPriceUah();
  const regularMode = await getYearlySubscriptionTestRegularMode();
  const orderReference = randomUUID();

  const { invoiceUrl } = await createWayforpayInvoiceWithRegular({
    orderReference,
    courseName: MULTIMASKING_PRODUCT_NAME,
    chatId: userId,
    price: priceUah,
    regular: {
      regularMode,
      regularAmount: priceUah,
      dateNext: formatWayforpayDateNextUtc(1),
      regularBehavior: "preset",
      regularOn: 1,
    },
  });

  await SubscriptionPaymentOrder.create({
    orderReference,
    userId,
    planId: plan.id,
    status: "created",
    amount: String(priceUah),
    currency: plan.currency,
    provider: "wayforpay",
    checkoutUrl: invoiceUrl,
    terminalAt: null,
  });

  console.log("[testauto] checkout created", {
    userId,
    orderReference,
    priceUah,
    regularMode,
  });

  return {
    ok: true,
    reused: false,
    orderReference,
    checkoutUrl: invoiceUrl,
    planCode: plan.code,
    priceUah,
  };
}
