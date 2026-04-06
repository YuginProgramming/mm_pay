/**
 * «Чистить» користувача бота для сценарію masters: після наступної оплати в Telegram — одне посилання
 * (ранг рахується без payment_hook; див. grant-multimasking-access).
 *
 * Що робить:
 *   1) Знаходить telegram_users за telegram_id та контакт за email користувача.
 *   2) Видаляє всі contact_product_access з source = payment_hook (оплати WayForPay у боті).
 *   3) Видаляє всі source = manual_grant (дебаг-насіння тощо).
 *   4) Якщо лишається ≥5 рядків kwiga_sync — зупинка з підказкою; з прапорцем --strip-kwiga-sync
 *      видаляє всі kwiga_sync для цього контакта (наступний sync Kwiga відновить дані).
 *   5) Якщо після чистки релевантних рядків 0 — додає 2 debug manual_grant (як set-masters-rank-test-user).
 *   6) Оновлює кеш рангу на telegram_users.
 *
 * Запуск:
 *   npx ts-node debug/clean-telegram-user-to-masters.ts
 *   npx ts-node debug/clean-telegram-user-to-masters.ts 269694206
 *   npx ts-node debug/clean-telegram-user-to-masters.ts 269694206 --strip-kwiga-sync
 */
import "dotenv/config";
import { findContactByEmailForBot } from "../database/contact-lookup";
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
  countContactAccessRowsForKwigaTier,
  persistKwigaRankSnapshot,
} from "../telegram/profile/kwiga-rank-db";

const DEFAULT_TELEGRAM_ID = "269694206";

const DEBUG_MASTERS_SUB_BASE = 8_000_000_000n;

function argvTelegramId(): string {
  const a = process.argv[2]?.trim();
  if (a && /^\d+$/.test(a)) return a;
  return DEFAULT_TELEGRAM_ID;
}

function stripKwigaSync(): boolean {
  return process.argv.includes("--strip-kwiga-sync");
}

function mastersDebugSubscriptionIds(telegramIdNum: number): string[] {
  return [1, 2].map((i) =>
    String(DEBUG_MASTERS_SUB_BASE + BigInt(telegramIdNum) * 10n + BigInt(i)),
  );
}

async function seedMastersDebugRows(
  contactId: number,
  telegramIdNum: number,
): Promise<void> {
  const subIds = mastersDebugSubscriptionIds(telegramIdNum);
  for (const externalSubscriptionId of subIds) {
    await ContactProductAccess.findOrCreate({
      where: { externalSubscriptionId },
      defaults: {
        contactId,
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

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = argvTelegramId();
  const tgUser = await TelegramUser.findOne({ where: { telegramId } });
  if (!tgUser) {
    console.error("Немає telegram_users з telegram_id=", telegramId);
    process.exit(1);
  }

  const email = normalizeEmail(tgUser.email?.trim() ?? "");
  if (!email) {
    console.error("У користувача не вказано email — спочатку вкажіть у боті.");
    process.exit(1);
  }

  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    console.error("Немає контакта в contacts для email", email);
    process.exit(1);
  }

  const n = parseInt(telegramId, 10);
  if (!Number.isFinite(n)) {
    console.error("Некоректний telegram id");
    process.exit(1);
  }

  const destroyedHook = await ContactProductAccess.destroy({
    where: { contactId: contact.id, source: "payment_hook" },
  });
  const destroyedManual = await ContactProductAccess.destroy({
    where: { contactId: contact.id, source: "manual_grant" },
  });

  let tierRows = await countContactAccessRowsForKwigaTier(contact.id);

  if (tierRows > 4) {
    if (!stripKwigaSync()) {
      console.error(
        `Після видалення оплат і manual_grant у контакта ${contact.id} лишається ${tierRows} рядків kwiga_sync (для masters потрібно ≤4). ` +
          "Запустіть знову з прапорцем --strip-kwiga-sync (усі kwiga_sync цього контакта будуть видалені; пізніше sync їх відновить).",
      );
      process.exit(1);
    }
    const destroyedKwiga = await ContactProductAccess.destroy({
      where: { contactId: contact.id, source: "kwiga_sync" },
    });
    console.log("Видалено kwiga_sync рядків:", destroyedKwiga);
    tierRows = await countContactAccessRowsForKwigaTier(contact.id);
  }

  if (tierRows === 0) {
    await seedMastersDebugRows(contact.id, n);
    tierRows = await countContactAccessRowsForKwigaTier(contact.id);
  }

  await tgUser.reload();
  const snapshot = await computeKwigaRankSnapshot(tgUser);
  await persistKwigaRankSnapshot(tgUser, snapshot);

  if (snapshot.rank !== "masters") {
    console.error("Після чистки очікувався masters, отримано:", snapshot.rank, {
      accessRowCount: snapshot.accessRowCount,
    });
    process.exit(1);
  }

  console.log("OK — користувач у стані masters (наступна оплата → один лінк, якщо сервер з актуальним кодом).");
  console.log({
    telegramId,
    email,
    contactId: contact.id,
    destroyedPaymentHook: destroyedHook,
    destroyedManualGrant: destroyedManual,
    tierRowsAfter: tierRows,
    rank: snapshot.rank,
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
