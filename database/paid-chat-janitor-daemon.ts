import "dotenv/config";
import { resolvePaidChatJanitorIntervalMs } from "./app-settings-queries";
import { sequelize } from "./db";
import { runPaidChatExpiryAlertsOnce } from "../telegram/paid-chat-janitor/paid-chat-expiry-alerts";
import { runPaidChatJanitorSweepOnce } from "../telegram/paid-chat-janitor/paid-chat-sweep";

/**
 * Таймерний процес paid-chat janitor (TZ/user-control-crawler.txt §7): лише HTTPS Bot API,
 * без getUpdates (той самий `TELEGRAM_BOT_TOKEN`, що й y `run-bot`).
 *
 * Інтервал (секунди):
 *   1) Якщо заданий валідний `PAID_CHAT_JANITOR_INTERVAL_SECONDS` у .env — він має пріоритет (тест: 30).
 *   2) Інакше `app_settings.paid_chat_janitor_interval_seconds` (seed/migration: 7200 = 2 год для production).
 *
 * Затримка між викликами API під час sweep: `PAID_CHAT_JANITOR_MS_DELAY` (мс, не від'ємна), за замовчуванням 0.
 *
 * Одноразовий прогон: `node dist/database/paid-chat-janitor-daemon.js --once`
 *
 * Запуск: `npm run paid-chat:janitor:daemon` або pm2 (див. ecosystem.config.cjs).
 *
 * Порядок циклу: спочатку §7.6 попередження про закінчення терміну (`paid-chat-expiry-alerts`),
 * потім sweep kick + приватне повідомлення після вилучення.
 */

function parseDelayMs(): number {
  const raw = process.env.PAID_CHAT_JANITOR_MS_DELAY?.trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isNaN(n) && n >= 0) {
    return n;
  }
  console.warn(
    "[paid-chat-janitor-daemon] invalid PAID_CHAT_JANITOR_MS_DELAY, using 0",
  );
  return 0;
}

function assertBotToken(): void {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!t) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set (required for paid-chat janitor)");
  }
}

let shuttingDown = false;
let timeoutRef: ReturnType<typeof setTimeout> | undefined;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timeoutRef !== undefined) {
    clearTimeout(timeoutRef);
    timeoutRef = undefined;
  }
  console.log(`[paid-chat-janitor-daemon] ${signal}, closing DB pool…`);
  try {
    await sequelize.close();
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  assertBotToken();
  await sequelize.authenticate();

  const once = process.argv.includes("--once");
  const delayMs = parseDelayMs();

  const cycle = async (): Promise<void> => {
    if (shuttingDown) return;
    const t0 = Date.now();
    try {
      const alerts = await runPaidChatExpiryAlertsOnce({ delayMs });
      if (
        alerts.sent24h > 0 ||
        alerts.sentFinal > 0 ||
        alerts.sentTest1m > 0 ||
        alerts.errors.length > 0
      ) {
        console.log(
          `[paid-chat-janitor-daemon] §7.6 pre-kick alerts · 24h ${alerts.sent24h} · final ${alerts.sentFinal} · test1m ${alerts.sentTest1m}`,
        );
        for (const err of alerts.errors) {
          console.error("[paid-chat-janitor-daemon]", err);
        }
      }
      const r = await runPaidChatJanitorSweepOnce({ delayMs });
      console.log(
        `[paid-chat-janitor-daemon] sweep done in ${Date.now() - t0} ms · checked ${r.usersChecked} · intruder checks ${r.intruderCandidatesChecked} · kicked MASTERS ${r.kickedFromMasters} · kicked Chat PRO ${r.kickedFromCatPro} · post-kick DM ${r.postKickDmSent} · skip admin ${r.skippedAdmin} · skip not in chat ${r.skippedNotInChat}`,
      );
      if (r.errors.length > 0) {
        for (const err of r.errors) {
          console.error("[paid-chat-janitor-daemon]", err);
        }
      }
    } catch (e) {
      console.error("[paid-chat-janitor-daemon] sweep error:", e);
    }
  };

  if (once) {
    await cycle();
    await sequelize.close();
    return;
  }

  let running = false;

  const scheduleNext = (): void => {
    void (async () => {
      if (shuttingDown) {
        return;
      }
      const everyMs = await resolvePaidChatJanitorIntervalMs();
      console.log(
        `[paid-chat-janitor-daemon] next sweep in ${everyMs / 1000}s (${(everyMs / 60_000).toFixed(2)} min) · ${new Date().toISOString()}`,
      );
      timeoutRef = setTimeout(() => {
        void (async () => {
          if (shuttingDown || running) {
            if (running) {
              console.warn(
                "[paid-chat-janitor-daemon] previous sweep still running, skip tick",
              );
            }
          } else {
            running = true;
            try {
              await cycle();
            } finally {
              running = false;
            }
          }
          scheduleNext();
        })();
      }, everyMs);
    })();
  };

  const firstMs = await resolvePaidChatJanitorIntervalMs();
  console.log(
    `[paid-chat-janitor-daemon] OK · first pause ${firstMs / 1000}s after initial sweep · API delay ${delayMs} ms`,
  );

  await cycle();
  scheduleNext();

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((e) => {
  console.error("[paid-chat-janitor-daemon] fatal:", e);
  process.exit(1);
});
