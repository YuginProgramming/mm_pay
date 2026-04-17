import { Op } from "sequelize";
import {
  ensureMastersDebugSyntheticContactIfNeeded,
  findContactByEmailForBot,
  MASTERS_DEBUG_TEST_EMAIL,
} from "../../database/contact-lookup";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { normalizeEmail } from "../../database/normalize-email";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_PRODUCT_NAME,
} from "../../payment/multimasking-product";
import type { TelegramUser } from "../../database/TelegramUser";

/** Відрізняється від pro-seed (9e9) у add-testuser.ts. */
export const DEBUG_MASTERS_SUB_BASE = 8_000_000_000n;

export function mastersDebugSubscriptionIds(telegramId: number): string[] {
  return [1, 2].map((i) =>
    String(DEBUG_MASTERS_SUB_BASE + BigInt(telegramId) * 10n + BigInt(i)),
  );
}

async function countTierRowsExcludingPaymentHook(
  contactId: number,
): Promise<number> {
  return ContactProductAccess.count({
    where: { contactId, source: { [Op.ne]: "payment_hook" } },
  });
}

/**
 * Видаляє лише debug-рядки з `mastersDebugSubscriptionIds` для цього telegram id
 * (для ідемпотентного перезапуску `set-masters-rank-test-user.ts`).
 */
export async function destroyMastersDebugSeedRows(
  contactId: number,
  telegramIdNum: number,
): Promise<void> {
  const subIds = mastersDebugSubscriptionIds(telegramIdNum);
  await ContactProductAccess.destroy({
    where: {
      contactId,
      externalSubscriptionId: { [Op.in]: subIds },
    },
  });
}

/**
 * Якщо для контакта 0 релевантних рядків (kwiga_sync/manual_grant) і ≤4 загалом після додавання —
 * додає 2 `manual_grant` (діапазон masters 1–4). Якщо вже ≥5 — не чіпає (pro з KWIGA).
 */
export async function seedMastersDebugManualGrantsIfNeeded(
  contactId: number,
  telegramIdNum: number,
): Promise<void> {
  const tierRows = await countTierRowsExcludingPaymentHook(contactId);
  if (tierRows > 4) {
    return;
  }
  if (tierRows > 0) {
    return;
  }

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

/**
 * Для тестового email masters: гарантує рядок у `contacts` і при потребі 2 `manual_grant`,
 * щоб ранг був masters і відкривалась оплата WayForPay (як pro/masters).
 */
export async function ensureMastersDebugRankDataForUser(
  user: TelegramUser,
): Promise<void> {
  const email = user.email?.trim() ?? null;
  if (!email) {
    return;
  }
  const normalized = normalizeEmail(email);
  if (!normalized || normalized !== normalizeEmail(MASTERS_DEBUG_TEST_EMAIL)) {
    return;
  }

  await ensureMastersDebugSyntheticContactIfNeeded(email);
  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    return;
  }

  const telegramIdNum = parseInt(String(user.telegramId), 10);
  if (!Number.isFinite(telegramIdNum)) {
    return;
  }

  await seedMastersDebugManualGrantsIfNeeded(contact.id, telegramIdNum);
}
