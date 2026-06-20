import {
  createMultimaskingRecurringCheckout,
  type MultimaskingRecurringCheckoutResult,
} from "./multimasking-recurring-checkout.service";
import { MONTHLY_SUBSCRIPTION_REGULAR_COUNT } from "./multimasking-monthly-checkout.service";
import { YEARLY_SUBSCRIPTION_PLAN_CODE } from "./subscription-plan-codes";
import {
  getYearlySubscriptionAccessDays,
  getYearlySubscriptionPriceUah,
} from "./yearly-subscription-settings";

export type MultimaskingYearlyCheckoutResult = MultimaskingRecurringCheckoutResult;

/**
 * Prod preset: `regularMode=yearly`, ціна з `yearly_subscription_price_uah`,
 * `dateNext` = +`yearly_subscription_access_days` UTC (типово 365), `regularCount` = 36.
 */
export async function createMultimaskingYearlyCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<MultimaskingYearlyCheckoutResult> {
  const [priceUah, accessDays] = await Promise.all([
    getYearlySubscriptionPriceUah(),
    getYearlySubscriptionAccessDays(),
  ]);

  return createMultimaskingRecurringCheckout(
    userId,
    {
      planCode: YEARLY_SUBSCRIPTION_PLAN_CODE,
      regularMode: "yearly",
      priceUah,
      dateNextDaysFromNow: accessDays,
      regularCount: MONTHLY_SUBSCRIPTION_REGULAR_COUNT,
    },
    options,
  );
}
