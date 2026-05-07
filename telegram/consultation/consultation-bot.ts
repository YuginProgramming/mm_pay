import "dotenv/config";
import { Telegraf } from "telegraf";
import { registerMenuHandlers } from "./menu-handlers";
import { registerIntakeHandlers } from "./intake-handlers";
import { registerRelayHandlers } from "./relay-handlers";

const token = process.env.CONSULTATION_BOT_TOKEN;

if (!token) {
  throw new Error(
    "CONSULTATION_BOT_TOKEN is not set. Add it to the environment (e.g. .env).",
  );
}

const landingUrl = process.env.CONSULTATION_LANDING_URL?.trim() || undefined;
const accountBotUrl = "https://t.me/multimasking_account_bot";

export const consultationBot = new Telegraf(token);

const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
] as const;

registerMenuHandlers(consultationBot, { accountBotUrl, landingUrl });
registerIntakeHandlers(consultationBot);
registerRelayHandlers(consultationBot);

export async function launchConsultationBot(): Promise<void> {
  await consultationBot.telegram.setMyCommands([
    { command: "start", description: "Головне меню" },
    { command: "cancel", description: "Скинути й вийти" },
    { command: "intake_start_test", description: "Тестовий старт intake" },
  ]);

  await consultationBot.launch({ allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] });
  console.log("Consultation Telegram bot started (polling)");

  process.once("SIGINT", () => consultationBot.stop("SIGINT"));
  process.once("SIGTERM", () => consultationBot.stop("SIGTERM"));
}
