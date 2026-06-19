import { Context, Telegraf } from "telegraf";
import { registerPosterCommandHandlers } from "./handlers/command-handlers";
import { registerPosterMessageHandlers } from "./handlers/message-handlers";
import { POSTER_CREATE_POST_COMMAND } from "./constants";
import { resolvePosterTargetGroupId } from "./poster-config";

const token = process.env.TELEGRAM_BOT_TOKEN_POSTER;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN_POSTER is not set. Please add it to your environment (e.g. .env).",
  );
}

export const posterBot = new Telegraf<Context>(token);

posterBot.catch((err, ctx) => {
  console.error("[poster] unhandled bot error:", err, {
    updateType: ctx?.updateType,
    fromId: ctx?.from?.id,
  });
});

registerPosterCommandHandlers(posterBot);
registerPosterMessageHandlers(posterBot);

export async function launchPosterBot(): Promise<void> {
  const targetGroupId = await resolvePosterTargetGroupId();
  if (!targetGroupId) {
    console.warn(
      "[poster] app_settings.target_group_id is empty — set it in DB before publishing.",
    );
  } else {
    console.log(`Poster bot started. Target group: ${targetGroupId}`);
  }

  await posterBot.telegram.setMyCommands([
    {
      command: POSTER_CREATE_POST_COMMAND,
      description: "Створити пост",
    },
  ]);

  await posterBot.launch();
  process.once("SIGINT", () => posterBot.stop("SIGINT"));
  process.once("SIGTERM", () => posterBot.stop("SIGTERM"));
}
