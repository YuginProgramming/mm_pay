/**
 * Числові chatId MASTERS / Chat PRO з app_settings (TZ §6.1) + короткоживучий кеш для handlers.
 */
import { APP_SETTING_KEYS } from "../../database/app-setting-keys";
import { getAppSettingString } from "../../database/app-settings-queries";
import { parseTelegramBotChatsJson, resolvePaidChatRows } from "./chats-config";

export type ResolvedPaidChatIds = {
  mastersChatId: number | null;
  catProChatId: number | null;
};

export async function resolvePaidChatIdsFromAppSettings(): Promise<ResolvedPaidChatIds> {
  const raw = await getAppSettingString(APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON);
  const rows = parseTelegramBotChatsJson(raw ?? "[]");
  const { masters, catPro } = resolvePaidChatRows(rows);
  return {
    mastersChatId: masters?.chatId ?? null,
    catProChatId: catPro?.chatId ?? null,
  };
}

const CACHE_MS = 60_000;
let cache: { at: number; value: ResolvedPaidChatIds } | null = null;

export async function resolvePaidChatIdsCached(): Promise<ResolvedPaidChatIds> {
  const now = Date.now();
  if (cache != null && now - cache.at < CACHE_MS) {
    return cache.value;
  }
  const value = await resolvePaidChatIdsFromAppSettings();
  cache = { at: now, value };
  return value;
}

export function invalidatePaidChatIdsCache(): void {
  cache = null;
}
