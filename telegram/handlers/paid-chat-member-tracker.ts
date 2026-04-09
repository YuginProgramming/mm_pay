import type { Telegraf } from "telegraf";
import { upsertPaidChatMemberState } from "../../database/paid-chat-member-state-queries";
import type { StartContext } from "../core/user-tracking";
import { resolvePaidChatIdsCached } from "../paid-chat-janitor/paid-chat-resolve-ids";

/**
 * Записує останній статус учасника для MASTERS / Chat PRO з оновлень `chat_member`.
 * Потрібен, бо Bot API не дає повного списку учасників — janitor використовує таблицю для «сторонніх».
 *
 * Увімкніть `chat_member` у `getUpdates` (див. `bot.launch({ allowedUpdates: [...] })` у `bot.ts`).
 * Бот має бути адміністратором групи з правами, що дозволяють отримувати ці оновлення.
 */
export function registerPaidChatMemberTracker(
  bot: Telegraf<StartContext>,
): void {
  bot.on("chat_member", async (ctx) => {
    try {
      const cm = ctx.chatMember;
      if (!cm) {
        return;
      }

      const { mastersChatId, catProChatId } = await resolvePaidChatIdsCached();
      const chatId = cm.chat.id;
      const isMasters = mastersChatId != null && chatId === mastersChatId;
      const isCatPro = catProChatId != null && chatId === catProChatId;
      if (!isMasters && !isCatPro) {
        return;
      }

      const user = cm.new_chat_member.user;
      if (!user || user.is_bot) {
        return;
      }

      await upsertPaidChatMemberState({
        chatId,
        userId: user.id,
        status: cm.new_chat_member.status,
      });
    } catch (e) {
      console.error("[paid-chat-member-tracker]", e);
    }
  });
}
