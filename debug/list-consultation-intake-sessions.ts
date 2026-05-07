import "dotenv/config";
import { literal } from "sequelize";
import { ConsultationIntakeSession } from "../database/ConsultationIntakeSession";
import { sequelize } from "../database/db";

async function main(): Promise<void> {
  await sequelize.authenticate();
  const rows = await ConsultationIntakeSession.findAll({
    limit: 50,
    order: literal("\"updated_at\" DESC"),
  });
  for (const row of rows) {
    console.log(
      JSON.stringify(
        {
          consultationId: row.consultationId,
          telegramUserId: row.telegramUserId,
          status: row.status,
          step: row.step,
          answers: row.answersJson,
          mediaCount: row.mediaFileIdsJson.length,
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
