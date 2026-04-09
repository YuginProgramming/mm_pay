import { APP_SETTING_KEYS } from "./app-setting-keys";
import { AppSetting } from "./AppSetting";
import type { AppSettingKey } from "./app-setting-keys";

/** Env: короткий TTL платних чатів у хвилинах для стейджингу/E2E; див. TZ/user-control-crawler.txt. */
export const PAID_CHAT_ACCESS_TEST_MINUTES_ENV = "PAID_CHAT_ACCESS_TEST_MINUTES" as const;

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

const PAID_CHAT_ACCESS_DAYS_DEFAULT = 30;
const PAID_CHAT_ACCESS_DAYS_MIN = 1;

/**
 * Дні перебування в платних чатах (Masters / Chat PRO) від дати оплати / grant.
 * Джерело: `app_settings.paid_chat_access_days`; оператор змінює число в БД.
 */
export async function getPaidChatAccessDays(): Promise<number> {
  const n = await getAppSettingInt(
    APP_SETTING_KEYS.PAID_CHAT_ACCESS_DAYS,
    PAID_CHAT_ACCESS_DAYS_DEFAULT,
  );
  if (!Number.isFinite(n) || n < PAID_CHAT_ACCESS_DAYS_MIN) {
    return PAID_CHAT_ACCESS_DAYS_DEFAULT;
  }
  return n;
}

/**
 * Якщо задано валідне `PAID_CHAT_ACCESS_TEST_MINUTES` у середовищі — хвилини замість днів для тестового режиму.
 * У production не задавати (поверне null).
 */
export function getPaidChatAccessTestMinutesFromEnv(): number | null {
  const raw = process.env[PAID_CHAT_ACCESS_TEST_MINUTES_ENV]?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Env перекриває БД (зручно для тесту: 30 сек), див. `PAID_CHAT_JANITOR_INTERVAL_SECONDS` у app_settings. */
export const PAID_CHAT_JANITOR_INTERVAL_SECONDS_ENV =
  "PAID_CHAT_JANITOR_INTERVAL_SECONDS" as const;

const PAID_CHAT_JANITOR_DEFAULT_SECONDS = 7200;
const PAID_CHAT_JANITOR_MIN_SECONDS = 1;

function readPaidChatJanitorIntervalMsFromEnv(): number | null {
  const raw = process.env[PAID_CHAT_JANITOR_INTERVAL_SECONDS_ENV]?.trim();
  if (!raw) {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < PAID_CHAT_JANITOR_MIN_SECONDS) {
    console.warn(
      `[app-settings] invalid ${PAID_CHAT_JANITOR_INTERVAL_SECONDS_ENV}=${JSON.stringify(raw)}, falling back to app_settings`,
    );
    return null;
  }
  return n * 1000;
}

/**
 * Пауза між прогонами janitor (мс): env `PAID_CHAT_JANITOR_INTERVAL_SECONDS` (сек), інакше
 * `app_settings.paid_chat_janitor_interval_seconds` (дефолт 7200 = 2 год).
 */
export async function resolvePaidChatJanitorIntervalMs(): Promise<number> {
  const fromEnv = readPaidChatJanitorIntervalMsFromEnv();
  if (fromEnv != null) {
    return fromEnv;
  }
  const sec = await getAppSettingInt(
    APP_SETTING_KEYS.PAID_CHAT_JANITOR_INTERVAL_SECONDS,
    PAID_CHAT_JANITOR_DEFAULT_SECONDS,
  );
  const safe =
    Number.isFinite(sec) && sec >= PAID_CHAT_JANITOR_MIN_SECONDS
      ? sec
      : PAID_CHAT_JANITOR_DEFAULT_SECONDS;
  return safe * 1000;
}
