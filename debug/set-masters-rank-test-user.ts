/**
 * Підготовка telegram_users до рангу **masters** для перевірки /profile у реальному часі.
 *
 * Завжди виставляє email **dudaryev@gmail.com** на вказаного користувача бота і забезпечує
 * 1–4 рядки `contact_product_access` (за потреби додає 2 debug `manual_grant` «курси»).
 * Якщо контакта з цим email немає в `contacts`, створює тестовий рядок (external_id 9_000_004).
 *
 * Ранг masters = контакт є і 1–4 рядки доступу (`kwiga-user-rank.ts`). При ≥5 рядках у контакта скрипт завершиться з помилкою.
 *
 * Запуск:
 *   npx ts-node debug/set-masters-rank-test-user.ts
 *   npx ts-node debug/set-masters-rank-test-user.ts 269694206
 */
import "dotenv/config";
import { Op } from "sequelize";
import { findContactByEmailForBot } from "../database/contact-lookup";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { sequelize } from "../database/db";
import { normalizeEmail } from "../database/normalize-email";
import { TelegramUser } from "../database/TelegramUser";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_PRODUCT_NAME,
} from "../payment/multimasking-product";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/kwiga-rank-db";

const DEFAULT_TELEGRAM_ID = 269694206;

/** Email і синтетичний KWIGA contact id лише для цього дебаг-сценарію. */
const TEST_EMAIL_RAW = "dudaryev@gmail.com";
/** Не перетинається з add-testuser (9_000_002). */
const MASTERS_TEST_CONTACT_EXTERNAL_ID = 9_000_004;

/** Відрізняється від pro-seed (9e9) у add-testuser.ts. */
const DEBUG_MASTERS_SUB_BASE = 8_000_000_000n;

function mastersDebugSubscriptionIds(telegramId: number): string[] {
  return [1, 2].map((i) =>
    String(DEBUG_MASTERS_SUB_BASE + BigInt(telegramId) * 10n + BigInt(i)),
  );
}

function argvTelegramId(): number {
  const raw = process.argv[2];
  if (raw && /^\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }
  return DEFAULT_TELEGRAM_ID;
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = argvTelegramId();
  const tgUser = await TelegramUser.findOne({ where: { telegramId } });
  if (!tgUser) {
    console.error("Немає рядка telegram_users з telegram_id=", telegramId);
    process.exit(1);
  }

  const email = normalizeEmail(TEST_EMAIL_RAW);
  if (!email) {
    console.error("Некоректний TEST_EMAIL");
    process.exit(1);
  }

  tgUser.email = email;
  tgUser.awaitingEmail = false;
  tgUser.emailChangeFrom = null;
  await tgUser.save();

  let contact = await findContactByEmailForBot(email);
  if (!contact) {
    contact = await Contact.create({
      externalId: MASTERS_TEST_CONTACT_EXTERNAL_ID,
      email,
      firstName: "Masters",
      lastName: "Debug",
      phone: null,
      createdAtFromApi: new Date(),
      tags: [],
      offers: [],
      orders: [],
    });
    console.log("Створено тестовий contacts для email", email, "id=", contact.id);
  }

  const subIds = mastersDebugSubscriptionIds(telegramId);

  await ContactProductAccess.destroy({
    where: {
      contactId: contact.id,
      externalSubscriptionId: { [Op.in]: subIds },
    },
  });

  const total = await ContactProductAccess.count({
    where: { contactId: contact.id },
  });

  if (total > 4) {
    console.error(
      `У контакта ${contact.id} уже ${total} рядків contact_product_access (masters потребує 1–4). ` +
        "Скрипт не видаляє рядки kwiga_sync / payment_hook. Оберіть інший тестовий акаунт або менше даних у KWIGA.",
    );
    process.exit(1);
  }

  /** 2 курси → рівно в діапазоні masters (1–4). */
  const needRows = total === 0 ? 2 : 0;
  if (needRows === 2) {
    for (const externalSubscriptionId of subIds) {
      await ContactProductAccess.findOrCreate({
        where: { externalSubscriptionId },
        defaults: {
          contactId: contact.id,
          kwigaProductId: null,
          externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
          externalSubscriptionId,
          titleSnapshot: `${MULTIMASKING_PRODUCT_NAME} (debug · masters)`,
          isActive: false,
          isPaid: true,
          startAt: new Date("2020-01-01T00:00:43.000Z"),
          endAt: new Date("2020-02-01T00:00:43.000Z"),
          paidAt: new Date("2020-01-01T00:00:43.000Z"),
          subscriptionStateTitle: "Debug seed · masters rank",
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

  await tgUser.reload();
  const snapshot = await computeKwigaRankSnapshot(tgUser);
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
