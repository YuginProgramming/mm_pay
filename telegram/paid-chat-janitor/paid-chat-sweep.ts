/**
 * Крок (c) paid-chat janitor: періодична перевірка користувачів з історією оплати MULTIMASKING
 * у боті — свіжий `computeKwigaRankSnapshot`, активний `payment_hook`, kick з MASTERS / Chat PRO
 * через Bot API (без getUpdates). Адміни зі знімка (a) не чіпаємо.
 */
import { APP_SETTING_KEYS } from "../../database/app-setting-keys";
import { getAppSettingString } from "../../database/app-settings-queries";
import { tryInsertPaidChatJanitorAlertLog } from "../../database/paid-chat-janitor-alert-queries";
import { findTrackedUsersStillInPaidChat } from "../../database/paid-chat-member-state-queries";
import { TelegramUser } from "../../database/TelegramUser";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";
import { computeKwigaRankSnapshot } from "../profile/kwiga-rank-db";
import {
  contactHasActiveMultimaskingPayment,
  findTelegramIdsWithAnyBotPaymentHistory,
} from "./paid-chat-allowlist";
import {
  isPaidChatAdministrator,
  parseTelegramBotChatsJson,
} from "./chats-config";
import { buildPaidChatJanitorStepASnapshot, type PaidChatSnapshot } from "./paid-chat-snapshot";
import type { KwigaAudienceRank } from "../profile/kwiga-user-rank";
import {
  isChatAdminStatus,
  rawBanChatMember,
  rawGetChatMember,
} from "./telegram-bot-raw";
import {
  buildPostKickUa,
  type PaidChatPostKickReason,
} from "./paid-chat-janitor-messages";

const POST_KICK_ALERT_TYPE = "post_kick";

export type PaidChatSweepResult = {
  kickedFromMasters: number;
  kickedFromCatPro: number;
  skippedAdmin: number;
  skippedNotInChat: number;
  skippedNoSnapshot: number;
  usersChecked: number;
  /** Учасники з таблиці chat_member без жодного payment_hook MULTIMASKING у боті — перевірка intruder. */
  intruderCandidatesChecked: number;
  postKickDmSent: number;
  errors: string[];
};

function parseUserId(telegramId: string): number | null {
  const n = Number.parseInt(telegramId, 10);
  return Number.isFinite(n) ? n : null;
}

async function maybeDelay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function shouldStayInMasters(
  activeBotPayment: boolean,
  rank: KwigaAudienceRank,
): boolean {
  return activeBotPayment && (rank === "masters" || rank === "pro");
}

function shouldStayInCatPro(
  activeBotPayment: boolean,
  rank: KwigaAudienceRank,
): boolean {
  return activeBotPayment && rank === "pro";
}

function postKickReason(
  activeBotPayment: boolean,
): PaidChatPostKickReason {
  if (!activeBotPayment) {
    return "no_active_access";
  }
  return "rank_ineligible";
}

async function sendPostKickPrivateNotice(
  telegramId: string,
  snap: PaidChatSnapshot,
  reason: PaidChatPostKickReason,
  delayMs: number,
  errors: string[],
  contactId: number | null,
): Promise<boolean> {
  const dedupeKey = `post_${snap.chatId}_${telegramId}_${snap.role}_${reason}_${Math.floor(Date.now() / 1000)}`;
  const logged = await tryInsertPaidChatJanitorAlertLog(
    telegramId,
    POST_KICK_ALERT_TYPE,
    dedupeKey,
    contactId != null ? { contactId } : undefined,
  );
  if (!logged) {
    return false;
  }
  try {
    await sendTelegramBotMessage(
      telegramId,
      buildPostKickUa({ chatTitle: snap.title, reason }),
    );
    await maybeDelay(delayMs);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`[post-kick DM] ${telegramId}: ${msg}`);
    return false;
  }
}

async function kickIfMemberNotAdmin(
  token: string,
  snap: PaidChatSnapshot,
  userId: number,
  options: { delayMs: number; errors: string[]; label: string },
): Promise<"kicked" | "skipped_admin" | "skipped_not_in_chat" | "error"> {
  if (isPaidChatAdministrator(userId, snap.administratorUserIds)) {
    return "skipped_admin";
  }
  const member = await rawGetChatMember(token, snap.chatId, userId);
  await maybeDelay(options.delayMs);
  if (!member) {
    return "skipped_not_in_chat";
  }
  if (isChatAdminStatus(member.status)) {
    return "skipped_admin";
  }
  try {
    await rawBanChatMember(token, snap.chatId, userId);
    await maybeDelay(options.delayMs);
    return "kicked";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    options.errors.push(`[${options.label}] user ${userId} chat ${snap.chatId}: ${msg}`);
    return "error";
  }
}

/**
 * Учасники, яких ми бачили в чаті (chat_member), але без будь-якого payment_hook MULTIMASKING у БД — «сторонні».
 */
async function runPaidChatIntrudersWithoutBotPaymentPass(
  token: string,
  mastersSnap: PaidChatSnapshot | undefined,
  catProSnap: PaidChatSnapshot | undefined,
  paymentHistoryTelegramIds: Set<string>,
  delayMs: number,
  result: PaidChatSweepResult,
): Promise<void> {
  const runSnap = async (
    snap: PaidChatSnapshot | undefined,
  ): Promise<void> => {
    if (!snap) {
      return;
    }
    const tracked = await findTrackedUsersStillInPaidChat(snap.chatId);
    for (const telegramId of tracked) {
      if (paymentHistoryTelegramIds.has(telegramId)) {
        continue;
      }
      const uid = parseUserId(telegramId);
      if (uid == null) {
        continue;
      }
      result.intruderCandidatesChecked += 1;
      const out = await kickIfMemberNotAdmin(token, snap, uid, {
        delayMs,
        errors: result.errors,
        label: `intruder-${snap.role}`,
      });
      if (out === "kicked") {
        if (snap.role === "masters") {
          result.kickedFromMasters += 1;
        } else {
          result.kickedFromCatPro += 1;
        }
        const sent = await sendPostKickPrivateNotice(
          telegramId,
          snap,
          "intruder",
          delayMs,
          result.errors,
          null,
        );
        if (sent) {
          result.postKickDmSent += 1;
        }
      } else if (out === "skipped_admin") {
        result.skippedAdmin += 1;
      } else if (out === "skipped_not_in_chat") {
        result.skippedNotInChat += 1;
      }
    }
  };

  await runSnap(mastersSnap);
  await runSnap(catProSnap);
}

/**
 * Один повний прохід: знімок чатів + обхід користувачів з будь-яким `payment_hook` на MULTIMASKING.
 */
export async function runPaidChatJanitorSweepOnce(options?: {
  /** Затримка між викликами Bot API (антиспам). */
  delayMs?: number;
}): Promise<PaidChatSweepResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const delayMs =
    typeof options?.delayMs === "number" && Number.isFinite(options.delayMs) && options.delayMs >= 0
      ? Math.floor(options.delayMs)
      : 0;

  const raw = await getAppSettingString(APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON);
  const rows = parseTelegramBotChatsJson(raw ?? "[]");
  const { snapshots, warnings } = await buildPaidChatJanitorStepASnapshot(token, rows);

  for (const w of warnings) {
    console.warn("[paid-chat-sweep]", w);
  }

  const mastersSnap = snapshots.find((s) => s.role === "masters");
  const catProSnap = snapshots.find((s) => s.role === "cat_pro");

  const result: PaidChatSweepResult = {
    kickedFromMasters: 0,
    kickedFromCatPro: 0,
    skippedAdmin: 0,
    skippedNotInChat: 0,
    skippedNoSnapshot: 0,
    usersChecked: 0,
    intruderCandidatesChecked: 0,
    postKickDmSent: 0,
    errors: [],
  };

  if (!mastersSnap && !catProSnap) {
    result.skippedNoSnapshot = 1;
    console.warn("[paid-chat-sweep] немає цільових чатів у JSON — kick пропущено.");
    return result;
  }

  const telegramIds = await findTelegramIdsWithAnyBotPaymentHistory();
  const paymentHistorySet = new Set(telegramIds);

  for (const telegramId of telegramIds) {
    const user = await TelegramUser.findOne({ where: { telegramId } });
    if (!user || user.isBot) {
      continue;
    }

    result.usersChecked += 1;
    const uid = parseUserId(telegramId);
    if (uid == null) {
      continue;
    }

    const rankSnapshot = await computeKwigaRankSnapshot(user);
    await maybeDelay(delayMs);

    const contactId = rankSnapshot.contact?.id;
    const activeBotPayment =
      contactId != null ? await contactHasActiveMultimaskingPayment(contactId) : false;
    await maybeDelay(delayMs);

    const rank = rankSnapshot.rank;
    const inMasters = shouldStayInMasters(activeBotPayment, rank);
    const inCatPro = shouldStayInCatPro(activeBotPayment, rank);

    if (!inMasters && mastersSnap) {
      const out = await kickIfMemberNotAdmin(token, mastersSnap, uid, {
        delayMs,
        errors: result.errors,
        label: "MASTERS",
      });
      if (out === "kicked") {
        result.kickedFromMasters += 1;
        const sent = await sendPostKickPrivateNotice(
          telegramId,
          mastersSnap,
          postKickReason(activeBotPayment),
          delayMs,
          result.errors,
          contactId ?? null,
        );
        if (sent) result.postKickDmSent += 1;
      } else if (out === "skipped_admin") result.skippedAdmin += 1;
      else if (out === "skipped_not_in_chat") result.skippedNotInChat += 1;
    }

    if (!inCatPro && catProSnap) {
      const out = await kickIfMemberNotAdmin(token, catProSnap, uid, {
        delayMs,
        errors: result.errors,
        label: "Chat PRO",
      });
      if (out === "kicked") {
        result.kickedFromCatPro += 1;
        const sent = await sendPostKickPrivateNotice(
          telegramId,
          catProSnap,
          postKickReason(activeBotPayment),
          delayMs,
          result.errors,
          contactId ?? null,
        );
        if (sent) result.postKickDmSent += 1;
      } else if (out === "skipped_admin") result.skippedAdmin += 1;
      else if (out === "skipped_not_in_chat") result.skippedNotInChat += 1;
    }
  }

  await runPaidChatIntrudersWithoutBotPaymentPass(
    token,
    mastersSnap,
    catProSnap,
    paymentHistorySet,
    delayMs,
    result,
  );

  return result;
}
