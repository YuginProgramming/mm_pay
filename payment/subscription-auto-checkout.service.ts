import { randomUUID } from "crypto";
import { literal, Op } from "sequelize";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import { putPendingOrder, takePendingOrder } from "./pending-orders";
import {
  createWayforpayPurchaseWithRegular,
  formatWayforpayDateNextUtc,
} from "./wayforpay-purchase";
import {
  getSubscriptionAutoPriceUah,
  getSubscriptionAutoRegularCount,
  getSubscriptionAutoRegularMode,
  SUBSCRIPTION_AUTO_PLAN_CODE,
} from "./subscription-auto-settings";

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];

export type SubscriptionAutoCheckoutResult =
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

export async function createSubscriptionAutoCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<SubscriptionAutoCheckoutResult> {
  const plan = await SubscriptionPlan.findOne({
    where: { code: SUBSCRIPTION_AUTO_PLAN_CODE, isActive: true },
  });
  if (!plan) {
    return {
      ok: false,
      reason: "plan_not_found",
      planCode: SUBSCRIPTION_AUTO_PLAN_CODE,
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

  const priceUah = await getSubscriptionAutoPriceUah();
  const regularMode = await getSubscriptionAutoRegularMode();
  const regularCount = await getSubscriptionAutoRegularCount();
  const orderReference = randomUUID();

  await putPendingOrder(orderReference, {
    chatId: userId,
    courseName: MULTIMASKING_PRODUCT_NAME,
  });

  try {
    const { checkoutUrl } = await createWayforpayPurchaseWithRegular({
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
        ...(regularCount != null ? { regularCount } : {}),
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
      checkoutUrl,
      terminalAt: null,
    });

    console.log("[subscription-auto] purchase checkout created", {
      userId,
      orderReference,
      priceUah,
      regularMode,
      regularCount,
    });

    return {
      ok: true,
      reused: false,
      orderReference,
      checkoutUrl,
      planCode: plan.code,
      priceUah,
    };
  } catch (err) {
    await takePendingOrder(orderReference);
    throw err;
  }
}
