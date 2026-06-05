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

const ACTIVE_ORDER_STATUSES = ["created", "pending", "processing", "suspended"];

export type MultimaskingRecurringCheckoutConfig = {
  planCode: string;
  regularMode: string;
  priceUah: number;
  regularCount?: number | null;
  dateEnd?: string | null;
  /** Days from today (UTC) for WayForPay `dateNext`. Default: 1. */
  dateNextDaysFromNow?: number;
};

export type MultimaskingRecurringCheckoutResult =
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

/**
 * WayForPay Purchase + regular для MULTIMASKING (спільний шлях для /subauto і майбутнього monthly_1m).
 */
export async function createMultimaskingRecurringCheckout(
  userId: string,
  config: MultimaskingRecurringCheckoutConfig,
  options?: { forceNew?: boolean },
): Promise<MultimaskingRecurringCheckoutResult> {
  const plan = await SubscriptionPlan.findOne({
    where: { code: config.planCode, isActive: true },
  });
  if (!plan) {
    return {
      ok: false,
      reason: "plan_not_found",
      planCode: config.planCode,
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

  const priceUah = config.priceUah;
  const orderReference = randomUUID();
  const dateNextDays = config.dateNextDaysFromNow ?? 1;

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
        regularMode: config.regularMode,
        regularAmount: priceUah,
        dateNext: formatWayforpayDateNextUtc(dateNextDays),
        regularBehavior: "preset",
        regularOn: 1,
        ...(config.regularCount != null && config.regularCount > 0
          ? { regularCount: config.regularCount }
          : {}),
        ...(config.dateEnd?.trim() ? { dateEnd: config.dateEnd.trim() } : {}),
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

    console.log("[multimasking-recurring] purchase checkout created", {
      userId,
      orderReference,
      planCode: plan.code,
      priceUah,
      regularMode: config.regularMode,
      regularCount: config.regularCount ?? null,
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
