/**
 * Очищає більшість таблиць для нової тестової ітерації.
 *
 * ЧИСТИТЬ (повністю):
 * 1) Subscription Tables
 *    - subscription_flow_sessions
 *    - subscription_renewal_reminder_log
 *    - user_subscriptions
 *    - subscription_payment_orders
 *    - subscription_plans
 *
 * 2) Payment (WayForPay) Tables
 *    - wayforpay_pending_notices
 *    - wayforpay_webhook_events
 *    - wayforpay_failure_notices
 *    - pending_wayforpay_orders
 *
 * 3) Telegram User & Compliance Tables
 *    - rules_consents
 *    - email_change_logs
 *    - telegram_users
 *
 * 4) Paid Chat Operations Tables
 *    - paid_chat_janitor_alert_log
 *    - paid_chat_member_state
 *
 * ЗБЕРІГАЄ (не чіпає):
 * - System Configuration Tables:
 *   - app_settings
 * - KWIGA / CRM Info Tables:
 *   - contacts
 *   - kwiga_products
 *   - contact_product_access
 *
 * Безпека:
 * - За замовчуванням лише показує план (dry-run).
 * - Для виконання додайте прапорець --yes
 *
 * Запуск:
 *   npx ts-node debug/clean-majority-tables.ts
 *   npx ts-node debug/clean-majority-tables.ts --yes
 */
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { sequelize } from "../database/db";

const TABLES_TO_CLEAN: readonly string[] = [
  // Paid chat
  "paid_chat_janitor_alert_log",
  "paid_chat_member_state",
  // Telegram + compliance
  "rules_consents",
  "email_change_logs",
  "telegram_users",
  // WayForPay
  "wayforpay_pending_notices",
  "wayforpay_webhook_events",
  "wayforpay_failure_notices",
  "pending_wayforpay_orders",
  // Subscription
  "subscription_flow_sessions",
  "subscription_renewal_reminder_log",
  "user_subscriptions",
  "subscription_payment_orders",
  "subscription_plans",
];

const TABLES_TO_PRESERVE: readonly string[] = [
  "app_settings",
  "contacts",
  "kwiga_products",
  "contact_product_access",
];

type CountRow = { count: string };

function hasYesFlag(): boolean {
  return process.argv.includes("--yes");
}

async function getTableCount(tableName: string): Promise<number> {
  const sql = `SELECT COUNT(*)::text AS count FROM "${tableName}";`;
  const rows = (await sequelize.query<CountRow>(sql, {
    type: QueryTypes.SELECT,
  })) as CountRow[];
  return Number(rows[0]?.count ?? "0");
}

async function printCounts(title: string, tables: readonly string[]): Promise<void> {
  console.log(`\n${title}`);
  for (const tableName of tables) {
    const count = await getTableCount(tableName);
    console.log(`- ${tableName}: ${count}`);
  }
}

async function cleanTables(): Promise<void> {
  for (const tableName of TABLES_TO_CLEAN) {
    await sequelize.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`);
  }
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const confirm = hasYesFlag();

  console.log("=== Clean majority tables script ===");
  console.log("Mode:", confirm ? "EXECUTE (--yes)" : "DRY-RUN (no changes)");
  console.log("\nWill CLEAN:");
  TABLES_TO_CLEAN.forEach((t) => console.log(`- ${t}`));
  console.log("\nWill PRESERVE:");
  TABLES_TO_PRESERVE.forEach((t) => console.log(`- ${t}`));

  await printCounts("Counts before:", [...TABLES_TO_CLEAN, ...TABLES_TO_PRESERVE]);

  if (!confirm) {
    console.log("\nDry-run finished. Re-run with --yes to execute cleanup.");
    return;
  }

  await cleanTables();

  await printCounts("Counts after:", [...TABLES_TO_CLEAN, ...TABLES_TO_PRESERVE]);
  console.log("\nDone.");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => sequelize.close());
