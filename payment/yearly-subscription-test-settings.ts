import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingInt, getAppSettingString } from "../database/app-settings-queries";

export const YEARLY_SUBSCRIPTION_TEST_PRICE_FALLBACK_UAH = 5;
export const YEARLY_SUBSCRIPTION_TEST_PERIOD_DAYS_FALLBACK = 1;
export const YEARLY_SUBSCRIPTION_TEST_REGULAR_MODE_FALLBACK = "daily";

const ALLOWED_REGULAR_MODES = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "halfyearly",
  "yearly",
]);

export async function getYearlySubscriptionTestPriceUah(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.YEARLY_SUBSCRIPTION_TEST_PRICE_UAH,
    YEARLY_SUBSCRIPTION_TEST_PRICE_FALLBACK_UAH,
  );
  if (!Number.isFinite(n) || n < 1) {
    return YEARLY_SUBSCRIPTION_TEST_PRICE_FALLBACK_UAH;
  }
  return n;
}

export async function getYearlySubscriptionTestPeriodDays(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.YEARLY_SUBSCRIPTION_TEST_PERIOD_DAYS,
    YEARLY_SUBSCRIPTION_TEST_PERIOD_DAYS_FALLBACK,
  );
  if (!Number.isFinite(n) || n < 1) {
    return YEARLY_SUBSCRIPTION_TEST_PERIOD_DAYS_FALLBACK;
  }
  return n;
}

export async function getYearlySubscriptionTestRegularMode(): Promise<string> {
  const raw = await getAppSettingString(
    APP_SETTING_KEYS.YEARLY_SUBSCRIPTION_TEST_REGULAR_MODE,
  );
  const mode = (raw ?? YEARLY_SUBSCRIPTION_TEST_REGULAR_MODE_FALLBACK).trim().toLowerCase();
  if (!ALLOWED_REGULAR_MODES.has(mode)) {
    return YEARLY_SUBSCRIPTION_TEST_REGULAR_MODE_FALLBACK;
  }
  return mode;
}

/** Plan code for `/testauto` and related payment rows. */
export const YEARLY_SUBSCRIPTION_TEST_PLAN_CODE = "yearly_12m_test";
