import {
  getPosterProGroupId,
  getPosterTargetGroupId,
} from "../../database/app-settings-queries";

const TARGET_GROUP_CACHE_MS = 60_000;

export type PosterPublishGroupIds = {
  mastersGroupId: string | null;
  proGroupId: string | null;
};

let cachedGroupIds: PosterPublishGroupIds | undefined;
let cachedGroupIdsAtMs = 0;

async function loadPosterPublishGroupIds(): Promise<PosterPublishGroupIds> {
  const [mastersGroupId, proGroupId] = await Promise.all([
    getPosterTargetGroupId(),
    getPosterProGroupId(),
  ]);
  return { mastersGroupId, proGroupId };
}

/** `target_group_id` (Masters) та `poster_pro_group_id` (Pro) з коротким кешем. */
export async function resolvePosterPublishGroupIds(): Promise<PosterPublishGroupIds> {
  const now = Date.now();
  if (
    cachedGroupIds !== undefined &&
    now - cachedGroupIdsAtMs < TARGET_GROUP_CACHE_MS
  ) {
    return cachedGroupIds;
  }
  cachedGroupIds = await loadPosterPublishGroupIds();
  cachedGroupIdsAtMs = now;
  return cachedGroupIds;
}

/** @deprecated використовуйте resolvePosterPublishGroupIds */
export async function resolvePosterTargetGroupId(): Promise<string | null> {
  const { mastersGroupId } = await resolvePosterPublishGroupIds();
  return mastersGroupId;
}

export function isPosterPublishTargetChat(
  chatId: number | string,
  groupIds: PosterPublishGroupIds,
): boolean {
  const id = String(chatId);
  return (
    (groupIds.mastersGroupId != null && id === groupIds.mastersGroupId) ||
    (groupIds.proGroupId != null && id === groupIds.proGroupId)
  );
}

export const POSTER_MASTERS_GROUP_NOT_CONFIGURED_MESSAGE =
  "Групу Masters не налаштовано (app_settings.target_group_id).";

export const POSTER_PRO_GROUP_NOT_CONFIGURED_MESSAGE =
  "Групу Pro не налаштовано (app_settings.poster_pro_group_id).";

/** @deprecated */
export const POSTER_TARGET_GROUP_NOT_CONFIGURED_MESSAGE =
  POSTER_MASTERS_GROUP_NOT_CONFIGURED_MESSAGE;
