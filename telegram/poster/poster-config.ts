import { getPosterTargetGroupId } from "../../database/app-settings-queries";

const TARGET_GROUP_CACHE_MS = 60_000;

let cachedTargetGroupId: string | null | undefined;
let cachedTargetGroupAtMs = 0;

/** `app_settings.target_group_id` з коротким in-memory кешем. */
export async function resolvePosterTargetGroupId(): Promise<string | null> {
  const now = Date.now();
  if (
    cachedTargetGroupId !== undefined &&
    now - cachedTargetGroupAtMs < TARGET_GROUP_CACHE_MS
  ) {
    return cachedTargetGroupId;
  }
  cachedTargetGroupId = await getPosterTargetGroupId();
  cachedTargetGroupAtMs = now;
  return cachedTargetGroupId;
}

export function isPosterTargetGroupChat(
  chatId: number | string,
  targetGroupId: string,
): boolean {
  return String(chatId) === targetGroupId;
}

export const POSTER_TARGET_GROUP_NOT_CONFIGURED_MESSAGE =
  "Цільову групу не налаштовано (app_settings.target_group_id).";
