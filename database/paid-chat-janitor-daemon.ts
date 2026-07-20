import "dotenv/config";
import { resolvePaidChatJanitorIntervalMs } from "./app-settings-queries";
import { sequelize } from "./db";
import { runPaidChatJanitorSweepOnce } from "../telegram/paid-chat-janitor/paid-chat-sweep";
import { runSubscriptionAccessReconcileOnce } from "../payment/subscription-access-reconciler.service";
import {
  KWIGA_RECURRING_END_DATE_DELAY_MS,
  runKwigaRecurringEndDatesOnce,
} from "../payment/kwiga-recurring-end-date.service";

/**
 * Пауза (мс) між зверненнями до WayForPay `regularApi STATUS` під час reconcile.
 * Офіційного числового ліміту WayForPay не публікує, тож поводимось консервативно;
 * у поєднанні з pre-filter по `next_charge_at` навантаження мінімальне
 * (TZ/update-access.md §5).
 */
const RECONCILE_STATUS_DELAY_MS = 500;

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
 * Цикл:
 *   1) groups reconcile (пропущені recurring-списання → payment_hook) — TZ/update-access.md
 *   2) KWIGA exact end-date лише для щойно extended (та сама end_at) — TZ/kwiga-recurring-prolong.md
 *   3) sweep kick MASTERS / Chat PRO
 *
 * Прапорець `--reconcile-only`: кроки 1–2 без sweep (для дебагу).
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
  const reconcileOnly = process.argv.includes("--reconcile-only");
  const delayMs = parseDelayMs();

  const cycle = async (): Promise<void> => {
    if (shuttingDown) return;

    // 1) Groups reconcile (завжди apply). Ізольований try/catch.
    let extensions: Array<{ userId: string; targetEndAt: Date }> = [];
    try {
      const rec = await runSubscriptionAccessReconcileOnce({
        apply: true,
        delayMs: RECONCILE_STATUS_DELAY_MS,
      });
      extensions = rec.extensions;
      console.log(
        `[paid-chat-janitor-daemon] reconcile · checked ${rec.checked} · extended ${rec.extended} · skipped ${rec.skipped} · errors ${rec.errors.length}`,
      );
      for (const err of rec.errors) {
        console.error("[paid-chat-janitor-daemon] reconcile:", err);
      }
    } catch (e) {
      console.error("[paid-chat-janitor-daemon] reconcile error:", e);
    }

    // 2) KWIGA exact end-date — лише для users щойно extended groups reconcile.
    if (extensions.length > 0) {
      try {
        const kw = await runKwigaRecurringEndDatesOnce({
          extensions,
          delayMs: KWIGA_RECURRING_END_DATE_DELAY_MS,
        });
        console.log(
          `[paid-chat-janitor-daemon] kwiga-end-date · users ${kw.users} · attempted ${kw.attempted} · updated ${kw.updated} · skipped ${kw.skipped} · errors ${kw.errors.length}`,
        );
        for (const err of kw.errors) {
          console.error("[paid-chat-janitor-daemon] kwiga-end-date:", err);
        }
      } catch (e) {
        console.error("[paid-chat-janitor-daemon] kwiga-end-date error:", e);
      }
    }

    if (reconcileOnly) {
      return;
    }

    // 3) Paid-chat sweep.
    const t0 = Date.now();
    try {
      const r = await runPaidChatJanitorSweepOnce({ delayMs });
      console.log(
        `[paid-chat-janitor-daemon] sweep done in ${Date.now() - t0} ms · checked ${r.usersChecked} · intruder checks ${r.intruderCandidatesChecked} · kicked MASTERS ${r.kickedFromMasters} · kicked Chat PRO ${r.kickedFromCatPro} · skip admin ${r.skippedAdmin} · skip not in chat ${r.skippedNotInChat}`,
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
