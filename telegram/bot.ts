// telegram/bot.ts
import { Telegraf } from "telegraf";
import { registerProChatAccessHandler } from "./email-check";
import {
  registerDeferEmailHandler,
} from "./payment-menu";
import { registerPaymentCheckHandlers } from "./payment-check";
import { registerWayForPayInvoiceHandlers } from "./wayforpay-invoice";
import { registerCommandHandlers } from "./command-handlers";
import { registerTextHandlers } from "./text-handlers";
import { registerRulesAcceptHandler } from "./rules";
import { StartContext } from "./user-tracking";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is not set. Please add it to your environment (e.g. .env).",
  );
}

export const bot = new Telegraf<StartContext>(token);

// Register inline/callback handlers
registerProChatAccessHandler(bot as unknown as any);
registerPaymentCheckHandlers(bot as unknown as any);
registerWayForPayInvoiceHandlers(bot as unknown as any);
registerDeferEmailHandler(bot as unknown as any);
registerRulesAcceptHandler(bot as unknown as any);
registerCommandHandlers(bot);
registerTextHandlers(bot);

export async function launchTelegramBot(): Promise<void> {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Початок роботи з ботом" },
    { command: "payment", description: "Меню оплати (без email)" },
    { command: "profile", description: "Мій профіль і доступні опції" },
    { command: "change_email", description: "Змінити email" },
  ]);

  await bot.launch();
  console.log("Telegram bot started and is now polling for updates");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

