import "dotenv/config";
import { literal } from "sequelize";
import { ConsultationPaymentOrder } from "../database/ConsultationPaymentOrder";
import { sequelize } from "../database/db";

async function main(): Promise<void> {
  await sequelize.authenticate();
  const rows = await ConsultationPaymentOrder.findAll({
    limit: 50,
    order: literal("\"created_at\" DESC"),
  });
  for (const row of rows) {
    console.log(
      JSON.stringify(
        {
          orderReference: row.orderReference,
          telegramUserId: row.telegramUserId,
          telegramChatId: row.telegramChatId,
          productCode: row.productCode,
          status: row.status,
          amount: row.amount,
          currency: row.currency,
          terminalAt: row.terminalAt,
          createdAt: row.createdAt,
        },
        null,
        2,
      ),
    );
  }
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
