const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

/**
 * Subscription rollout flags.
 * Defaults are intentionally false to keep current behavior unchanged
 * until rollout steps explicitly enable them.
 */
export const subscriptionFlags = {
  subscriptionModeEnabled: toBool(
    process.env.SUBSCRIPTION_MODE_ENABLED,
    false,
  ),
  subscriptionReturnFlowEnabled: toBool(
    process.env.SUBSCRIPTION_RETURN_FLOW_ENABLED,
    false,
  ),
  subscriptionRenewalJobsEnabled: toBool(
    process.env.SUBSCRIPTION_RENEWAL_JOBS_ENABLED,
    false,
  ),
} as const;

export type SubscriptionFlags = typeof subscriptionFlags;
