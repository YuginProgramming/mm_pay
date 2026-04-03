import { Op } from "sequelize";
import { findContactByEmailForBot } from "../database/contact-lookup";
import type { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { TelegramUser } from "../database/TelegramUser";
import {
  type KwigaAudienceRank,
  kwigaAudienceRank,
} from "./kwiga-user-rank";

export type KwigaRankSnapshot = {
  rank: KwigaAudienceRank;
  /** Кількість рядків access, що впливають на ранг (kwiga_sync, manual_grant; без payment_hook). */
  accessRowCount: number;
  contact: Contact | null;
};

/**
 * Рядки з оплати в Telegram не підвищують ранг до pro — лише дані з KWIGA (sync) та manual_grant.
 */
export async function countContactAccessRowsForKwigaTier(
  contactId: number,
): Promise<number> {
  return ContactProductAccess.count({
    where: { contactId, source: { [Op.ne]: "payment_hook" } },
  });
}

function mergePrefs(
  prefs: Record<string, unknown> | null,
): Record<string, unknown> {
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
    return { ...prefs };
  }
  return {};
}

/** Обчислити ранг і контакт KWIGA для користувача бота (та сама логіка, що профіль). */
export async function computeKwigaRankSnapshot(
  user: TelegramUser,
): Promise<KwigaRankSnapshot> {
  const email = user.email?.trim() ?? null;
  if (!email) {
    return { rank: "no_kwiga_contact", accessRowCount: 0, contact: null };
  }
  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    return { rank: "no_kwiga_contact", accessRowCount: 0, contact: null };
  }
  const accessRowCount = await countContactAccessRowsForKwigaTier(contact.id);
  return {
    rank: kwigaAudienceRank(true, accessRowCount),
    accessRowCount,
    contact,
  };
}

/**
 * Записати ранг у колонки `telegram_users` та дзеркало в `preferences` (для сумісності).
 */
export async function persistKwigaRankSnapshot(
  user: TelegramUser,
  snapshot: KwigaRankSnapshot,
): Promise<void> {
  const syncedAt = new Date();
  await user.update({
    kwigaAudienceRank: snapshot.rank,
    kwigaAccessRowCount: snapshot.accessRowCount,
    kwigaRankSyncedAt: syncedAt,
    preferences: {
      ...mergePrefs(user.preferences as Record<string, unknown> | null),
      kwigaAudienceRank: snapshot.rank,
      kwigaAccessRowCount: snapshot.accessRowCount,
      kwigaRankSyncedAt: syncedAt.toISOString(),
    },
  });
}
