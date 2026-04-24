/**
 * Підготовка telegram_users до рангу **masters** для перевірки /profile у реальному часі.
 *
 * Завжди виставляє email **vlad@example.com** на вказаного користувача бота і забезпечує
 * 1–4 рядки `contact_product_access` (за потреби додає 2 debug `manual_grant` «курси»).
 * Якщо контакта з цим email немає в `contacts`, створює тестовий рядок (external_id 9_000_005).
 *
 * Ранг masters = контакт є і 1–4 релевантні рядки (без payment_hook). При ≥5 таких рядках скрипт завершиться з помилкою.
 *
 * Запуск:
 *   npx ts-node debug/set-masters-rank-test-user.ts
 *   npx ts-node debug/set-masters-rank-test-user.ts 208159926
 *
 * Без аргумента: DEBUG_MASTERS_TG_USER_ID або app_settings.debug_telegram_user_id_masters.
 */
import "dotenv/config";
import {
  ensureMastersDebugSyntheticContactIfNeeded,
  findContactByEmailForBot,
  MASTERS_DEBUG_TEST_EMAIL,
} from "../database/contact-lookup";
import { sequelize } from "../database/db";
import { normalizeEmail } from "../database/normalize-email";
import { TelegramUser } from "../database/TelegramUser";
import {
  computeKwigaRankSnapshot,
  countContactAccessRowsForKwigaTier,
  persistKwigaRankSnapshot,
} from "../telegram/profile/kwiga-rank-db";
import {
  destroyMastersDebugSeedRows,
  seedMastersDebugManualGrantsIfNeeded,
} from "../telegram/profile/masters-debug-seed";
import { resolveMastersDebugTelegramUserId } from "./resolve-debug-telegram-id";

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramIdStr = await resolveMastersDebugTelegramUserId(
    2,
    "npx ts-node debug/set-masters-rank-test-user.ts <id>",
  );
  const telegramId = parseInt(telegramIdStr, 10);
  const tgUser = await TelegramUser.findOne({ where: { telegramId } });
  if (!tgUser) {
    console.error("Немає рядка telegram_users з telegram_id=", telegramId);
    process.exit(1);
  }

  const email = normalizeEmail(MASTERS_DEBUG_TEST_EMAIL);
  if (!email) {
    console.error("Некоректний MASTERS_DEBUG_TEST_EMAIL");
    process.exit(1);
  }

  tgUser.email = email;
  tgUser.awaitingEmail = false;
  tgUser.emailChangeFrom = null;
  await tgUser.save();

  await ensureMastersDebugSyntheticContactIfNeeded(email);
  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    console.error("Не вдалося отримати contacts для email", email);
    process.exit(1);
  }

  await destroyMastersDebugSeedRows(contact.id, telegramId);

  const tierRows = await countContactAccessRowsForKwigaTier(contact.id);

  if (tierRows > 4) {
    console.error(
      `У контакта ${contact.id} уже ${tierRows} релевантних рядків (без payment_hook); masters потребує 1–4. ` +
        "Скрипт не видаляє kwiga_sync. Оберіть інший тестовий акаунт або менше даних у KWIGA.",
    );
    process.exit(1);
  }

  await seedMastersDebugManualGrantsIfNeeded(contact.id, telegramId);

  await tgUser.reload();
  const snapshot = await computeKwigaRankSnapshot(tgUser, {
    bypassMonotonic: true,
  });
  await persistKwigaRankSnapshot(tgUser, snapshot);

  if (snapshot.rank !== "masters") {
    console.error("Очікувався masters, отримано:", snapshot.rank, {
      accessRowCount: snapshot.accessRowCount,
    });
    process.exit(1);
  }

  console.log("OK — ранг masters для перевірки /profile");
  console.log({
    telegramId,
    email,
    contactId: contact.id,
    kwigaAudienceRank: snapshot.rank,
    kwigaAccessRowCount: snapshot.accessRowCount,
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
