import { Op, literal } from "sequelize";
import { Telegraf } from "telegraf";
import { ConsultationCase } from "../../database/ConsultationCase";
import { isClientRelayBlockedStatus } from "./consultation-case-status";
import { consultationDebug } from "./debug-log";

type RelayDirection = "manager_to_client" | "client_to_manager" | "unknown";

function previewText(msg: any): string {
  if (typeof msg?.text === "string" && msg.text.trim()) {
    return msg.text.trim().slice(0, 250);
  }
  if (typeof msg?.caption === "string" && msg.caption.trim()) {
    return `[caption] ${msg.caption.trim().slice(0, 220)}`;
  }
  if (msg?.photo?.length) return "[photo]";
  if (msg?.video?.file_id) return "[video]";
  if (msg?.document?.file_id) return `[document] ${msg.document.file_name ?? ""}`;
  return "[non-text]";
}

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

async function findLatestCaseByClient(
  telegramUserId: string,
): Promise<ConsultationCase | null> {
  return ConsultationCase.findOne({
    where: {
      telegramUserId,
      managerChatId: { [Op.ne]: null },
      messageThreadId: { [Op.ne]: null },
    },
    order: literal("\"updated_at\" DESC"),
  });
}

function detectDirection(input: {
  chatId: number;
  chatType: string;
  managerChatId: number | null;
  threadId: string | null;
}): RelayDirection {
  if (input.managerChatId && input.chatId === input.managerChatId && input.threadId) {
    return "manager_to_client";
  }
  if (input.chatType === "private") {
    return "client_to_manager";
  }
  return "unknown";
}

export function registerRelayHandlers(bot: Telegraf): void {
  bot.on("message", async (ctx) => {
    const msg = ctx.message as any;
    const fromId = String(msg?.from?.id ?? "");
    const chatId = Number(msg?.chat?.id);
    const chatType = String(msg?.chat?.type ?? "");
    const threadId =
      msg?.message_thread_id == null ? null : String(msg.message_thread_id);
    const text = typeof msg?.text === "string" ? msg.text.trim() : "";
    const managerChatId = parseManagerChatId();
    const direction = detectDirection({
      chatId,
      chatType,
      managerChatId,
      threadId,
    });
    const baseEvent = {
      consultationId: null as string | null,
      telegramUserId: fromId || null,
      chatId: Number.isFinite(chatId) ? chatId : null,
      threadId,
      messageId: msg?.message_id ?? null,
      direction,
      fromUsername: msg?.from?.username ?? null,
      fromIsBot: msg?.from?.is_bot ?? null,
      senderChatId: msg?.sender_chat?.id ?? null,
      senderChatTitle: msg?.sender_chat?.title ?? null,
      senderChatType: msg?.sender_chat?.type ?? null,
      managerChatIdConfigured: managerChatId,
      textPreview: previewText(msg),
    };

    consultationDebug("relay.in", {
      ...baseEvent,
      chatType,
    });
    if (!managerChatId) {
      consultationDebug("relay.skip", {
        ...baseEvent,
        reason: "manager_chat_not_configured",
        reasonDetails: "CONSULTATION_MANAGER_CHAT_ID is missing or invalid.",
      });
      return;
    }

    // Ignore bot-originated messages to prevent relay loops.
    if (msg?.from?.is_bot === true || String(ctx.botInfo?.id ?? "") === fromId) {
      consultationDebug("relay.skip", {
        ...baseEvent,
        reason: "bot_originated",
        reasonDetails: "Message sender is a bot or this bot instance.",
      });
      return;
    }

    // Manager -> client relay (messages inside manager forum topic).
    if (chatId === managerChatId && threadId) {
      const c = await findCaseByTopic({
        managerChatId: String(managerChatId),
        messageThreadId: threadId,
      });
      if (!c) {
        consultationDebug("relay.skip", {
          ...baseEvent,
          reason: "case_not_found_by_thread",
          reasonDetails: "No consultation case found for manager chat and topic thread.",
        });
        return;
      }
      const eventWithCase = {
        ...baseEvent,
        consultationId: c.consultationId,
        telegramUserId: c.telegramUserId,
      };

      consultationDebug("relay.in", {
        ...eventWithCase,
        chatType,
      });

      try {
        if (text.length > 0) {
          await ctx.telegram.sendMessage(c.telegramChatId, `[Manager] ${text}`);
        } else {
          await ctx.telegram.copyMessage(c.telegramChatId, managerChatId, msg.message_id);
        }
        await c.update({ status: "WAITING_CLIENT" });
        consultationDebug("relay.sent", {
          ...eventWithCase,
          destination: "client_dm",
          destinationChatId: c.telegramChatId,
          nextStatus: "WAITING_CLIENT",
        });
        console.log("[consultation-relay] manager->client", {
          consultationId: c.consultationId,
          threadId,
          clientChatId: c.telegramChatId,
          managerChatId,
        });
      } catch (err) {
        consultationDebug("relay.error", {
          ...eventWithCase,
          destination: "client_dm",
          reason: "telegram_send_failed",
          reasonDetails: "Failed to deliver manager message to client DM.",
          error: err instanceof Error ? err.message : String(err),
        });
        console.error("[consultation-relay] manager->client failed", err);
        await ctx.reply(
          "Не вдалося доставити повідомлення клієнту (можливо, клієнт заборонив DM).",
        );
      }
      return;
    }

    // Client -> manager relay (private DM by latest mapped case).
    if (chatType === "private") {
      const c = await findLatestCaseByClient(fromId);
      if (!c || !c.managerChatId || !c.messageThreadId) {
        consultationDebug("relay.skip", {
          ...baseEvent,
          reason: "case_not_found_by_user",
          reasonDetails: "No mapped consultation case for private sender.",
        });
        return;
      }
      const eventWithCase = {
        ...baseEvent,
        consultationId: c.consultationId,
        telegramUserId: c.telegramUserId,
        threadId: c.messageThreadId,
      };
      consultationDebug("relay.in", {
        ...eventWithCase,
        chatType,
      });

      if (isClientRelayBlockedStatus(c.status)) {
        consultationDebug("relay.skip", {
          ...eventWithCase,
          reason: "awaiting_onboarding",
          reasonDetails: `Case status ${c.status} blocks client relay until name/intake done.`,
        });
        return;
      }

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
        consultationDebug("relay.sent", {
          ...eventWithCase,
          destination: "manager_thread",
          destinationChatId: c.managerChatId,
          nextStatus: "WAITING_MANAGER",
        });
        console.log("[consultation-relay] client->manager", {
          consultationId: c.consultationId,
          threadId: c.messageThreadId,
          clientChatId: c.telegramChatId,
          managerChatId: c.managerChatId,
        });
      } catch (err) {
        consultationDebug("relay.error", {
          ...eventWithCase,
          destination: "manager_thread",
          reason: "telegram_send_failed",
          reasonDetails: "Failed to deliver client message to manager thread.",
          error: err instanceof Error ? err.message : String(err),
        });
        console.error("[consultation-relay] client->manager failed", err);
        await ctx.reply(
          "Не вдалося передати повідомлення менеджеру. Спробуйте ще раз через хвилину.",
        );
      }
      return;
    }

    consultationDebug("relay.skip", {
      ...baseEvent,
      reason: "unsupported_chat_context",
      reasonDetails: "Message does not belong to manager topic relay or private DM relay.",
    });
  });
}
