import type { Context, Telegraf } from "telegraf";
import type { PosterDraft } from "./draft-session";
import { buildPosterInlineKeyboard } from "./keyboards";

type SendContext = Pick<Context, "telegram" | "chat">;

export async function sendPosterDraftPreview(
  ctx: SendContext,
  draft: PosterDraft,
): Promise<void> {
  if (!draft.content || !ctx.chat) {
    return;
  }
  const extra = buildPosterInlineKeyboard(draft.buttons);
  const chatId = ctx.chat.id;

  switch (draft.content.type) {
    case "text":
      await ctx.telegram.sendMessage(chatId, draft.content.text, extra);
      break;
    case "photo":
      await ctx.telegram.sendPhoto(chatId, draft.content.fileId, {
        caption: draft.content.caption,
        ...extra,
      });
      break;
    case "video":
      await ctx.telegram.sendVideo(chatId, draft.content.fileId, {
        caption: draft.content.caption,
        ...extra,
      });
      break;
  }
}

export async function publishPosterDraftToGroup(
  telegram: Telegraf["telegram"],
  targetGroupId: string,
  draft: PosterDraft,
): Promise<void> {
  if (!draft.content) {
    throw new Error("Poster draft has no content");
  }
  const extra = buildPosterInlineKeyboard(draft.buttons);

  switch (draft.content.type) {
    case "text":
      await telegram.sendMessage(targetGroupId, draft.content.text, extra);
      break;
    case "photo":
      await telegram.sendPhoto(targetGroupId, draft.content.fileId, {
        caption: draft.content.caption,
        ...extra,
      });
      break;
    case "video":
      await telegram.sendVideo(targetGroupId, draft.content.fileId, {
        caption: draft.content.caption,
        ...extra,
      });
      break;
  }
}
