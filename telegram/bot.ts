// telegram/bot.ts
import { Telegraf } from "telegraf";
import { registerProChatAccessHandler } from "./handlers/email-check";
import {
  registerDeferEmailHandler,
} from "./payment/payment-menu";
import { registerPaymentCheckHandlers } from "./payment/payment-check";
import { registerWayForPayInvoiceHandlers } from "./payment/wayforpay-invoice";
import { registerCommandHandlers } from "./handlers/command-handlers";
import { registerJoinServiceMessageCleanup } from "./handlers/join-service-message-cleanup";
import { registerTextHandlers } from "./handlers/text-handlers";
import { registerRulesAcceptHandler } from "./handlers/rules";
import { StartContext } from "./core/user-tracking";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is not set. Please add it to your environment (e.g. .env).",
  );
}

export const bot = new Telegraf<StartContext>(token);

registerJoinServiceMessageCleanup(bot as unknown as any);

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
    { command: "payment", description: "Меню оплати" },
    { command: "profile", description: "Мій профіль і доступні опції" },
    { command: "change_email", description: "Змінити email" },
  ]);

  await bot.launch();
  console.log("Telegram bot started and is now polling for updates");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
