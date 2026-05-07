import { Op, literal } from "sequelize";
import { Telegraf } from "telegraf";
import { ConsultationCase } from "../../database/ConsultationCase";

const ACTIVE_RELAY_STATUSES = [
  "ACTIVE_CONVERSATION",
  "WAITING_MANAGER",
  "WAITING_CLIENT",
] as const;

function parseManagerChatId(): number | null {
  const raw = process.env.CONSULTATION_MANAGER_CHAT_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function findCaseByTopic(input: {
  managerChatId: string;
  messageThreadId: string;
}): Promise<ConsultationCase | null> {
  return ConsultationCase.findOne({
    where: {
      managerChatId: input.managerChatId,
      messageThreadId: input.messageThreadId,
    },
  });
}

async function findActiveCaseByClient(
  telegramUserId: string,
): Promise<ConsultationCase | null> {
  return ConsultationCase.findOne({
    where: {
      telegramUserId,
      status: { [Op.in]: ACTIVE_RELAY_STATUSES as unknown as string[] },
    },
    order: literal("\"updated_at\" DESC"),
  });
}

export function registerRelayHandlers(bot: Telegraf): void {
  bot.on("message", async (ctx) => {
    const managerChatId = parseManagerChatId();
    if (!managerChatId) return;

    const msg = ctx.message as any;
    const fromId = String(msg?.from?.id ?? "");
    const chatId = Number(msg?.chat?.id);
    const chatType = String(msg?.chat?.type ?? "");
    const threadId =
      msg?.message_thread_id == null ? null : String(msg.message_thread_id);
    const text = typeof msg?.text === "string" ? msg.text.trim() : "";

    // Ignore bot-originated messages to prevent relay loops.
    if (msg?.from?.is_bot === true || String(ctx.botInfo?.id ?? "") === fromId) {
      return;
    }

    // Manager -> client relay (messages inside manager forum topic).
    if (chatId === managerChatId && threadId) {
      const c = await findCaseByTopic({
        managerChatId: String(managerChatId),
        messageThreadId: threadId,
      });
      if (!c) return;

      if (text.startsWith("/close")) {
        await c.update({ status: "COMPLETED" });
        await ctx.telegram.sendMessage(
          c.telegramChatId,
          "✅ Консультацію завершено менеджером. Дякуємо!",
        );
        await ctx.reply("Статус кейсу: COMPLETED.");
        return;
      }
      if (text.startsWith("/reopen")) {
        await c.update({ status: "ACTIVE_CONVERSATION" });
        await ctx.telegram.sendMessage(
          c.telegramChatId,
          "🔄 Консультацію поновлено менеджером. Можна продовжувати спілкування.",
        );
        await ctx.reply("Статус кейсу: ACTIVE_CONVERSATION.");
        return;
      }

      if (c.status === "COMPLETED" || c.status === "CANCELLED") return;

      try {
        if (text.length > 0) {
          await ctx.telegram.sendMessage(c.telegramChatId, `[Manager] ${text}`);
        } else {
          await ctx.telegram.copyMessage(c.telegramChatId, managerChatId, msg.message_id);
        }
        await c.update({ status: "WAITING_CLIENT" });
        console.log("[consultation-relay] manager->client", {
          consultationId: c.consultationId,
          threadId,
          clientChatId: c.telegramChatId,
          managerChatId,
        });
      } catch (err) {
        console.error("[consultation-relay] manager->client failed", err);
        await ctx.reply(
          "Не вдалося доставити повідомлення клієнту (можливо, клієнт заборонив DM).",
        );
      }
      return;
    }

    // Client -> manager relay (private DM while case is active).
    if (chatType === "private") {
      // Ignore commands in DM relay channel.
      if (text.startsWith("/")) return;

      const c = await findActiveCaseByClient(fromId);
      if (!c || !c.managerChatId || !c.messageThreadId) return;

      try {
        if (text.length > 0) {
          await ctx.telegram.sendMessage(
            Number(c.managerChatId),
            `[Client] ${text}`,
            { message_thread_id: Number(c.messageThreadId) } as any,
          );
        } else {
          await ctx.telegram.copyMessage(
            Number(c.managerChatId),
            Number(c.telegramChatId),
            msg.message_id,
            { message_thread_id: Number(c.messageThreadId) } as any,
          );
        }
        await c.update({ status: "WAITING_MANAGER" });
        console.log("[consultation-relay] client->manager", {
          consultationId: c.consultationId,
          threadId: c.messageThreadId,
          clientChatId: c.telegramChatId,
          managerChatId: c.managerChatId,
        });
      } catch (err) {
        console.error("[consultation-relay] client->manager failed", err);
        await ctx.reply(
          "Не вдалося передати повідомлення менеджеру. Спробуйте ще раз через хвилину.",
        );
      }
    }
  });
}
