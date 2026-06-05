import {
  createMultimaskingRecurringCheckout,
  type MultimaskingRecurringCheckoutResult,
} from "./multimasking-recurring-checkout.service";
import {
  getSubscriptionAutoPriceUah,
  getSubscriptionAutoRegularCount,
  getSubscriptionAutoRegularMode,
} from "./subscription-auto-settings";
import { SUBSCRIPTION_AUTO_PLAN_CODE } from "./subscription-plan-codes";

export type SubscriptionAutoCheckoutResult = MultimaskingRecurringCheckoutResult;

/** `/subauto` — тестовий preset (daily, тестова ціна, optional regularCount). */
export async function createSubscriptionAutoCheckout(
  userId: string,
  options?: { forceNew?: boolean },
): Promise<SubscriptionAutoCheckoutResult> {
  const [priceUah, regularMode, regularCount] = await Promise.all([
    getSubscriptionAutoPriceUah(),
    getSubscriptionAutoRegularMode(),
    getSubscriptionAutoRegularCount(),
  ]);

  return createMultimaskingRecurringCheckout(
    userId,
    {
      planCode: SUBSCRIPTION_AUTO_PLAN_CODE,
      regularMode,
      priceUah,
      regularCount,
    },
    options,
  );
}
