import type { Context, Telegraf } from "telegraf";
import { assertPosterAuthorized, posterTelegramUserId } from "../auth-guard";
import {
  POSTER_CREATE_POST_COMMAND,
  POSTER_IDLE_HINT,
  POSTER_PROMPT_CONTENT,
} from "../constants";
import { startPosterDraft } from "../draft-session";

const START_MESSAGE =
  "Бот для публікації постів у групу. Оберіть «Створити пост» у меню команд.";

async function beginCreatePostFlow(ctx: Context): Promise<void> {
  const userId = posterTelegramUserId(ctx);
  if (userId == null) {
    return;
  }
  startPosterDraft(userId);
  await ctx.reply(POSTER_PROMPT_CONTENT);
}

export function registerPosterCommandHandlers(bot: Telegraf<Context>): void {
  bot.start(async (ctx) => {
    if (!(await assertPosterAuthorized(ctx))) {
      return;
    }
    await ctx.reply(START_MESSAGE);
  });

  bot.command(POSTER_CREATE_POST_COMMAND, async (ctx) => {
    if (!(await assertPosterAuthorized(ctx))) {
      return;
    }
    await beginCreatePostFlow(ctx);
  });
}

export async function handlePosterCreatePostText(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || typeof message.text !== "string") {
    return false;
  }
  if (message.text.trim() !== "/Створити пост") {
    return false;
  }
  if (!(await assertPosterAuthorized(ctx))) {
    return true;
  }
  await beginCreatePostFlow(ctx);
  return true;
}
