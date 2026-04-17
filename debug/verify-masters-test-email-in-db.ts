/**
 * Перевіряє, що email masters-тесту (`MASTERS_DEBUG_TEST_EMAIL`) є в `contacts` і `telegram_users`.
 *
 *   npx ts-node debug/verify-masters-test-email-in-db.ts
 *   npm run debug:verify-masters-email
 */
import "dotenv/config";
import { AppSetting } from "../database/AppSetting";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { Contact } from "../database/Contact";
import {
  MASTERS_DEBUG_TEST_EMAIL,
  SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID,
} from "../database/contact-lookup";
import { sequelize } from "../database/db";
import { normalizeEmail } from "../database/normalize-email";
import { TelegramUser } from "../database/TelegramUser";
import { resolveMastersDebugTelegramUserId } from "./resolve-debug-telegram-id";

async function main(): Promise<void> {
  await sequelize.authenticate();

  const email = normalizeEmail(MASTERS_DEBUG_TEST_EMAIL);
  if (!email) {
    console.error("Некоректний MASTERS_DEBUG_TEST_EMAIL");
    process.exit(1);
  }

  console.log("Шукаю:", email, "\n");

  let debugTelegramId: string | null = null;
  try {
    debugTelegramId = await resolveMastersDebugTelegramUserId(
      2,
      "npx ts-node debug/verify-masters-test-email-in-db.ts [telegram_id]",
    );
  } catch {
    const fromEnv = process.env.DEBUG_MASTERS_TG_USER_ID?.trim();
    const row = await AppSetting.findByPk(
      APP_SETTING_KEYS.DEBUG_TELEGRAM_USER_ID_MASTERS,
    );
    console.log("debug telegram id: не вдалося визначити (немає аргумента, env DEBUG_MASTERS_TG_USER_ID і рядка в app_settings).");
    console.log(
      `  app_settings.${APP_SETTING_KEYS.DEBUG_TELEGRAM_USER_ID_MASTERS} =`,
      row?.settingValue?.trim() ? `"${row.settingValue.trim()}"` : "(немає рядка)",
    );
    if (fromEnv) console.log(`  env DEBUG_MASTERS_TG_USER_ID = "${fromEnv}"`);
    console.log("");
  }

  if (debugTelegramId) {
    const tgById = await TelegramUser.findOne({
      where: { telegramId: debugTelegramId },
    });
    console.log(`debug telegram id: ${debugTelegramId} (аргумент / env / app_settings)`);
    if (!tgById) {
      console.log(
        "  telegram_users: рядка з цим telegram_id НЕМАЄ — спочатку відкрийте бота з цього акаунта (/start), щоб з’явився запис.",
      );
    } else {
      console.log(
        `  telegram_users: є (email зараз: ${tgById.email ?? "null"})`,
      );
      if (tgById.email !== email) {
        console.log(
          `  → Запустіть: npm run debug:set-masters-test-user — виставить ${email} і створить contact.`,
        );
      }
    }
    console.log("");
  }

  const contacts = await Contact.findAll({
    where: { email },
    order: [["id", "ASC"]],
  });

  const tgUsers = await TelegramUser.findAll({
    where: { email },
    order: [["id", "ASC"]],
  });

  if (contacts.length === 0) {
    console.log("contacts:       НЕ ЗНАЙДЕНО");
    console.log(
      "  → Запустіть: npm run debug:set-masters-test-user (потрібен рядок telegram_users для debug id).",
    );
  } else {
    console.log(`contacts:       OK — ${contacts.length} рядк(ів)`);
    for (const c of contacts) {
      const synthetic =
        c.externalId === SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID
          ? " (синтетичний masters-seed)"
          : "";
      console.log(
        `  id=${c.id} external_id=${c.externalId}${synthetic} · ${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
      );
    }
  }

  if (tgUsers.length === 0) {
    console.log("telegram_users: НЕ ЗНАЙДЕНО");
    console.log(
      "  → Користувач ще не писав боту або email не збережено; після /start і email — знову npm run debug:set-masters-test-user.",
    );
  } else {
    console.log(`telegram_users: OK — ${tgUsers.length} рядк(ів)`);
    for (const u of tgUsers) {
      console.log(
        `  telegram_id=${u.telegramId} kwiga_rank=${u.kwigaAudienceRank ?? "null"} · ${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
      );
    }
  }

  const ok = contacts.length > 0 && tgUsers.length > 0;
  console.log("");
  if (ok) {
    console.log("Підсумок: все на місці — email знайдено в обох таблицях.");
  } else {
    console.log("Підсумок: не повний набір (див. підказки вище).");
    process.exit(1);
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
