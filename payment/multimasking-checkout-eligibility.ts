import { TelegramUser } from "../database/TelegramUser";
import { computeKwigaRankSnapshot } from "../telegram/profile/kwiga-rank-db";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { isKwigaRankEligibleForPaidChatPurchase } from "../telegram/profile/paid-chat-payment-eligibility";

export type MultimaskingCheckoutGate =
  | { ok: true }
  | {
      ok: false;
      rank: KwigaAudienceRank;
      reason: "no_user" | "no_contact" | "rank_ineligible";
    };

/**
 * Перевірка перед створенням інвойсу (HTTP або інший клієнт, що обходить бота).
 */
export async function gateMultimaskingCheckoutForTelegramId(
  telegramId: string,
): Promise<MultimaskingCheckoutGate> {
  const user = await TelegramUser.findOne({ where: { telegramId } });
  if (!user) {
    return { ok: false, rank: "no_kwiga_contact", reason: "no_user" };
  }
  const snapshot = await computeKwigaRankSnapshot(user);
  if (!snapshot.contact) {
    return { ok: false, rank: snapshot.rank, reason: "no_contact" };
  }
  if (!isKwigaRankEligibleForPaidChatPurchase(snapshot.rank)) {
    return { ok: false, rank: snapshot.rank, reason: "rank_ineligible" };
  }
  return { ok: true };
}
