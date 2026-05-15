/**
 * Очищає таблиці консультаційного бота для тесту з нуля.
 *
 * ЧИСТИТЬ (повністю):
 * - consultation_intake_sessions
 * - consultation_cases
 * - consultation_payment_orders
 *
 * Не чіпає: app_settings, telegram_users, WayForPay, акаунт-бот тощо.
 * Теми в Telegram-форумі менеджера видаліть вручну в клієнті.
 *
 * Безпека:
 * - За замовчуванням лише dry-run (показує лічильники).
 * - Для виконання: --yes
 *
 * Запуск:
 *   npx ts-node debug/clean-consultation-tables.ts
 *   npx ts-node debug/clean-consultation-tables.ts --yes
 */
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { sequelize } from "../database/db";

const TABLES_TO_CLEAN: readonly string[] = [
  "consultation_intake_sessions",
  "consultation_cases",
  "consultation_payment_orders",
];

type CountRow = { count: string };

function hasYesFlag(): boolean {
  return process.argv.includes("--yes");
}

async function getTableCount(tableName: string): Promise<number> {
  const rows = (await sequelize.query<CountRow>(
    `SELECT COUNT(*)::text AS count FROM "${tableName}";`,
    { type: QueryTypes.SELECT },
  )) as CountRow[];
  return Number(rows[0]?.count ?? "0");
}

async function printCounts(title: string): Promise<void> {
  console.log(`\n${title}`);
  for (const tableName of TABLES_TO_CLEAN) {
    const count = await getTableCount(tableName);
    console.log(`- ${tableName}: ${count}`);
  }
}

async function cleanTables(): Promise<void> {
  const list = TABLES_TO_CLEAN.map((t) => `"${t}"`).join(", ");
  await sequelize.query(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`,
  );
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const confirm = hasYesFlag();

  console.log("=== Clean consultation tables ===");
  console.log("Mode:", confirm ? "EXECUTE (--yes)" : "DRY-RUN (no changes)");
  console.log("\nWill CLEAN:");
  TABLES_TO_CLEAN.forEach((t) => console.log(`- ${t}`));

  await printCounts("Counts before:");

  if (!confirm) {
    console.log("\nDry-run finished. Re-run with --yes to execute cleanup.");
    return;
  }

  await cleanTables();

  await printCounts("Counts after:");
  console.log("\nDone. Restart the consultation bot to clear in-memory intake sessions.");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => sequelize.close());
