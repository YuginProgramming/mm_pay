import "dotenv/config";
import { sequelize } from "../../database/db";
import { reconcileConsultationCaseMappings } from "../../payment/consultation-payment.service";

function hasYesFlag(): boolean {
  return process.argv.includes("--yes");
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const fix = hasYesFlag();

  console.log("=== reconcile-consultation-case-mappings ===");
  console.log("Mode:", fix ? "EXECUTE (--yes)" : "DRY-RUN (no changes)");

  const result = await reconcileConsultationCaseMappings({ fix });

  console.log("\nSummary:");
  console.log(`- scanned: ${result.scanned}`);
  console.log(`- issues: ${result.issues}`);
  console.log(`- fixed: ${result.fixed}`);

  if (result.rows.length > 0) {
    console.log("\nRows:");
    for (const row of result.rows) {
      console.log(
        JSON.stringify({
          consultationId: row.consultationId,
          telegramUserId: row.telegramUserId,
          orderReference: row.orderReference,
          hasManagerChatId: row.hasManagerChatId,
          hasMessageThreadId: row.hasMessageThreadId,
          reason: row.reason,
          fixed: row.fixed,
        }),
      );
    }
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => sequelize.close());
