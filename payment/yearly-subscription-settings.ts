import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingInt } from "../database/app-settings-queries";

export const YEARLY_SUBSCRIPTION_PRICE_FALLBACK_UAH = 4800;
export const YEARLY_SUBSCRIPTION_ACCESS_DAYS_FALLBACK = 365;

export async function getYearlySubscriptionPriceUah(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.YEARLY_SUBSCRIPTION_PRICE_UAH,
    YEARLY_SUBSCRIPTION_PRICE_FALLBACK_UAH,
  );
  if (!Number.isFinite(n) || n < 1) {
    return YEARLY_SUBSCRIPTION_PRICE_FALLBACK_UAH;
  }
  return n;
}

export async function getYearlySubscriptionAccessDays(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.YEARLY_SUBSCRIPTION_ACCESS_DAYS,
    YEARLY_SUBSCRIPTION_ACCESS_DAYS_FALLBACK,
  );
  if (!Number.isFinite(n) || n < 1) {
    return YEARLY_SUBSCRIPTION_ACCESS_DAYS_FALLBACK;
  }
  return n;
}
