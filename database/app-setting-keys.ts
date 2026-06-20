/**
 * Ключі рядків у таблиці app_settings.
 * Додавайте нові ключі тут і (за потреби) у міграції seed.
 */
export const APP_SETTING_KEYS = {
  /** Ціна доступу до навчального продукту MULTIMASKING, грн */
  MULTIMASKING_COURSE_PRICE_UAH: "multimasking_course_price_uah",
  /** Ціна персональної консультації, грн (майбутнє) */
  PERSONAL_CONSULTATION_PRICE_UAH: "personal_consultation_price_uah",
  /** Ціна персональної консультації для клієнта, грн */
  CONSULTATION_CLIENT_PRICE_UAH: "consultation_client_price_uah",
  /** Ціна консультації для майстрів, грн */
  CONSULTATION_MASTER_PRICE_UAH: "consultation_master_price_uah",
  /** Telegram ID групи (наприклад -100…) */
  TARGET_GROUP_ID: "target_group_id",
  /**
   * JSON-масив Telegram user id, яким дозволено публікувати через poster bot;
   * див. TZ/telegram-post-publisher.md.
   */
  POSTER_AUTHORIZED_USER_IDS: "poster_authorized_user_ids",
  /** Telegram user id тестового акаунта для дебагу (читає debug/add-testuser.ts) */
  DEBUG_TELEGRAM_USER_ID: "debug_telegram_user_id",
  /**
   * Другий тестовий акаунт (наприклад для рангу masters); читає debug/set-masters-rank-test-user.ts
   */
  DEBUG_TELEGRAM_USER_ID_MASTERS: "debug_telegram_user_id_masters",
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
  /**
   * Таймаут неактивності користувача перед показом inline-меню в text zone (секунди).
   * За замовчуванням: 300 (5 хв).
   */
  INLINE_MENU_INACTIVITY_TIMEOUT_SECONDS:
    "inline_menu_inactivity_timeout_seconds",
  /** `/subauto`: сума Purchase з regular, грн */
  SUBSCRIPTION_AUTO_PRICE_UAH: "subscription_auto_price_uah",
  /** `/subauto`: днів доступу після кожної успішної оплати */
  SUBSCRIPTION_AUTO_ACCESS_DAYS: "subscription_auto_access_days",
  /** `/subauto`: WayForPay regularMode (напр. daily, monthly) */
  SUBSCRIPTION_AUTO_REGULAR_MODE: "subscription_auto_regular_mode",
  /** `/subauto`: кількість регулярних списань (regularCount) */
  SUBSCRIPTION_AUTO_REGULAR_COUNT: "subscription_auto_regular_count",
  /** Річна підписка MULTIMASKING: сума Purchase з regular, грн */
  YEARLY_SUBSCRIPTION_PRICE_UAH: "yearly_subscription_price_uah",
  /** Річна підписка MULTIMASKING: днів доступу після кожної успішної оплати */
  YEARLY_SUBSCRIPTION_ACCESS_DAYS: "yearly_subscription_access_days",
} as const;

export type AppSettingKey =
  (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];
