import { TelegramUser } from "../database/TelegramUser";
import { hasAcceptedCurrentRules } from "../telegram/handlers/rules";
import { getActiveMultimaskingPaymentSummaryForContact } from "../telegram/paid-chat-janitor/paid-chat-allowlist";
import { computeKwigaRankSnapshot } from "../telegram/profile/kwiga-rank-db";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { isKwigaRankEligibleForPaidChatPurchase } from "../telegram/profile/paid-chat-payment-eligibility";

export type MultimaskingCheckoutGate =
  | { ok: true }
  | { ok: false; reason: "no_consent" | "no_email" }
  | {
      ok: false;
      reason: "already_active_access";
      grantEndAtIso: string | null;
    }
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
  if (!(await hasAcceptedCurrentRules(telegramId))) {
    return { ok: false, reason: "no_consent" };
  }
  if (!user.email?.trim()) {
    return { ok: false, reason: "no_email" };
  }
  const snapshot = await computeKwigaRankSnapshot(user);
  if (!snapshot.contact) {
    return { ok: false, rank: snapshot.rank, reason: "no_contact" };
  }
  if (!isKwigaRankEligibleForPaidChatPurchase(snapshot.rank)) {
    return { ok: false, rank: snapshot.rank, reason: "rank_ineligible" };
  }
  const paymentSummary = await getActiveMultimaskingPaymentSummaryForContact(
    snapshot.contact.id,
  );
  if (paymentSummary.active) {
    return {
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: paymentSummary.grantEndAt?.toISOString() ?? null,
    };
  }
  return { ok: true };
}
