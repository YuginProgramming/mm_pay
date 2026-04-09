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
import { registerPaidChatMemberTracker } from "./handlers/paid-chat-member-tracker";
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

/**
 * За замовчуванням getUpdates **не** повертає `chat_member`; без нього paid-chat intruder — не працює.
 * @see TZ/user-control-crawler.txt §7.8
 */
const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "inline_query",
  "chosen_inline_result",
  "callback_query",
  "shipping_query",
  "pre_checkout_query",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
] as const;

registerJoinServiceMessageCleanup(bot as unknown as any);
registerPaidChatMemberTracker(bot);

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

  await bot.launch({ allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] });
  console.log("Telegram bot started and is now polling for updates");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
