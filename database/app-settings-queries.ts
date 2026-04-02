import { AppSetting } from "./AppSetting";
import type { AppSettingKey } from "./app-setting-keys";

export async function getAppSettingRaw(key: AppSettingKey): Promise<string | null> {
  const row = await AppSetting.findByPk(key);
  if (!row) return null;
  const v = row.settingValue.trim();
  return v === "" ? null : row.settingValue;
}

/** Ціле число або fallback, якщо рядок порожній / некоректний. */
export async function getAppSettingInt(
  key: AppSettingKey,
  fallback: number,
): Promise<number> {
  const raw = await getAppSettingRaw(key);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Рядок або null якщо не задано. */
export async function getAppSettingString(
  key: AppSettingKey,
): Promise<string | null> {
  return getAppSettingRaw(key);
}
