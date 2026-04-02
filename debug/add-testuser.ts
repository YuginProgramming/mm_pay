/**
 * Додає тестовий контакт у `contacts` і прив’язує `telegram_users` до того самого email.
 *
 * Telegram id береться з app_settings (debug_telegram_user_id), або з аргумента, або з env.
 *
 * Запуск з кореня проєкту:
 *   npx ts-node debug/add-testuser.ts
 *   npx ts-node debug/add-testuser.ts 6956239629
 *
 * Env: DEBUG_TG_USER_ID=... (якщо немає рядка в app_settings)
 */
import "dotenv/config";
import { AppSetting } from "../database/AppSetting";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { Contact } from "../database/Contact";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";

/** Синтетичний Kwiga external_id (не повинен збігатися з реальними з синку). */
const DEBUG_CONTACT_EXTERNAL_ID = 9_000_002;

const TEST_EMAIL = "smith@example.com";
const TEST_FIRST_NAME = "Jane";
const TEST_LAST_NAME = "Smith";
const TEST_PHONE = "+1-555-010-0199";

async function resolveTelegramUserId(): Promise<string> {
  const fromArg = process.argv[2]?.trim();
  if (fromArg && /^\d+$/.test(fromArg)) {
    return fromArg;
  }

  const fromEnv = process.env.DEBUG_TG_USER_ID?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return fromEnv;
  }

  const row = await AppSetting.findByPk(APP_SETTING_KEYS.DEBUG_TELEGRAM_USER_ID);
  const fromDb = row?.settingValue?.trim();
  if (fromDb && /^\d+$/.test(fromDb)) {
    return fromDb;
  }

  throw new Error(
    "Не знайдено telegram user id: задайте app_settings.debug_telegram_user_id, " +
      "або DEBUG_TG_USER_ID у .env, або передайте число аргументом: npx ts-node debug/add-testuser.ts <id>",
  );
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = await resolveTelegramUserId();

  const [contact, contactCreated] = await Contact.findOrCreate({
    where: { email: TEST_EMAIL },
    defaults: {
      externalId: DEBUG_CONTACT_EXTERNAL_ID,
      email: TEST_EMAIL,
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      phone: TEST_PHONE,
      createdAtFromApi: new Date(),
      tags: [],
      offers: [],
      orders: [],
    },
  });

  if (!contactCreated) {
    await contact.update({
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      phone: TEST_PHONE,
    });
  }

  const [tgUser, tgCreated] = await TelegramUser.findOrCreate({
    where: { telegramId },
    defaults: {
      telegramId,
      username: null,
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      languageCode: "en",
      isBot: false,
      isPremium: false,
      addedToAttachmentMenu: false,
      allowsWriteToPm: true,
      lastActivity: new Date(),
      totalInteractions: 1,
      isActive: true,
      preferences: null,
      email: TEST_EMAIL,
      awaitingEmail: false,
      emailChangeFrom: null,
    },
  });

  tgUser.email = TEST_EMAIL;
  tgUser.awaitingEmail = false;
  tgUser.emailChangeFrom = null;
  tgUser.firstName = tgUser.firstName ?? TEST_FIRST_NAME;
  tgUser.lastName = tgUser.lastName ?? TEST_LAST_NAME;
  await tgUser.save();

  console.log("OK — тестовий користувач для дебагу");
  console.log({
    telegramId,
    telegramUserRow: { id: tgUser.id, created: tgCreated },
    contact: {
      id: contact.id,
      externalId: contact.externalId,
      email: contact.email,
      created: contactCreated,
    },
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
