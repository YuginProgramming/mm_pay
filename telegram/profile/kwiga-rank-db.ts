import { Op } from "sequelize";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { ensureMastersDebugRankDataForUser } from "./masters-debug-seed";
import type { Contact } from "../../database/Contact";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { TelegramUser } from "../../database/TelegramUser";
import {
  type KwigaAudienceRank,
  kwigaAudienceRank,
  mergeMonotonicKwigaSnapshot,
} from "./kwiga-user-rank";

export type KwigaRankSnapshot = {
  /** Ефективний ранж (після monotonic; TZ/rank-info.txt) — для UI / janitor / оплати. */
  rank: KwigaAudienceRank;
  /** Ефективна кількість рядків, узгоджена з `rank` у збереженому вигляді. */
  accessRowCount: number;
  contact: Contact | null;
  /** «Сирий» кандидат з поточних рядків contact_product_access (до monotonic). */
  candidateRank: KwigaAudienceRank;
  candidateAccessRowCount: number;
};

export type ComputeKwigaRankOptions = {
  /** Сирий снапшот без злиття зі збереженим (для дебаг-скриптів). */
  bypassMonotonic?: boolean;
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

/**
 * Обчислити ранг і контакт KWIGA для користувача бота (та сама логіка, що профіль).
 *
 * За замовчуванням застосовується monotonic (TZ/rank-info.txt): збережений ранг не падає
 * при тимчасовій втраті рядків; `rank` / `accessRowCount` у снапшоті — **ефективні**.
 *
 * Для виконавчих рішень (paid-chat janitor, kick/skip) викликати **щоразу** на момент прогону —
 * не покладатися лише на кеш у колонках без `compute`.. Див. TZ/user-control-crawler.txt п. 1.1.
 */
export async function computeKwigaRankSnapshot(
  user: TelegramUser,
  options?: ComputeKwigaRankOptions,
): Promise<KwigaRankSnapshot> {
  const email = user.email?.trim() ?? null;
  if (!email) {
    if (options?.bypassMonotonic) {
      return {
        rank: "no_kwiga_contact",
        accessRowCount: 0,
        contact: null,
        candidateRank: "no_kwiga_contact",
        candidateAccessRowCount: 0,
      };
    }
    const effective = mergeMonotonicKwigaSnapshot({
      storedRank: user.kwigaAudienceRank ?? null,
      storedCount: user.kwigaAccessRowCount ?? null,
      candidateRank: "no_kwiga_contact",
      candidateCount: 0,
    });
    return {
      rank: effective.rank,
      accessRowCount: effective.accessRowCount,
      contact: null,
      candidateRank: "no_kwiga_contact",
      candidateAccessRowCount: 0,
    };
  }
  await ensureMastersDebugRankDataForUser(user);
  const contact = await findContactByEmailForBot(email);
  const hasContact = contact != null;
  const accessRowCount = hasContact
    ? await countContactAccessRowsForKwigaTier(contact.id)
    : 0;
  const candidateRank = kwigaAudienceRank(hasContact, accessRowCount);
  const candidateAccessRowCount = accessRowCount;

  if (options?.bypassMonotonic) {
    return {
      rank: candidateRank,
      accessRowCount: candidateAccessRowCount,
      contact,
      candidateRank,
      candidateAccessRowCount,
    };
  }

  const effective = mergeMonotonicKwigaSnapshot({
    storedRank: user.kwigaAudienceRank ?? null,
    storedCount: user.kwigaAccessRowCount ?? null,
    candidateRank,
    candidateCount: candidateAccessRowCount,
  });

  return {
    rank: effective.rank,
    accessRowCount: effective.accessRowCount,
    contact,
    candidateRank,
    candidateAccessRowCount,
  };
}

/**
 * Записати ефективний ранг у колонки `telegram_users` та дзеркало в `preferences` (для сумісності).
 * Без оновлення, якщо значення вже такі ж (менше зайвих записів), окрім `force: true`
 * (для `debug/sync-telegram-kwiga-ranks.ts` — оновлює `kwiga_rank_synced_at` навіть без зміни рангу).
 */
export async function persistKwigaRankSnapshot(
  user: TelegramUser,
  snapshot: KwigaRankSnapshot,
  options?: { force?: boolean },
): Promise<void> {
  if (
    !options?.force &&
    user.kwigaAudienceRank === snapshot.rank &&
    user.kwigaAccessRowCount === snapshot.accessRowCount
  ) {
    return;
  }
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
