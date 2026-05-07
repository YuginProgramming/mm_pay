// database/migrations.ts
import { QueryTypes } from "sequelize";
import { sequelize } from "./db";

async function addEmailToTelegramUsers(): Promise<void> {
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS email VARCHAR(255);
  `);
  console.log(
    'Migration completed: "email" column on telegram_users (if it was missing).',
  );
}

async function createRulesConsentsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS rules_consents (
      id             SERIAL PRIMARY KEY,
      telegram_id    BIGINT NOT NULL,
      rules_version  VARCHAR(64) NOT NULL,
      rules_url      VARCHAR(512) NOT NULL,
      accepted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (telegram_id, rules_version)
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS rules_consents_telegram_id_idx
      ON rules_consents (telegram_id);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS rules_consents_accepted_at_idx
      ON rules_consents (accepted_at);
  `);
  console.log(
    'Migration completed: "rules_consents" table and indexes (if missing).',
  );
}

async function addTelegramUserEmailStateColumns(): Promise<void> {
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS awaiting_email BOOLEAN NOT NULL DEFAULT false;
  `);
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS email_change_from VARCHAR(255);
  `);
  console.log(
    'Migration completed: awaiting_email / email_change_from on telegram_users (if missing).',
  );
}

async function backfillTelegramStateFromPreferencesJson(): Promise<void> {
  await sequelize.query(`
    UPDATE telegram_users u
    SET awaiting_email = COALESCE((u.preferences->>'awaitingEmail')::boolean, false)
    WHERE u.preferences IS NOT NULL
      AND jsonb_typeof(u.preferences) = 'object'
      AND (u.preferences ? 'awaitingEmail');
  `);
  await sequelize.query(`
    UPDATE telegram_users u
    SET email_change_from = NULLIF(trim(u.preferences->>'emailChangeFrom'), '')
    WHERE u.preferences IS NOT NULL
      AND jsonb_typeof(u.preferences) = 'object'
      AND (u.preferences ? 'emailChangeFrom')
      AND length(trim(COALESCE(u.preferences->>'emailChangeFrom', ''))) > 0;
  `);
  await sequelize.query(`
    INSERT INTO rules_consents (telegram_id, rules_version, rules_url, accepted_at)
    SELECT
      u.telegram_id,
      trim(u.preferences->>'rulesVersion'),
      LEFT(trim(COALESCE(u.preferences->>'rulesUrl', '')), 512),
      (u.preferences->>'rulesAcceptedAt')::timestamptz
    FROM telegram_users u
    WHERE u.preferences IS NOT NULL
      AND jsonb_typeof(u.preferences) = 'object'
      AND u.preferences->>'rulesAcceptedAt' IS NOT NULL
      AND u.preferences->>'rulesVersion' IS NOT NULL
      AND length(trim(u.preferences->>'rulesVersion')) > 0
      AND length(trim(COALESCE(u.preferences->>'rulesUrl', ''))) > 0
    ON CONFLICT (telegram_id, rules_version) DO NOTHING;
  `);
  await sequelize.query(`
    UPDATE telegram_users u
    SET email = NULLIF(trim(u.preferences->>'email'), '')
    WHERE (u.email IS NULL OR u.email = '')
      AND u.preferences IS NOT NULL
      AND jsonb_typeof(u.preferences) = 'object'
      AND (u.preferences ? 'email')
      AND length(trim(COALESCE(u.preferences->>'email', ''))) > 0;
  `);
  await sequelize.query(`
    UPDATE telegram_users
    SET preferences = preferences
      - 'awaitingEmail' - 'emailChangeFrom' - 'rulesVersion' - 'rulesAcceptedAt'
      - 'rulesUrl' - 'email'
    WHERE preferences IS NOT NULL
      AND jsonb_typeof(preferences) = 'object';
  `);
  console.log(
    "Migration completed: backfill from preferences JSON (where present).",
  );
}

async function createEmailChangeLogsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS email_change_logs (
      id           SERIAL PRIMARY KEY,
      telegram_id  BIGINT NOT NULL,
      old_email    VARCHAR(255) NOT NULL,
      new_email    VARCHAR(255) NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS email_change_logs_telegram_id_idx
      ON email_change_logs (telegram_id);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS email_change_logs_created_at_idx
      ON email_change_logs (created_at);
  `);
  console.log(
    'Migration completed: "email_change_logs" table and indexes (if missing).',
  );
}

async function createAppSettingsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key     VARCHAR(128) PRIMARY KEY,
      setting_value   TEXT NOT NULL DEFAULT '',
      description_uk  TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    INSERT INTO app_settings (setting_key, setting_value, description_uk)
    VALUES
      (
        'multimasking_course_price_uah',
        '500',
        'Ціна доступу до навчального продукту MULTIMASKING (грн)'
      ),
      (
        'personal_consultation_price_uah',
        '',
        'Ціна персональної консультації (грн); порожньо, доки не запущено'
      ),
      (
        'consultation_client_price_uah',
        '1000',
        'Ціна персональної консультації для клієнта, грн'
      ),
      (
        'consultation_master_price_uah',
        '1000',
        'Ціна консультації для майстрів, грн'
      ),
      (
        'target_group_id',
        '',
        'Telegram ID цільової групи (формат -100…); задати вручну UPDATE'
      ),
      (
        'debug_telegram_user_id',
        '6956239629',
        'Telegram user id тестового акаунта для дебагу бота'
      ),
      (
        'kwiga_sync_interval_minutes',
        '30',
        'Інтервал повного синху KWIGA → БД (хв); env KWIGA_SYNC_INTERVAL_MINUTES перекриває, якщо заданий'
      ),
      (
        'telegram_bot_chats_json',
        '[]',
        'JSON: chatId/type/title чатів і каналів бота; заповнення: debug/seed-telegram-chat-ids-to-app-settings.ts'
      ),
      (
        'paid_chat_access_days',
        '30',
        'Днів у платних чатах (Masters / Chat PRO) від дати оплати / grant; зміна лише в БД'
      ),
      (
        'paid_chat_janitor_interval_seconds',
        '7200',
        'Інтервал між прогонами paid-chat janitor (сек): production 7200 (2 год); тест 30 у БД або env PAID_CHAT_JANITOR_INTERVAL_SECONDS'
      ),
      (
        'inline_menu_inactivity_timeout_seconds',
        '300',
        'Таймаут неактивності користувача перед показом inline-меню (сек); за замовчуванням 300 (5 хв)'
      )
    ON CONFLICT (setting_key) DO NOTHING;
  `);
  console.log(
    'Migration completed: "app_settings" table and default rows (if missing).',
  );
}

async function seedPaidChatJanitorIntervalSetting(): Promise<void> {
  await sequelize.query(`
    INSERT INTO app_settings (setting_key, setting_value, description_uk)
    VALUES (
      'paid_chat_janitor_interval_seconds',
      '7200',
      'Інтервал між прогонами paid-chat janitor (сек): production 7200 (2 год); тест 30 у БД або env PAID_CHAT_JANITOR_INTERVAL_SECONDS'
    )
    ON CONFLICT (setting_key) DO NOTHING;
  `);
  console.log(
    'Migration completed: paid_chat_janitor_interval_seconds seed (if missing).',
  );
}

async function seedDebugTelegramUserIdMastersSetting(): Promise<void> {
  await sequelize.query(`
    INSERT INTO app_settings (setting_key, setting_value, description_uk)
    VALUES (
      'debug_telegram_user_id_masters',
      '208159926',
      'Telegram user id другого тестового акаунта (ранг masters); debug/set-masters-rank-test-user.ts'
    )
    ON CONFLICT (setting_key) DO NOTHING;
  `);
  console.log(
    'Migration completed: debug_telegram_user_id_masters seed (if missing).',
  );
}

async function seedInlineMenuInactivityTimeoutSetting(): Promise<void> {
  await sequelize.query(`
    INSERT INTO app_settings (setting_key, setting_value, description_uk)
    VALUES (
      'inline_menu_inactivity_timeout_seconds',
      '300',
      'Таймаут неактивності користувача перед показом inline-меню (сек); за замовчуванням 300 (5 хв)'
    )
    ON CONFLICT (setting_key) DO NOTHING;
  `);
  console.log(
    "Migration completed: inline_menu_inactivity_timeout_seconds seed (if missing).",
  );
}

async function addTelegramUserKwigaRankColumns(): Promise<void> {
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS kwiga_audience_rank VARCHAR(32);
  `);
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS kwiga_access_row_count INTEGER;
  `);
  await sequelize.query(`
    ALTER TABLE telegram_users
    ADD COLUMN IF NOT EXISTS kwiga_rank_synced_at TIMESTAMPTZ;
  `);
  await sequelize.query(`
    UPDATE telegram_users u
    SET
      kwiga_audience_rank = NULLIF(TRIM(u.preferences->>'kwigaAudienceRank'), ''),
      kwiga_access_row_count = CASE
        WHEN (u.preferences->>'kwigaAccessRowCount') ~ '^[0-9]+$'
        THEN (u.preferences->>'kwigaAccessRowCount')::integer
        ELSE NULL
      END,
      kwiga_rank_synced_at = CASE
        WHEN u.preferences->>'kwigaRankSyncedAt' IS NOT NULL
          AND TRIM(u.preferences->>'kwigaRankSyncedAt') <> ''
        THEN (u.preferences->>'kwigaRankSyncedAt')::timestamptz
        ELSE NULL
      END
    WHERE u.preferences IS NOT NULL
      AND jsonb_typeof(u.preferences) = 'object'
      AND (u.preferences ? 'kwigaAudienceRank')
      AND u.kwiga_audience_rank IS NULL;
  `);
  console.log(
    'Migration completed: kwiga_audience_rank columns on telegram_users (if missing) + prefs backfill.',
  );
}

async function normalizeEmailsAndAddUniqueIndexes(): Promise<void> {
  await sequelize.query(`
    UPDATE telegram_users
    SET email = NULL
    WHERE email IS NOT NULL AND trim(email) = '';
  `);
  await sequelize.query(`
    UPDATE telegram_users
    SET email = lower(trim(email))
    WHERE email IS NOT NULL;
  `);
  await sequelize.query(`
    UPDATE contacts
    SET email = lower(trim(email));
  `);
  await sequelize.query(`
    DELETE FROM contacts c
    USING contacts k
    WHERE c.external_id = 9000002
      AND k.external_id <> 9000002
      AND c.email = k.email;
  `);

  const tgDups = await sequelize.query<{ email: string }>(
    `
    SELECT email FROM telegram_users
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING count(*) > 1
    LIMIT 5;
  `,
    { type: QueryTypes.SELECT },
  );
  if (tgDups.length > 0) {
    console.error("telegram_users duplicate emails:", tgDups);
    throw new Error(
      "Migration: виправте дублікати telegram_users.email вручну, потім перезапустіть міграцію.",
    );
  }

  const cDups = await sequelize.query<{ email: string }>(
    `
    SELECT email FROM contacts
    GROUP BY email
    HAVING count(*) > 1
    LIMIT 5;
  `,
    { type: QueryTypes.SELECT },
  );
  if (cDups.length > 0) {
    console.error("contacts duplicate emails:", cDups);
    throw new Error(
      "Migration: виправте дублікати contacts.email вручну, потім перезапустіть міграцію.",
    );
  }

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uq ON contacts (email);
  `);
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_email_uq
    ON telegram_users (email)
    WHERE email IS NOT NULL;
  `);
  console.log(
    'Migration completed: normalized emails + unique indexes on contacts(email) and telegram_users(email).',
  );
}

async function createPendingWayforpayTables(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pending_wayforpay_orders (
      order_reference VARCHAR(128) PRIMARY KEY,
      chat_id         TEXT NOT NULL,
      course_name     TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS pending_wayforpay_orders_created_at_idx
      ON pending_wayforpay_orders (created_at);
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS wayforpay_failure_notices (
      order_reference VARCHAR(128) PRIMARY KEY,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log(
    'Migration completed: pending_wayforpay_orders + wayforpay_failure_notices (if missing).',
  );
}

async function createWayforpayWebhookEventsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS wayforpay_webhook_events (
      id                SERIAL PRIMARY KEY,
      order_reference   VARCHAR(128) NOT NULL,
      transaction_status VARCHAR(64) NOT NULL,
      amount_raw        TEXT NOT NULL,
      currency          VARCHAR(8) NOT NULL,
      reason_code       VARCHAR(32),
      merchant_account  VARCHAR(128) NOT NULL,
      signature_valid   BOOLEAN NOT NULL,
      metadata_chat_id  TEXT,
      metadata_course_name TEXT,
      raw_payload       JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS wayforpay_webhook_events_order_ref_idx
      ON wayforpay_webhook_events (order_reference);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS wayforpay_webhook_events_created_at_idx
      ON wayforpay_webhook_events (created_at DESC);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS wayforpay_webhook_events_status_idx
      ON wayforpay_webhook_events (transaction_status);
  `);
  console.log(
    'Migration completed: wayforpay_webhook_events (WayForPay webhook audit log).',
  );
}

async function createWayforpayPendingNoticesTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS wayforpay_pending_notices (
      order_reference          VARCHAR(128) PRIMARY KEY,
      chat_id                  TEXT,
      first_pending_at         TIMESTAMPTZ,
      pending_notified_at      TIMESTAMPTZ,
      pending_reminder_sent_at TIMESTAMPTZ,
      pending_timeout_sent_at  TIMESTAMPTZ,
      terminal_status_at       TIMESTAMPTZ,
      terminal_status_value    VARCHAR(64),
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS wayforpay_pending_notices_active_idx
      ON wayforpay_pending_notices (terminal_status_at, first_pending_at);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS wayforpay_pending_notices_notified_idx
      ON wayforpay_pending_notices (pending_notified_at);
  `);
  console.log(
    'Migration completed: wayforpay_pending_notices (pending alert stages, if missing).',
  );
}

async function createPaidChatMemberStateTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS paid_chat_member_state (
      chat_id    VARCHAR(32) NOT NULL,
      user_id    VARCHAR(32) NOT NULL,
      status     VARCHAR(32) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, user_id)
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS paid_chat_member_state_chat_status_idx
      ON paid_chat_member_state (chat_id, status);
  `);
  console.log(
    'Migration completed: "paid_chat_member_state" (TZ chat_member облік, if missing).',
  );
}

async function createPaidChatJanitorAlertLogTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS paid_chat_janitor_alert_log (
      id             SERIAL PRIMARY KEY,
      telegram_id    VARCHAR(32) NOT NULL,
      alert_type     VARCHAR(64) NOT NULL,
      dedupe_key     VARCHAR(512) NOT NULL,
      contact_id     INTEGER,
      grant_end_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (telegram_id, alert_type, dedupe_key)
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS paid_chat_janitor_alert_log_created_at_idx
      ON paid_chat_janitor_alert_log (created_at DESC);
  `);
  console.log(
    'Migration completed: "paid_chat_janitor_alert_log" (§7.6 idempotency, if missing).',
  );
}

async function addWayforpayOrderReferenceColumn(): Promise<void> {
  await sequelize.query(`
    ALTER TABLE contact_product_access
    ADD COLUMN IF NOT EXISTS wayforpay_order_reference VARCHAR(128);
  `);
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS contact_product_access_wfp_order_ref_uq
    ON contact_product_access (wayforpay_order_reference)
    WHERE wayforpay_order_reference IS NOT NULL;
  `);
  console.log(
    'Migration completed: wayforpay_order_reference on contact_product_access (if missing).',
  );
}

async function createSubscriptionCoreTables(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id            SERIAL PRIMARY KEY,
      code          VARCHAR(64) NOT NULL UNIQUE,
      title         VARCHAR(255),
      duration_days INTEGER NOT NULL,
      price         NUMERIC(10, 2) NOT NULL,
      currency      VARCHAR(8) NOT NULL DEFAULT 'UAH',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id                           SERIAL PRIMARY KEY,
      user_id                      VARCHAR(64) NOT NULL,
      plan_id                      INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      status                       VARCHAR(32) NOT NULL DEFAULT 'active',
      start_at                     TIMESTAMPTZ NOT NULL,
      end_at                       TIMESTAMPTZ NOT NULL,
      last_payment_order_reference VARCHAR(128),
      created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS user_subscriptions_user_status_end_idx
      ON user_subscriptions (user_id, status, end_at);
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS subscription_payment_orders (
      id              SERIAL PRIMARY KEY,
      order_reference VARCHAR(128) NOT NULL UNIQUE,
      user_id         VARCHAR(64) NOT NULL,
      plan_id         INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      status          VARCHAR(32) NOT NULL,
      amount          NUMERIC(10, 2) NOT NULL,
      currency        VARCHAR(8) NOT NULL DEFAULT 'UAH',
      provider        VARCHAR(32) NOT NULL DEFAULT 'wayforpay',
      terminal_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS subscription_payment_orders_user_plan_status_idx
      ON subscription_payment_orders (user_id, plan_id, status);
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_orders_active_uq
      ON subscription_payment_orders (user_id, plan_id)
      WHERE status IN ('created', 'pending', 'processing', 'suspended');
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS subscription_flow_sessions (
      id              SERIAL PRIMARY KEY,
      user_id         VARCHAR(64) NOT NULL,
      flow_type       VARCHAR(32) NOT NULL,
      step            VARCHAR(64) NOT NULL,
      order_reference VARCHAR(128),
      expires_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS subscription_flow_sessions_user_idx
      ON subscription_flow_sessions (user_id);
  `);

  console.log(
    "Migration completed: subscription core tables/indexes (if missing).",
  );
}

async function createConsultationPaymentOrdersTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS consultation_payment_orders (
      id                  SERIAL PRIMARY KEY,
      order_reference     VARCHAR(128) NOT NULL UNIQUE,
      telegram_user_id    VARCHAR(64) NOT NULL,
      telegram_chat_id    VARCHAR(64) NOT NULL,
      product_code        VARCHAR(64) NOT NULL,
      status              VARCHAR(32) NOT NULL,
      amount              NUMERIC(10, 2) NOT NULL,
      currency            VARCHAR(8) NOT NULL DEFAULT 'UAH',
      provider            VARCHAR(32) NOT NULL DEFAULT 'wayforpay',
      checkout_url        TEXT,
      terminal_at         TIMESTAMPTZ,
      failure_reason_code VARCHAR(32),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS consultation_payment_orders_user_product_status_idx
      ON consultation_payment_orders (telegram_user_id, product_code, status);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS consultation_payment_orders_chat_idx
      ON consultation_payment_orders (telegram_chat_id);
  `);
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS consultation_payment_orders_active_uq
      ON consultation_payment_orders (telegram_user_id, product_code)
      WHERE status IN ('created', 'pending', 'processing', 'suspended');
  `);
  console.log(
    "Migration completed: consultation_payment_orders table/indexes (if missing).",
  );
}

async function seedConsultationPriceSettings(): Promise<void> {
  await sequelize.query(`
    INSERT INTO app_settings (setting_key, setting_value, description_uk)
    VALUES
      (
        'consultation_client_price_uah',
        '1000',
        'Ціна персональної консультації для клієнта, грн'
      ),
      (
        'consultation_master_price_uah',
        '1000',
        'Ціна консультації для майстрів, грн'
      )
    ON CONFLICT (setting_key) DO NOTHING;
  `);
  console.log(
    "Migration completed: consultation price settings seed (if missing).",
  );
}

async function seedSubscriptionMonthlyPlan(): Promise<void> {
  await sequelize.query(`
    INSERT INTO subscription_plans (
      code,
      title,
      duration_days,
      price,
      currency,
      is_active
    )
    VALUES (
      'monthly_1m',
      'Підписка на 1 місяць',
      30,
      500.00,
      'UAH',
      true
    )
    ON CONFLICT (code) DO NOTHING;
  `);
  console.log("Migration completed: subscription_plans seed monthly_1m.");
}

async function addSubscriptionPaymentOrderCheckoutUrlColumn(): Promise<void> {
  await sequelize.query(`
    ALTER TABLE subscription_payment_orders
    ADD COLUMN IF NOT EXISTS checkout_url TEXT;
  `);
  console.log(
    "Migration completed: checkout_url on subscription_payment_orders (if missing).",
  );
}

async function createSubscriptionRenewalReminderLogTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS subscription_renewal_reminder_log (
      id                  SERIAL PRIMARY KEY,
      user_id             VARCHAR(64) NOT NULL,
      subscription_id     INTEGER NOT NULL,
      alert_type          VARCHAR(64) NOT NULL,
      dedupe_key          VARCHAR(512) NOT NULL,
      subscription_end_at TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, alert_type, dedupe_key)
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS subscription_renewal_reminder_log_created_at_idx
      ON subscription_renewal_reminder_log (created_at DESC);
  `);
  console.log(
    "Migration completed: subscription_renewal_reminder_log (if missing).",
  );
}

async function runMigrations(): Promise<void> {
  try {
    await sequelize.authenticate();
    console.log("Connected to DB, running migrations...");
    await addEmailToTelegramUsers();
    await createEmailChangeLogsTable();
    await createRulesConsentsTable();
    await addTelegramUserEmailStateColumns();
    await backfillTelegramStateFromPreferencesJson();
    await createAppSettingsTable();
    await addTelegramUserKwigaRankColumns();
    await normalizeEmailsAndAddUniqueIndexes();
    await createPendingWayforpayTables();
    await createWayforpayWebhookEventsTable();
    await createWayforpayPendingNoticesTable();
    await addWayforpayOrderReferenceColumn();
    await createSubscriptionCoreTables();
    await createConsultationPaymentOrdersTable();
    await addSubscriptionPaymentOrderCheckoutUrlColumn();
    await createSubscriptionRenewalReminderLogTable();
    await seedSubscriptionMonthlyPlan();
    await createPaidChatJanitorAlertLogTable();
    await createPaidChatMemberStateTable();
    await seedPaidChatJanitorIntervalSetting();
    await seedDebugTelegramUserIdMastersSetting();
    await seedInlineMenuInactivityTimeoutSetting();
    await seedConsultationPriceSettings();
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

void runMigrations();
