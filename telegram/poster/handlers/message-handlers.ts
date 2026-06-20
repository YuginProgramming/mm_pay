import type { Context, Telegraf } from "telegraf";
import { assertPosterAuthorized, posterTelegramUserId } from "../auth-guard";
import {
  POSTER_BUTTON_ADDED,
  POSTER_BUTTON_ALREADY_ADDED,
  POSTER_CONTENT_ALREADY_SET_HINT,
  POSTER_CREATE_POST_COMMAND,
  POSTER_IDLE_HINT,
  POSTER_PROMPT_BUTTONS,
  POSTER_PUBLISHED_MASTERS_OK,
  POSTER_PUBLISHED_PRO_OK,
  POSTER_PUBLISH_FAILED,
  POSTER_REPLY_LABEL_ADD_ACCOUNT,
  POSTER_REPLY_LABEL_ADD_CONSULTATION,
  POSTER_REPLY_LABEL_ADD_VIDEO,
  POSTER_REPLY_LABEL_PUBLISH_MASTERS,
  POSTER_REPLY_LABEL_PUBLISH_PRO,
  POSTER_UNSUPPORTED_CONTENT_HINT,
} from "../constants";
import {
  addPosterDraftButton,
  clearPosterDraft,
  getPosterDraft,
  setPosterDraftContent,
  type PosterDraftButtonKey,
} from "../draft-session";
import { posterReplyKeyboard, posterReplyKeyboardRemove } from "../keyboards";
import { parsePosterDraftContent } from "../parse-content";
import {
  isPosterPublishTargetChat,
  POSTER_MASTERS_GROUP_NOT_CONFIGURED_MESSAGE,
  POSTER_PRO_GROUP_NOT_CONFIGURED_MESSAGE,
  resolvePosterPublishGroupIds,
} from "../poster-config";
import {
  publishPosterDraftToGroup,
  sendPosterDraftPreview,
} from "../publish-draft";
import { handlePosterCreatePostText } from "./command-handlers";

const REPLY_TO_BUTTON: Record<string, PosterDraftButtonKey> = {
  [POSTER_REPLY_LABEL_ADD_CONSULTATION]: "consultation",
  [POSTER_REPLY_LABEL_ADD_ACCOUNT]: "account",
  [POSTER_REPLY_LABEL_ADD_VIDEO]: "video_platform",
};

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

async function tryPublishDraft(
  ctx: Context,
  targetGroupId: string | null,
  notConfiguredMessage: string,
  successMessage: string,
  userId: number,
): Promise<boolean> {
  if (!targetGroupId) {
    await ctx.reply(notConfiguredMessage);
    return true;
  }
  try {
    await publishPosterDraftToGroup(
      ctx.telegram,
      targetGroupId,
      getPosterDraft(userId),
    );
    await ctx.reply(successMessage, posterReplyKeyboardRemove);
    clearPosterDraft(userId);
  } catch (error) {
    console.error("[poster] publish failed:", error);
    await ctx.reply(POSTER_PUBLISH_FAILED);
  }
  return true;
}

export function registerPosterMessageHandlers(bot: Telegraf<Context>): void {
  bot.on("message", async (ctx) => {
    if (!ctx.chat || !ctx.message) {
      return;
    }

    const groupIds = await resolvePosterPublishGroupIds();
    if (isPosterPublishTargetChat(ctx.chat.id, groupIds)) {
      return;
    }

    if (!isPrivateChat(ctx)) {
      return;
    }

    if (await handlePosterCreatePostText(ctx)) {
      return;
    }

    if (!(await assertPosterAuthorized(ctx))) {
      return;
    }

    const userId = posterTelegramUserId(ctx);
    if (userId == null) {
      return;
    }

    const draft = getPosterDraft(userId);
    const text =
      "text" in ctx.message && typeof ctx.message.text === "string"
        ? ctx.message.text.trim()
        : "";

    if (draft.state === "idle") {
      if (text.startsWith("/") && text !== `/${POSTER_CREATE_POST_COMMAND}`) {
        return;
      }
      if (text) {
        await ctx.reply(POSTER_IDLE_HINT);
      }
      return;
    }

    if (draft.state === "awaiting_content") {
      const content = parsePosterDraftContent(ctx.message);
      if (!content) {
        await ctx.reply(POSTER_UNSUPPORTED_CONTENT_HINT);
        return;
      }
      setPosterDraftContent(userId, content);
      await ctx.reply(POSTER_PROMPT_BUTTONS, posterReplyKeyboard);
      await sendPosterDraftPreview(ctx, getPosterDraft(userId));
      return;
    }

    if (draft.state === "awaiting_buttons") {
      if (text === POSTER_REPLY_LABEL_PUBLISH_MASTERS) {
        await tryPublishDraft(
          ctx,
          groupIds.mastersGroupId,
          POSTER_MASTERS_GROUP_NOT_CONFIGURED_MESSAGE,
          POSTER_PUBLISHED_MASTERS_OK,
          userId,
        );
        return;
      }

      if (text === POSTER_REPLY_LABEL_PUBLISH_PRO) {
        await tryPublishDraft(
          ctx,
          groupIds.proGroupId,
          POSTER_PRO_GROUP_NOT_CONFIGURED_MESSAGE,
          POSTER_PUBLISHED_PRO_OK,
          userId,
        );
        return;
      }

      const buttonKey = text ? REPLY_TO_BUTTON[text] : undefined;
      if (buttonKey) {
        const current = getPosterDraft(userId);
        if (current.buttons.includes(buttonKey)) {
          await ctx.reply(POSTER_BUTTON_ALREADY_ADDED);
          return;
        }
        addPosterDraftButton(userId, buttonKey);
        await ctx.reply(POSTER_BUTTON_ADDED);
        await sendPosterDraftPreview(ctx, getPosterDraft(userId));
        return;
      }

      if (parsePosterDraftContent(ctx.message)) {
        await ctx.reply(POSTER_CONTENT_ALREADY_SET_HINT);
        return;
      }

      if (text) {
        await ctx.reply(POSTER_PROMPT_BUTTONS);
      }
    }
  });
}
