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
const INLINE_MENU_INACTIVITY_TIMEOUT_DEFAULT_SECONDS = 300;
const INLINE_MENU_INACTIVITY_TIMEOUT_MIN_SECONDS = 1;
const CONSULTATION_PRICE_DEFAULT_UAH = 1000;

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

/**
 * Таймаут неактивності користувача перед показом inline-меню (сек).
 * Джерело: `app_settings.inline_menu_inactivity_timeout_seconds`; дефолт 300.
 */
export async function getInlineMenuInactivityTimeoutSeconds(): Promise<number> {
  const sec = await getAppSettingInt(
    APP_SETTING_KEYS.INLINE_MENU_INACTIVITY_TIMEOUT_SECONDS,
    INLINE_MENU_INACTIVITY_TIMEOUT_DEFAULT_SECONDS,
  );
  if (
    !Number.isFinite(sec) ||
    sec < INLINE_MENU_INACTIVITY_TIMEOUT_MIN_SECONDS
  ) {
    return INLINE_MENU_INACTIVITY_TIMEOUT_DEFAULT_SECONDS;
  }
  return sec;
}

function normalizePositiveIntOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function getConsultationClientPriceUah(): Promise<number> {
  const value = await getAppSettingInt(
    APP_SETTING_KEYS.CONSULTATION_CLIENT_PRICE_UAH,
    await getAppSettingInt(
      APP_SETTING_KEYS.PERSONAL_CONSULTATION_PRICE_UAH,
      CONSULTATION_PRICE_DEFAULT_UAH,
    ),
  );
  return normalizePositiveIntOrFallback(value, CONSULTATION_PRICE_DEFAULT_UAH);
}

export async function getConsultationMasterPriceUah(): Promise<number> {
  const value = await getAppSettingInt(
    APP_SETTING_KEYS.CONSULTATION_MASTER_PRICE_UAH,
    await getAppSettingInt(
      APP_SETTING_KEYS.PERSONAL_CONSULTATION_PRICE_UAH,
      CONSULTATION_PRICE_DEFAULT_UAH,
    ),
  );
  return normalizePositiveIntOrFallback(value, CONSULTATION_PRICE_DEFAULT_UAH);
}

/** Telegram id групи Masters для poster bot (`app_settings.target_group_id`). */
export async function getPosterTargetGroupId(): Promise<string | null> {
  return getAppSettingString(APP_SETTING_KEYS.TARGET_GROUP_ID);
}

/** Telegram id групи Chat PRO для poster bot (`app_settings.poster_pro_group_id`). */
export async function getPosterProGroupId(): Promise<string | null> {
  return getAppSettingString(APP_SETTING_KEYS.POSTER_PRO_GROUP_ID);
}

function parsePosterAuthorizedUserIdsJson(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[app-settings] invalid poster_authorized_user_ids JSON, using empty list",
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn(
      "[app-settings] poster_authorized_user_ids is not a JSON array, using empty list",
    );
    return [];
  }
  const ids: number[] = [];
  for (const item of parsed) {
    const n =
      typeof item === "number"
        ? item
        : typeof item === "string"
          ? Number.parseInt(item.trim(), 10)
          : Number.NaN;
    if (Number.isFinite(n) && n > 0) {
      ids.push(n);
    }
  }
  return ids;
}

/**
 * Telegram user ids, яким дозволено poster bot (створення та публікація постів).
 * Джерело: `app_settings.poster_authorized_user_ids` (JSON-масив).
 */
export async function getPosterAuthorizedUserIds(): Promise<number[]> {
  const raw = await getAppSettingRaw(APP_SETTING_KEYS.POSTER_AUTHORIZED_USER_IDS);
  if (raw == null) {
    return [];
  }
  return parsePosterAuthorizedUserIdsJson(raw);
}
