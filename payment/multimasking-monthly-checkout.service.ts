import { getPaidChatAccessDays } from "../database/app-settings-queries";
import {
  createMultimaskingRecurringCheckout,
  type MultimaskingRecurringCheckoutResult,
} from "./multimasking-recurring-checkout.service";
import { getMultimaskingCoursePriceUah } from "./multimasking-price";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "./subscription-plan-codes";

export type MultimaskingMonthlyCheckoutResult = MultimaskingRecurringCheckoutResult;

/** Кількість щомісячних списань WayForPay (regularCount); без dateEnd. */
export const MONTHLY_SUBSCRIPTION_REGULAR_COUNT = 36;

/**
 * Prod preset: `regularMode=monthly`, ціна з `multimasking_course_price_uah`,
 * `dateNext` = +`paid_chat_access_days` UTC (типово 30), `regularCount` = 36.
 */
export async function createMultimaskingMonthlyCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<MultimaskingMonthlyCheckoutResult> {
  const [priceUah, accessDays] = await Promise.all([
    getMultimaskingCoursePriceUah(),
    getPaidChatAccessDays(),
  ]);

  return createMultimaskingRecurringCheckout(
    userId,
    {
      planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
      regularMode: "monthly",
      priceUah,
      dateNextDaysFromNow: accessDays,
      regularCount: MONTHLY_SUBSCRIPTION_REGULAR_COUNT,
    },
    options,
  );
}
