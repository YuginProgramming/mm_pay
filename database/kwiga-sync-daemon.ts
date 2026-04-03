import "dotenv/config";
import { APP_SETTING_KEYS } from "./app-setting-keys";
import { getAppSettingInt } from "./app-settings-queries";
import { sequelize } from "./db";
import { assertKwigaEnv, runKwigaSyncOnce } from "./sync-from-kwiga";

/**
 * План §2.1: регулярний crawl KWIGA → локальна БД (contacts, kwiga_products, contact_product_access).
 *
 * Інтервал (хвилини):
 *   1) Якщо задано валідний `KWIGA_SYNC_INTERVAL_MINUTES` у .env — він має пріоритет.
 *   2) Інакше `app_settings.setting_key` = `kwiga_sync_interval_minutes` (дефолт після міграції 30).
 *
 * Інші змінні KWIGA / SYNC_* — як у `sync-from-kwiga.ts`.
 *
 * Запуск: `npm run kwiga:sync:daemon` або `node dist/database/kwiga-sync-daemon.js`
 */

const DEFAULT_MIN = 30;

async function resolveIntervalMs(): Promise<number> {
  const envRaw = process.env.KWIGA_SYNC_INTERVAL_MINUTES?.trim();
  if (envRaw) {
    const n = parseInt(envRaw, 10);
    if (!Number.isNaN(n) && n >= 1) {
      return n * 60_000;
    }
    console.warn(
      "[kwiga-sync-daemon] invalid KWIGA_SYNC_INTERVAL_MINUTES env, using app_settings / default",
    );
  }
  const minutes = await getAppSettingInt(
    APP_SETTING_KEYS.KWIGA_SYNC_INTERVAL_MINUTES,
    DEFAULT_MIN,
  );
  const safe = !Number.isNaN(minutes) && minutes >= 1;
  const m = safe ? minutes : DEFAULT_MIN;
  if (!safe) {
    console.warn(
      "[kwiga-sync-daemon] invalid kwiga_sync_interval_minutes in app_settings, using",
      DEFAULT_MIN,
    );
  }
  return m * 60_000;
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
  console.log(`[kwiga-sync-daemon] ${signal}, closing DB pool…`);
  try {
    await sequelize.close();
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  assertKwigaEnv();
  await sequelize.authenticate();

  let running = false;

  const cycle = async () => {
    if (shuttingDown || running) {
      if (running) {
        console.warn("[kwiga-sync-daemon] previous cycle still running, skip tick");
      }
      return;
    }
    running = true;
    const t0 = Date.now();
    try {
      await runKwigaSyncOnce();
      console.log(`[kwiga-sync-daemon] cycle finished in ${Date.now() - t0} ms`);
    } catch (e) {
      console.error("[kwiga-sync-daemon] cycle error:", e);
    } finally {
      running = false;
    }
  };

  const scheduleNext = async (): Promise<void> => {
    if (shuttingDown) return;
    const everyMs = await resolveIntervalMs();
    console.log(
      `[kwiga-sync-daemon] next cycle in ${everyMs / 60_000} min · ${new Date().toISOString()}`,
    );
    timeoutRef = setTimeout(() => {
      void (async () => {
        await cycle();
        await scheduleNext();
      })();
    }, everyMs);
  };

  const firstMs = await resolveIntervalMs();
  console.log(
    `[kwiga-sync-daemon] OK · first pause ${firstMs / 60_000} min after initial cycle · ${new Date().toISOString()}`,
  );

  await cycle();
  await scheduleNext();

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((e) => {
  console.error("[kwiga-sync-daemon] fatal:", e);
  process.exit(1);
});
