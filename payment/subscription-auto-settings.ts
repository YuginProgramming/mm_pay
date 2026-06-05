import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingInt, getAppSettingString } from "../database/app-settings-queries";

export const SUBSCRIPTION_AUTO_PRICE_FALLBACK_UAH = 5;
export const SUBSCRIPTION_AUTO_ACCESS_DAYS_FALLBACK = 1;
export const SUBSCRIPTION_AUTO_REGULAR_MODE_FALLBACK = "daily";
export const SUBSCRIPTION_AUTO_REGULAR_COUNT_FALLBACK = 5;

const ALLOWED_REGULAR_MODES = new Set([
  "once",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "halfyearly",
  "yearly",
]);

/** Plan code для WayForPay Purchase + regularApi (команда /subauto). */
export const SUBSCRIPTION_AUTO_PLAN_CODE = "subscription_auto";

export async function getSubscriptionAutoPriceUah(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.SUBSCRIPTION_AUTO_PRICE_UAH,
    SUBSCRIPTION_AUTO_PRICE_FALLBACK_UAH,
  );
  if (!Number.isFinite(n) || n < 1) {
    return SUBSCRIPTION_AUTO_PRICE_FALLBACK_UAH;
  }
  return n;
}

export async function getSubscriptionAutoAccessDays(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.SUBSCRIPTION_AUTO_ACCESS_DAYS,
    SUBSCRIPTION_AUTO_ACCESS_DAYS_FALLBACK,
  );
  if (!Number.isFinite(n) || n < 1) {
    return SUBSCRIPTION_AUTO_ACCESS_DAYS_FALLBACK;
  }
  return n;
}

export async function getSubscriptionAutoRegularMode(): Promise<string> {
  const raw = await getAppSettingString(APP_SETTING_KEYS.SUBSCRIPTION_AUTO_REGULAR_MODE);
  const mode = (raw ?? SUBSCRIPTION_AUTO_REGULAR_MODE_FALLBACK).trim().toLowerCase();
  if (!ALLOWED_REGULAR_MODES.has(mode)) {
    return SUBSCRIPTION_AUTO_REGULAR_MODE_FALLBACK;
  }
  return mode;
}

export async function getSubscriptionAutoRegularCount(): Promise<number | null> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.SUBSCRIPTION_AUTO_REGULAR_COUNT,
    SUBSCRIPTION_AUTO_REGULAR_COUNT_FALLBACK,
  );
  if (!Number.isFinite(n) || n < 1) {
    return SUBSCRIPTION_AUTO_REGULAR_COUNT_FALLBACK;
  }
  return n;
}
