/**
 * Logs incoming Telegram updates so you can read chat_id and message_thread_id (topic id).
 * Uses CONSULTATION_BOT_TOKEN from .env.
 *
 * Command `/addtopic` (in a forum supergroup): creates a new topic named `topic1`, `topic2`, … per chat.
 *
 * Important:
 * - Stop the main consultation bot (or any other poller) while this runs — one token = one getUpdates consumer.
 * - In groups, if the bot does not see normal messages, disable privacy: BotFather → /setprivacy → Disable.
 * - Bot must be admin with `can_manage_topics` in that supergroup.
 */
import "dotenv/config";
import { Telegraf } from "telegraf";
import { registerConsultationTraceHandlers } from "./trace-handlers";

const token = process.env.CONSULTATION_BOT_TOKEN;
if (!token) {
  throw new Error("CONSULTATION_BOT_TOKEN is not set.");
}

const bot = new Telegraf(token);
registerConsultationTraceHandlers(bot, token, {
  enableAddTopicCommand: true,
  consolePrefix: "[consultation-track]",
});

void (async () => {
  console.log(
    "Tracking messages for CONSULTATION_BOT_TOKEN (all chats the bot receives). Ctrl+C to stop.\n",
  );
  await bot.launch({
    allowedUpdates: ["message", "edited_message"],
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();
