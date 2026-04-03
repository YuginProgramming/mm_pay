/**
 * Останні записи wayforpay_webhook_events (усі виклики webhook, будь-яка сума / статус).
 *
 *   npx ts-node debug/list-wayforpay-webhooks.ts
 *   npx ts-node debug/list-wayforpay-webhooks.ts 30
 */
import "dotenv/config";
import { WayforpayWebhookEvent } from "../database/WayforpayWebhookEvent";
import { sequelize } from "../database/db";

function parseLimit(): number {
  const arg = process.argv[2]?.trim();
  if (arg && /^\d+$/.test(arg)) {
    return Math.min(200, Math.max(1, parseInt(arg, 10)));
  }
  return 25;
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const cfg = sequelize.config;
  console.log(`DB: ${cfg.database} @ ${cfg.host}:${cfg.port}\n`);

  const limit = parseLimit();
  const rows = await WayforpayWebhookEvent.findAll({
    order: [["createdAt", "DESC"]],
    limit,
  });

  const total = await WayforpayWebhookEvent.count();
  console.log(`Всього подій у таблиці: ${total}. Показано останніх: ${rows.length}\n`);

  for (const r of rows) {
    console.log({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      orderReference: r.orderReference,
      transactionStatus: r.transactionStatus,
      amountRaw: r.amountRaw,
      currency: r.currency,
      signatureValid: r.signatureValid,
      metadataChatId: r.metadataChatId,
      metadataCourseName: r.metadataCourseName,
    });
    console.log("—");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
