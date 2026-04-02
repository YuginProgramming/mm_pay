/**
 * Видаляє тестового користувача з таблиць бота (перед повторним /start «як новий»).
 *
 * Видаляє:
 *   - telegram_users
 *   - rules_consents (той самий telegram_id) — щоб знову показати правила
 *   - email_change_logs (той самий telegram_id)
 *
 * Рядок у contacts НЕ видаляється — перевірки доступу за email лишаються.
 *
 * Прапорець --telegram-only: лише telegram_users (згода та логи email лишаються).
 *
 * Запуск:
 *   npx ts-node debug/remove-telegram-user.ts
 *   npx ts-node debug/remove-telegram-user.ts 6956239629
 *   npx ts-node debug/remove-telegram-user.ts --telegram-only
 */
import "dotenv/config";
import { EmailChangeLog } from "../database/EmailChangeLog";
import { RulesConsent } from "../database/RulesConsent";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import { resolveDebugTelegramUserId } from "./resolve-debug-telegram-id";

function telegramOnlyMode(): boolean {
  return process.argv.includes("--telegram-only");
}

function argvIndexForId(): number {
  const idArg = process.argv.find((a) => /^\d+$/.test(a));
  if (idArg) return process.argv.indexOf(idArg);
  return 2;
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const onlyTg = telegramOnlyMode();
  const telegramId = await resolveDebugTelegramUserId(
    argvIndexForId(),
    "npx ts-node debug/remove-telegram-user.ts [<id>] [--telegram-only]",
  );

  const result: Record<string, number> = {};

  if (!onlyTg) {
    result.rules_consents = await RulesConsent.destroy({
      where: { telegramId },
    });
    result.email_change_logs = await EmailChangeLog.destroy({
      where: { telegramId },
    });
  }

  result.telegram_users = await TelegramUser.destroy({
    where: { telegramId },
  });

  console.log("OK — видалено дані бота для telegram_id", telegramId);
  console.log(result);

  if (result.telegram_users === 0) {
    console.warn(
      "У telegram_users не було рядка з таким id (можливо, вже видалено).",
    );
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
