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
  /**
   * JSON-масив: `[{ "chatId": number, "type": string, "title": string }, ...]` —
   * канали й супергрупи зі знімка `debug/bot-telegram-chats.json`; оновлення: `debug/seed-telegram-chat-ids-to-app-settings.ts`.
   */
  TELEGRAM_BOT_CHATS_JSON: "telegram_bot_chats_json",
  /**
   * Кількість днів перебування в платних чатах (Masters / Chat PRO) від дати оплати / grant.
   * Оператор змінює лише значення в БД; див. TZ/user-control-crawler.txt.
   */
  PAID_CHAT_ACCESS_DAYS: "paid_chat_access_days",
  /**
   * Інтервал між циклами paid-chat janitor (секунди), `database/paid-chat-janitor-daemon.ts`.
   * Production: 7200 (2 год). Тест: 30 у БД або env `PAID_CHAT_JANITOR_INTERVAL_SECONDS` (має пріоритет).
   */
  PAID_CHAT_JANITOR_INTERVAL_SECONDS: "paid_chat_janitor_interval_seconds",
} as const;

export type AppSettingKey =
  (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];
