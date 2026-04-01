// database/migrations.ts
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

async function runMigrations(): Promise<void> {
  try {
    await sequelize.authenticate();
    console.log("Connected to DB, running migrations...");
    await addEmailToTelegramUsers();
    await createEmailChangeLogsTable();
    await createRulesConsentsTable();
    await addTelegramUserEmailStateColumns();
    await backfillTelegramStateFromPreferencesJson();
    await addWayforpayOrderReferenceColumn();
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

void runMigrations();
