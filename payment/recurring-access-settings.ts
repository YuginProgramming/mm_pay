import { getPaidChatAccessDays } from "../database/app-settings-queries";
import { getSubscriptionAutoAccessDays } from "./subscription-auto-settings";
import { getYearlySubscriptionAccessDays } from "./yearly-subscription-settings";
import {
  MONTHLY_SUBSCRIPTION_PLAN_CODE,
  YEARLY_SUBSCRIPTION_PLAN_CODE,
} from "./subscription-plan-codes";

/**
 * Кількість днів доступу для recurring-плану (monthly / yearly / subscription_auto).
 * Спільне джерело для webhook-шляху та reconciler (TZ/update-access.md §8).
 */
export async function resolveRecurringAccessDays(planCode: string): Promise<number> {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return getPaidChatAccessDays();
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return getYearlySubscriptionAccessDays();
  }
  return getSubscriptionAutoAccessDays();
}

/** `subscriptionStateTitle` для `contact_product_access` recurring-грантів. */
export function buildSubscriptionStateLabel(planCode: string, accessDays: number): string {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return `Щомісячна підписка · ${accessDays} дн.`;
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return `Річна підписка · ${accessDays} дн.`;
  }
  return `Автопродовження · ${accessDays} дн.`;
}
