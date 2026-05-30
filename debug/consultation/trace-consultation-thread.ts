import "dotenv/config";
import { Telegraf } from "telegraf";
import { registerConsultationTraceHandlers } from "../../telegram/consultation/trace-handlers";

const token = process.env.CONSULTATION_BOT_TOKEN?.trim();
if (!token) {
  throw new Error("CONSULTATION_BOT_TOKEN is not set.");
}

const bot = new Telegraf(token);
registerConsultationTraceHandlers(bot, token, {
  enableAddTopicCommand: false,
  consolePrefix: "[consultation-debug-trace]",
});

void (async () => {
  console.log(
    "Tracing consultation bot updates. Stop other consultation pollers first. Ctrl+C to stop.",
  );
  await bot.launch({ allowedUpdates: ["message", "edited_message"] });
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();
