import "dotenv/config";
import { literal } from "sequelize";
import { ConsultationCase } from "../../database/ConsultationCase";
import { sequelize } from "../../database/db";

async function main(): Promise<void> {
  await sequelize.authenticate();
  const rows = await ConsultationCase.findAll({
    limit: 50,
    order: literal("\"updated_at\" DESC"),
  });
  for (const row of rows) {
    console.log(
      JSON.stringify(
        {
          consultationId: row.consultationId,
          telegramUserId: row.telegramUserId,
          telegramChatId: row.telegramChatId,
          status: row.status,
          productCode: row.productCode,
          orderReference: row.orderReference,
          managerChatId: row.managerChatId,
          messageThreadId: row.messageThreadId,
          updatedAt: row.updatedAt,
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
