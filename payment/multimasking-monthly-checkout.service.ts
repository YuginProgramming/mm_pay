import {
  createMultimaskingRecurringCheckout,
  type MultimaskingRecurringCheckoutResult,
} from "./multimasking-recurring-checkout.service";
import { getMultimaskingCoursePriceUah } from "./multimasking-price";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "./subscription-plan-codes";

export type MultimaskingMonthlyCheckoutResult = MultimaskingRecurringCheckoutResult;

/**
 * Prod preset: `regularMode=monthly`, ціна з `multimasking_course_price_uah`,
 * без `regularCount` / `dateEnd`, `dateNext` = +1 day UTC.
 */
export async function createMultimaskingMonthlyCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<MultimaskingMonthlyCheckoutResult> {
  const priceUah = await getMultimaskingCoursePriceUah();

  return createMultimaskingRecurringCheckout(
    userId,
    {
      planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
      regularMode: "monthly",
      priceUah,
      dateNextDaysFromNow: 1,
    },
    options,
  );
}
