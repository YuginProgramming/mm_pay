/**
 * Додає тестовий контакт у `contacts` і прив’язує `telegram_users` до того самого email.
 * Створює 5 синтетичних рядків у contact_product_access (ранг KWIGA: pro) і
 * записує ранг у колонки telegram_users + preferences.
 *
 * Telegram id береться з app_settings (debug_telegram_user_id), або з аргумента, або з env.
 *
 * Запуск з кореня проєкту:
 *   npx ts-node debug/add-testuser.ts
 *   npx ts-node debug/add-testuser.ts 6956239629
 *
 * Важливо: synthetic external_subscription_id залежать від contact.id у БД, щоб
 * findOrCreate не знаходив чужі рядки (унікальний ключ глобальний) і реальний
 * контакт KWIGA для того ж email отримав свої 5+ рядків для рангу pro.
 *
 * Env: DEBUG_TG_USER_ID=... (якщо немає рядка в app_settings)
 */
import "dotenv/config";
import {
  findContactByEmailForBot,
  SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID,
} from "../database/contact-lookup";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_PRODUCT_NAME,
} from "../payment/multimasking-product";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/profile/kwiga-rank-db";
import { resolveDebugTelegramUserId } from "./resolve-debug-telegram-id";

const TEST_EMAIL = "smith@example.com";
const TEST_FIRST_NAME = "Jane";
const TEST_LAST_NAME = "Smith";
const TEST_PHONE = "+1-555-010-0199";

/** Мінімум рядків доступу для рангу `pro` (див. kwigaAudienceRank). */
const PRO_RANK_MIN_ROWS = 5;

/** База для synthetic subscription id — велика, щоб рідко перетинатись з KWIGA. */
const DEBUG_ACCESS_SUBSCRIPTION_BASE = 9_000_000_000n;

/**
 * Унікальні synthetic external_subscription_id на контакт.
 * Раніше ID будувались лише з константи — існуючі рядки «чіплялись» до іншого
 * contact_id, і ваш KWIGA-контакт лишався з 0 записів (prospectives).
 */
function debugAccessSubscriptionIds(contactId: number): string[] {
  return Array.from({ length: PRO_RANK_MIN_ROWS }, (_, i) =>
    String(
      DEBUG_ACCESS_SUBSCRIPTION_BASE +
        BigInt(contactId) * 1_000n +
        BigInt(i + 1),
    ),
  );
}

async function ensureProRankAccessRows(contactId: number): Promise<void> {
  const subIds = debugAccessSubscriptionIds(contactId);
  for (const externalSubscriptionId of subIds) {
    await ContactProductAccess.findOrCreate({
      where: { externalSubscriptionId },
      defaults: {
        contactId,
        kwigaProductId: null,
        externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
        externalSubscriptionId,
        titleSnapshot: `${MULTIMASKING_PRODUCT_NAME} (debug · pro)`,
        isActive: false,
        isPaid: true,
        startAt: new Date("2020-01-01T00:00:00.000Z"),
        endAt: new Date("2020-02-01T00:00:00.000Z"),
        paidAt: new Date("2020-01-01T00:00:00.000Z"),
        subscriptionStateTitle: "Debug seed · pro rank",
        countAvailableDays: null,
        countLeftDays: null,
        orderId: null,
        offerId: null,
        wayforpayOrderReference: null,
        source: "manual_grant",
        revokedAt: null,
        revokedReason: null,
        lastSyncedAt: null,
      },
    });
  }
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = await resolveDebugTelegramUserId(
    2,
    "npx ts-node debug/add-testuser.ts <id>",
  );

  let contact = await findContactByEmailForBot(TEST_EMAIL);
  let contactCreated = false;

  if (!contact) {
    contact = await Contact.create({
      externalId: SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID,
      email: TEST_EMAIL,
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      phone: TEST_PHONE,
      createdAtFromApi: new Date(),
      tags: [],
      offers: [],
      orders: [],
    });
    contactCreated = true;
  } else {
    await contact.update({
      firstName: TEST_FIRST_NAME,
      lastName: TEST_LAST_NAME,
      phone: TEST_PHONE,
    });
  }

  await ensureProRankAccessRows(contact.id);

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

  const snapshot = await computeKwigaRankSnapshot(tgUser);
  await persistKwigaRankSnapshot(tgUser, snapshot);

  console.log("OK — тестовий користувач для дебагу (очікуваний ранг KWIGA: pro)");
  console.log({
    telegramId,
    telegramUserRow: { id: tgUser.id, created: tgCreated },
    kwigaAudienceRank: snapshot.rank,
    kwigaAccessRowCount: snapshot.accessRowCount,
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
