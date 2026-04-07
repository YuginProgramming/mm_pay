import { Context, Telegraf } from "telegraf";
import { isPrivateChat } from "../core/chat-guards";

/**
 * Прибирає сервісне повідомлення про вхід учасника(-ів) у групу/супергрупу/канал,
 * якщо API дозволяє (бот — адміністратор із «Видалення повідомлень»).
 * У приватному чаті з ботом не застосовується.
 *
 * Не всі типи вступу дають окреме повідомлення в чаті; якщо deleteMessage повертає
 * помилку — перевірте права бота (часто достатньо лишити попередження в логах).
 */
function hasNewChatMembers(
  msg: Context["message"],
): msg is Context["message"] & { new_chat_members: unknown[] } {
  return Boolean(
    msg &&
      "new_chat_members" in msg &&
      Array.isArray(msg.new_chat_members) &&
      msg.new_chat_members.length > 0,
  );
}

export function registerJoinServiceMessageCleanup(bot: Telegraf<Context>): void {
  bot.use(async (ctx, next) => {
    const msg = ctx.message;
    if (!hasNewChatMembers(msg)) {
      return next();
    }
    if (isPrivateChat(ctx)) {
      return next();
    }

    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.warn(
        "[join-service-message-cleanup] deleteMessage:",
        err instanceof Error ? err.message : err,
      );
    }

    return next();
  });
}
