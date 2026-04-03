/**
 * Виводить у консоль ранг KWIGA для користувача з app_settings.debug_telegram_user_id.
 * Розрахунок такий самий, як у профілі бота / sync-telegram-kwiga-ranks.
 *
 * З кореня проєкту:
 *   npx ts-node debug/show-debug-user-rank.ts
 * Опційно передати інший Telegram id:
 *   npx ts-node debug/show-debug-user-rank.ts 6956239629
 */
import "dotenv/config";
import { AppSetting } from "../database/AppSetting";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import { computeKwigaRankSnapshot } from "../telegram/kwiga-rank-db";
import { formatKwigaRankLine } from "../telegram/kwiga-user-rank";

async function resolveTelegramId(): Promise<string> {
  const fromArg = process.argv[2]?.trim();
  if (fromArg && /^\d+$/.test(fromArg)) {
    return fromArg;
  }

  const row = await AppSetting.findByPk(APP_SETTING_KEYS.DEBUG_TELEGRAM_USER_ID);
  const fromDb = row?.settingValue?.trim();
  if (fromDb && /^\d+$/.test(fromDb)) {
    return fromDb;
  }

  throw new Error(
    "Не знайдено telegram id: задайте app_settings.debug_telegram_user_id " +
      "або передайте числовий id аргументом: npx ts-node debug/show-debug-user-rank.ts <id>",
  );
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = await resolveTelegramId();
  const user = await TelegramUser.findOne({ where: { telegramId } });

  if (!user) {
    console.log({
      source: "app_settings / argv",
      telegramId,
      error: "telegram_users: рядок не знайдено",
    });
    return;
  }

  const email = user.email?.trim() ?? null;
  const snapshot = await computeKwigaRankSnapshot(user);
  let nonRevokedCount = 0;
  if (snapshot.contact) {
    nonRevokedCount = await ContactProductAccess.count({
      where: { contactId: snapshot.contact.id, revokedAt: null },
    });
  }

  const prefs = user.preferences as Record<string, unknown> | null;

  console.log("— Debug KWIGA rank —");
  console.log({
    telegramId: user.telegramId,
    telegramUserId: user.id,
    email: email ?? "(немає)",
    contactId: snapshot.contact?.id ?? null,
    contactInDb: snapshot.contact !== null,
    accessRowsTotal: snapshot.accessRowCount,
    accessRowsNonRevoked: nonRevokedCount,
    rankComputed: snapshot.rank,
    rankLineUa: formatKwigaRankLine(snapshot.rank),
    storedOnTelegramUserRow: {
      kwigaAudienceRank: user.kwigaAudienceRank ?? null,
      kwigaAccessRowCount: user.kwigaAccessRowCount ?? null,
      kwigaRankSyncedAt: user.kwigaRankSyncedAt ?? null,
    },
    cachedInPreferences: {
      kwigaAudienceRank: prefs?.kwigaAudienceRank ?? null,
      kwigaAccessRowCount: prefs?.kwigaAccessRowCount ?? null,
      kwigaRankSyncedAt: prefs?.kwigaRankSyncedAt ?? null,
    },
    storedMatchesComputed:
      user.kwigaAudienceRank === snapshot.rank &&
      user.kwigaAccessRowCount === snapshot.accessRowCount,
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
