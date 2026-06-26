import { Context, Telegraf } from "telegraf";
import { isPrivateChat } from "../core/chat-guards";
import { resolvePaidChatIdsCached } from "../paid-chat-janitor/paid-chat-resolve-ids";

/**
 * Прибирає сервісні повідомлення в групах/супергрупах/каналах, якщо API дозволяє
 * (бот — адміністратор із «Видалення повідомлень»). У приватному чаті з ботом не застосовується.
 *
 * - `new_chat_members` — усі групи, де є бот.
 * - `left_chat_member` (вихід / kick) — лише MASTERS і Chat PRO (`app_settings.telegram_bot_chats_json`).
 *
 * Не всі типи вступу/виходу дають окреме повідомлення; якщо deleteMessage повертає
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

function hasLeftChatMember(
  msg: Context["message"],
): msg is Context["message"] & { left_chat_member: unknown } {
  return Boolean(msg && "left_chat_member" in msg && msg.left_chat_member != null);
}

async function isMastersOrCatProChat(chatId: number | undefined): Promise<boolean> {
  if (chatId == null) {
    return false;
  }
  const { mastersChatId, catProChatId } = await resolvePaidChatIdsCached();
  return (
    (mastersChatId != null && chatId === mastersChatId) ||
    (catProChatId != null && chatId === catProChatId)
  );
}

async function tryDeleteServiceMessage(ctx: Context, label: string): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch (err) {
    console.warn(
      `[join-service-message-cleanup] deleteMessage (${label}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

export function registerJoinServiceMessageCleanup(bot: Telegraf<Context>): void {
  bot.use(async (ctx, next) => {
    const msg = ctx.message;
    if (!msg || isPrivateChat(ctx)) {
      return next();
    }

    if (hasNewChatMembers(msg)) {
      await tryDeleteServiceMessage(ctx, "new_chat_members");
      return next();
    }

    if (hasLeftChatMember(msg)) {
      const inPaidChat = await isMastersOrCatProChat(ctx.chat?.id);
      if (inPaidChat) {
        await tryDeleteServiceMessage(ctx, "left_chat_member");
      }
    }

    return next();
  });
}
