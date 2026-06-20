import { TelegramUser } from "../database/TelegramUser";
import { hasAcceptedCurrentRules } from "../telegram/handlers/rules";
import { computeKwigaRankSnapshot } from "../telegram/profile/kwiga-rank-db";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { isKwigaRankEligibleForPaidChatPurchase } from "../telegram/profile/paid-chat-payment-eligibility";
import {
  hasActiveMultimaskingAccess,
  type MultimaskingAccessSource,
  type MultimaskingAccessStatus,
  type MultimaskingAutoRenewSnapshot,
} from "./multimasking-access-status";

export type { MultimaskingAccessSource, MultimaskingAutoRenewSnapshot };

export type MultimaskingCheckoutGate =
  | { ok: true }
  | { ok: false; reason: "no_consent" | "no_email" }
  | {
      ok: false;
      reason: "already_active_access";
      grantEndAtIso: string | null;
      accessSource: MultimaskingAccessSource | null;
      autoRenew: MultimaskingAutoRenewSnapshot | null;
    }
  | {
      ok: false;
      rank: KwigaAudienceRank;
      reason: "no_user" | "no_contact" | "rank_ineligible";
    };

function resolveGateGrantEndIso(access: MultimaskingAccessStatus): string | null {
  if (access.grantEndAt) {
    return access.grantEndAt.toISOString();
  }
  if (access.userSubscriptionEndAt) {
    return access.userSubscriptionEndAt.toISOString();
  }
  return null;
}

/**
 * Перевірка перед створенням checkout (HTTP `/subscription/checkout`, `/subauto`, бот).
 * Блокує, якщо є активний grant, recurring, user_subscriptions або grace після end_at (усі типи).
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

  const access = await hasActiveMultimaskingAccess(snapshot.contact.id, telegramId);
  if (access.hasAccess) {
    return {
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: resolveGateGrantEndIso(access),
      accessSource: access.source,
      autoRenew: access.autoRenew,
    };
  }

  return { ok: true };
}
