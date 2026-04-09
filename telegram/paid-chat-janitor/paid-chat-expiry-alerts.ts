/**
 * §7.6 попередження до вилучення за **терміном** access (усі grant-рядки активні з
 * кінцевою датою; якщо є хоча б один без `end_at` — термін не обмежений, алерти не шлемо).
 *
 * Прод: два алерти в останню добу (~24 год та ~3 год до `deadline`).
 * Тест (`PAID_CHAT_ACCESS_TEST_MINUTES`): один алерт за ~1 хв до кінця.
 *
 * Ідемпотентність: `paid_chat_janitor_alert_log`.
 */
import { Contact } from "../../database/Contact";
import { getPaidChatAccessTestMinutesFromEnv } from "../../database/app-settings-queries";
import { tryInsertPaidChatJanitorAlertLog } from "../../database/paid-chat-janitor-alert-queries";
import { TelegramUser } from "../../database/TelegramUser";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";
import { computeKwigaRankSnapshot } from "../profile/kwiga-rank-db";
import {
  loadActiveBotPaymentRowsByContact,
  maxGrantEndAt,
} from "./paid-chat-allowlist";
import {
  buildExpiryWarn24hUa,
  buildExpiryWarnFinalUa,
  buildExpiryWarnTest1mUa,
} from "./paid-chat-janitor-messages";

const MS_HOUR = 60 * 60_000;
const MS_24H = 24 * MS_HOUR;
/** «Другий» прод-алерт: в останні ~3 год до kick (TZ §7.6). */
const MS_FINAL_WINDOW = 3 * MS_HOUR;
const MS_TEST_WARN = 60_000;

export const PAID_CHAT_JANITOR_ALERT_TYPE = {
  EXPIRY_WARN_24H: "expiry_warn_24h",
  EXPIRY_WARN_FINAL: "expiry_warn_final",
  EXPIRY_WARN_TEST_1M: "expiry_warn_test_1m",
} as const;

export type PaidChatExpiryAlertsResult = {
  sent24h: number;
  sentFinal: number;
  sentTest1m: number;
  errors: string[];
};

function chatLabelsForRank(rank: string): string {
  const masters = rank === "masters" || rank === "pro";
  const catPro = rank === "pro";
  const parts: string[] = [];
  if (masters) parts.push("MASTERS");
  if (catPro) parts.push("Chat PRO");
  return parts.length > 0
    ? parts.join(", ")
    : "MASTERS / Chat PRO (за вашим рангом)";
}

async function maybeDelay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function dedupeBase(
  telegramId: string,
  contactId: number,
  deadlineMs: number,
): string {
  return `u${telegramId}_c${contactId}_e${deadlineMs}`;
}

/**
 * Надсилає попередження користувачам, у яких активний MULTIMASKING-доступ з відомою датою
 * закінчення і решта умов janitor виконуються.
 */
export async function runPaidChatExpiryAlertsOnce(options?: {
  delayMs?: number;
}): Promise<PaidChatExpiryAlertsResult> {
  const delayMs =
    typeof options?.delayMs === "number" &&
    Number.isFinite(options.delayMs) &&
    options.delayMs >= 0
      ? Math.floor(options.delayMs)
      : 0;

  const testMinutes = getPaidChatAccessTestMinutesFromEnv();
  const isTest = testMinutes != null;

  const byContact = await loadActiveBotPaymentRowsByContact();
  const result: PaidChatExpiryAlertsResult = {
    sent24h: 0,
    sentFinal: 0,
    sentTest1m: 0,
    errors: [],
  };

  const now = Date.now();

  for (const [contactId, payRows] of byContact) {
    if (payRows.some((r) => r.endAt == null)) {
      continue;
    }
    const deadline = maxGrantEndAt(payRows);
    if (!deadline) {
      continue;
    }
    const deadlineMs = deadline.getTime();
    const remainingMs = deadlineMs - now;
    if (remainingMs <= 0) {
      continue;
    }

    const contact = await Contact.findByPk(contactId);
    if (!contact?.email?.trim()) {
      continue;
    }

    const users = await TelegramUser.findAll({
      where: { email: contact.email },
    });

    for (const user of users) {
      if (user.isBot) {
        continue;
      }

      const rankSnapshot = await computeKwigaRankSnapshot(user);
      await maybeDelay(delayMs);
      if (!rankSnapshot.contact || rankSnapshot.contact.id !== contactId) {
        continue;
      }

      const chatLabels = chatLabelsForRank(rankSnapshot.rank);

      const grantEndsAtIso = deadline.toISOString();
      const baseDedupe = dedupeBase(user.telegramId, contactId, deadlineMs);
      const meta = { contactId, grantEndAt: deadline };

      try {
        if (isTest) {
          if (remainingMs <= MS_TEST_WARN) {
            const dedupe = `${baseDedupe}_t1m`;
            const inserted = await tryInsertPaidChatJanitorAlertLog(
              user.telegramId,
              PAID_CHAT_JANITOR_ALERT_TYPE.EXPIRY_WARN_TEST_1M,
              dedupe,
              meta,
            );
            if (inserted) {
              await sendTelegramBotMessage(
                user.telegramId,
                buildExpiryWarnTest1mUa({ chatLabels, grantEndsAtIso }),
              );
              await maybeDelay(delayMs);
              result.sentTest1m += 1;
            }
          }
          continue;
        }

        if (remainingMs <= MS_24H) {
          const dedupe = `${baseDedupe}_w24`;
          const inserted = await tryInsertPaidChatJanitorAlertLog(
            user.telegramId,
            PAID_CHAT_JANITOR_ALERT_TYPE.EXPIRY_WARN_24H,
            dedupe,
            meta,
          );
          if (inserted) {
            await sendTelegramBotMessage(
              user.telegramId,
              buildExpiryWarn24hUa({
                chatLabels,
                remainingMs,
                grantEndsAtIso,
              }),
            );
            await maybeDelay(2000);
            await maybeDelay(delayMs);
            result.sent24h += 1;
          }
        }

        if (remainingMs <= MS_FINAL_WINDOW) {
          const dedupe = `${baseDedupe}_wfin`;
          const inserted = await tryInsertPaidChatJanitorAlertLog(
            user.telegramId,
            PAID_CHAT_JANITOR_ALERT_TYPE.EXPIRY_WARN_FINAL,
            dedupe,
            meta,
          );
          if (inserted) {
            await sendTelegramBotMessage(
              user.telegramId,
              buildExpiryWarnFinalUa({
                chatLabels,
                remainingMs,
                grantEndsAtIso,
              }),
            );
            await maybeDelay(delayMs);
            result.sentFinal += 1;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`telegram ${user.telegramId}: ${msg}`);
      }
    }
  }

  return result;
}
