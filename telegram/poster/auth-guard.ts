import type { Context } from "telegraf";
import { getPosterAuthorizedUserIds } from "../../database/app-settings-queries";

export const POSTER_ACCESS_DENIED_MESSAGE = "Немає доступу до публікації.";

const AUTHORIZED_IDS_CACHE_MS = 60_000;

let cachedAuthorizedIds: number[] | null = null;
let cachedAuthorizedAtMs = 0;

async function resolveAuthorizedUserIds(): Promise<number[]> {
  const now = Date.now();
  if (
    cachedAuthorizedIds != null &&
    now - cachedAuthorizedAtMs < AUTHORIZED_IDS_CACHE_MS
  ) {
    return cachedAuthorizedIds;
  }
  cachedAuthorizedIds = await getPosterAuthorizedUserIds();
  cachedAuthorizedAtMs = now;
  return cachedAuthorizedIds;
}

export function posterTelegramUserId(ctx: Context): number | null {
  const id = ctx.from?.id;
  return id == null ? null : id;
}

/**
 * Перевіряє `app_settings.poster_authorized_user_ids`.
 * У приватному чаті відмова супроводжується коротким повідомленням.
 */
export async function assertPosterAuthorized(ctx: Context): Promise<boolean> {
  const userId = posterTelegramUserId(ctx);
  if (userId == null) {
    return false;
  }

  const allowed = await resolveAuthorizedUserIds();
  if (allowed.includes(userId)) {
    return true;
  }

  if (ctx.chat?.type === "private") {
    await ctx.reply(POSTER_ACCESS_DENIED_MESSAGE);
  }
  return false;
}
