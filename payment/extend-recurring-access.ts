import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import { grantApprovedMultimaskingAccess } from "./grant-multimasking-access";
import {
  buildSubscriptionStateLabel,
  resolveRecurringAccessDays,
} from "./recurring-access-settings";
import { SUBSCRIPTION_AUTO_PLAN_CODE } from "./subscription-plan-codes";

export type ExtendRecurringAccessInput = {
  /** Telegram user id (metadata.chatId). */
  userId: string;
  /** `subscription_plans.id` recurring-плану. */
  planId: number;
  /** Реальний (webhook) або синтетичний (`reg-<anchor>-<epoch>`, reconciler) orderReference. */
  orderReference: string;
  amount: number | string;
  currency: string;
  /** Джерело виклику — лише для логів; поведінка однакова. */
  source: "webhook" | "reconciler";
};

export type ExtendRecurringAccessResult = {
  granted: boolean;
  grantEndAt: Date | null;
};

/**
 * Спільне продовження доступу для recurring renewal (webhook і cron/poll reconciler).
 * Стек від активного `end_at` (+plan days), **без DM** (silent) — TZ/update-access.md §8/§12.
 */
export async function extendRecurringMultimaskingAccess(
  input: ExtendRecurringAccessInput,
): Promise<ExtendRecurringAccessResult> {
  const plan = await SubscriptionPlan.findByPk(input.planId, { attributes: ["code"] });
  const planCode = plan?.code ?? SUBSCRIPTION_AUTO_PLAN_CODE;
  const accessDays = await resolveRecurringAccessDays(planCode);
  const subscriptionStateLabel = buildSubscriptionStateLabel(planCode, accessDays);

  const result = await grantApprovedMultimaskingAccess(
    {
      orderReference: input.orderReference,
      chatId: input.userId,
      courseName: MULTIMASKING_PRODUCT_NAME,
      amount: input.amount,
      currency: input.currency,
    },
    {
      accessDays,
      subscriptionStateLabel,
      renewalExtendFromActiveGrant: true,
      skipSuccessMessage: true,
      suppressUserMessages: input.source === "reconciler",
    },
  );

  console.log("[extend-recurring-access] done", {
    source: input.source,
    userId: input.userId,
    planId: input.planId,
    planCode,
    orderReference: input.orderReference,
    accessDays,
    granted: result.granted,
  });

  return { granted: result.granted, grantEndAt: result.grantEndAt ?? null };
}
