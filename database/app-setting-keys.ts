/**
 * Ключі рядків у таблиці app_settings.
 * Додавайте нові ключі тут і (за потреби) у міграції seed.
 */
export const APP_SETTING_KEYS = {
  /** Ціна доступу до навчального продукту MULTIMASKING, грн */
  MULTIMASKING_COURSE_PRICE_UAH: "multimasking_course_price_uah",
  /** Ціна персональної консультації, грн (майбутнє) */
  PERSONAL_CONSULTATION_PRICE_UAH: "personal_consultation_price_uah",
  /** Telegram ID групи (наприклад -100…) */
  TARGET_GROUP_ID: "target_group_id",
  /** Telegram user id тестового акаунта для дебагу (читає debug/add-testuser.ts) */
  DEBUG_TELEGRAM_USER_ID: "debug_telegram_user_id",
  /**
   * Інтервал повного синху KWIGA → БД (хвилини), `database/kwiga-sync-daemon.ts`.
   * У таблиці ключ — `kwiga_sync_interval_minutes`; env `KWIGA_SYNC_INTERVAL_MINUTES` має пріоритет, якщо заданий.
   */
  KWIGA_SYNC_INTERVAL_MINUTES: "kwiga_sync_interval_minutes",
} as const;

export type AppSettingKey =
  (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];
