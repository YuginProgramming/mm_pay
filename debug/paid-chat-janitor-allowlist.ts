/**
 * Крок (b): друкує allowlist Telegram id для MASTERS / Chat PRO за БД.
 *
 *   npx ts-node debug/paid-chat-janitor-allowlist.ts
 */
import "dotenv/config";
import { sequelize } from "../database/db";
import { buildPaidChatAllowlistsStepB } from "../telegram/paid-chat-janitor";

async function main(): Promise<void> {
  await sequelize.authenticate();
  const lists = await buildPaidChatAllowlistsStepB();
  console.log(
    JSON.stringify(
      {
        mastersCount: lists.masters.length,
        catProCount: lists.catPro.length,
        masters: lists.masters.map((e) => ({
          telegramId: e.telegramId,
          contactId: e.contactId,
          rank: e.rank,
          grantEndAt: e.grantEndAt?.toISOString() ?? null,
        })),
        catPro: lists.catPro.map((e) => ({
          telegramId: e.telegramId,
          contactId: e.contactId,
          rank: e.rank,
          grantEndAt: e.grantEndAt?.toISOString() ?? null,
        })),
      },
      null,
      2,
    ),
  );
  await sequelize.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
