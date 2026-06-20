/** Тестовий Purchase + regular (`/subauto`). */
export const SUBSCRIPTION_AUTO_PLAN_CODE = "subscription_auto";

/** Прод-потік `/payment` — щомісячна підписка WayForPay. */
export const MONTHLY_SUBSCRIPTION_PLAN_CODE = "monthly_1m";

/** Прод-потік `/payment` — річна підписка WayForPay. */
export const YEARLY_SUBSCRIPTION_PLAN_CODE = "yearly_12m";

export function isSubscriptionAutoPlanCode(planCode: string | null | undefined): boolean {
  return planCode === SUBSCRIPTION_AUTO_PLAN_CODE;
}

export function isMonthlySubscriptionPlanCode(planCode: string | null | undefined): boolean {
  return planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE;
}

export function isYearlySubscriptionPlanCode(planCode: string | null | undefined): boolean {
  return planCode === YEARLY_SUBSCRIPTION_PLAN_CODE;
}

/** Purchase + regular для MULTIMASKING (webhook routing: ≠ legacy one-shot). */
export function isMultimaskingRecurringPlanCode(planCode: string | null | undefined): boolean {
  return (
    isSubscriptionAutoPlanCode(planCode) ||
    isMonthlySubscriptionPlanCode(planCode) ||
    isYearlySubscriptionPlanCode(planCode)
  );
}
