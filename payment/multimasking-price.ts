import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingInt } from "../database/app-settings-queries";

/** Якщо в app_settings немає ключа або значення некоректне. */
export const MULTIMASKING_COURSE_PRICE_FALLBACK_UAH = 500;

export async function getMultimaskingCoursePriceUah(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.MULTIMASKING_COURSE_PRICE_UAH,
    MULTIMASKING_COURSE_PRICE_FALLBACK_UAH,
  );
  if (!Number.isFinite(n) || n < 1) {
    return MULTIMASKING_COURSE_PRICE_FALLBACK_UAH;
  }
  return n;
}
