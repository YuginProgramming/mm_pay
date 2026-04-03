/**
 * Прописує ранг KWIGA у колонки telegram_users (kwiga_audience_rank, …) і в preferences
 * для кожного користувача за тією ж логікою, що й профіль бота:
 *
 *   - немає email або немає контакту в contacts → no_kwiga_contact
 *   - контакт є, 0 релевантних рядків (contact_product_access без payment_hook) → prospectives
 *   - 1–4 таких рядки → masters
 *   - 5+ → pro  (оплати в Telegram не додаються до цього лічильника)
 *
 * Запуск з кореня проєкту:
 *   npx ts-node debug/sync-telegram-kwiga-ranks.ts
 *   npx ts-node debug/sync-telegram-kwiga-ranks.ts --dry-run
 */
import "dotenv/config";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/kwiga-rank-db";
import { type KwigaAudienceRank } from "../telegram/kwiga-user-rank";

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const dry = isDryRun();
  if (dry) {
    console.log("DRY-RUN — оновлення БД не виконується");
  }

  const users = await TelegramUser.findAll({ order: [["id", "ASC"]] });
  let updated = 0;
  const summary: Record<KwigaAudienceRank, number> = {
    no_kwiga_contact: 0,
    prospectives: 0,
    masters: 0,
    pro: 0,
  };

  for (const user of users) {
    const email = user.email?.trim() ?? null;
    const snapshot = await computeKwigaRankSnapshot(user);
    summary[snapshot.rank] += 1;

    const prevRank = user.kwigaAudienceRank;
    const prevCount = user.kwigaAccessRowCount;
    const changed =
      prevRank !== snapshot.rank || prevCount !== snapshot.accessRowCount;

    if (dry) {
      if (changed) {
        console.log(
          `id=${user.id} telegram_id=${user.telegramId} email=${email ?? "—"} → ${snapshot.rank} (access rows=${snapshot.accessRowCount})`,
        );
      }
    } else {
      await persistKwigaRankSnapshot(user, snapshot);
      updated += 1;
    }
  }

  console.log("Підсумок за рангами:", summary);
  if (!dry) {
    console.log(`OK — оновлено рядків telegram_users: ${updated}`);
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
