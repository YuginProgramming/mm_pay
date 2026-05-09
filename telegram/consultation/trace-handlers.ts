import { Telegraf } from "telegraf";
import type { Message } from "telegraf/types";
import { createForumTopic } from "./forum-api";

type TraceKind = "message" | "edited_message";

type TraceOptions = {
  enableAddTopicCommand?: boolean;
  consolePrefix?: string;
};

const topicNameCounter = new Map<number, number>();

function peekNextTopicIndex(chatId: number): number {
  return (topicNameCounter.get(chatId) ?? 0) + 1;
}

function isAddTopicCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/addtopic(@\S+)?(\s|$)/.test(text.trim());
}

function preview(msg: Message): string {
  if ("text" in msg && msg.text) return msg.text.slice(0, 500);
  if ("caption" in msg && msg.caption) return `[caption] ${msg.caption.slice(0, 450)}`;
  if ("photo" in msg && msg.photo?.length) return "[photo]";
  if ("video" in msg && msg.video) return "[video]";
  if ("document" in msg && msg.document) return `[document] ${msg.document.file_name ?? ""}`;
  if ("sticker" in msg && msg.sticker) return "[sticker]";
  if ("voice" in msg && msg.voice) return "[voice]";
  return "[non-text]";
}

function buildTracePayload(kind: TraceKind, msg: Message): Record<string, unknown> {
  const sender = (msg as any).sender_chat;
  return {
    ts: new Date().toISOString(),
    stream: "consultation-trace",
    kind,
    messageId: (msg as any).message_id ?? null,
    date: (msg as any).date ?? null,
    chatId: msg.chat?.id ?? null,
    chatType: msg.chat?.type ?? null,
    topicId: (msg as any).message_thread_id ?? null,
    textPreview: preview(msg),
    fromId: msg.from?.id ?? null,
    fromUsername: msg.from?.username ?? null,
    fromIsBot: msg.from?.is_bot ?? null,
    senderChatId: sender?.id ?? null,
    senderChatTitle: sender?.title ?? null,
    senderChatType: sender?.type ?? null,
  };
}

export function registerConsultationTraceHandlers(
  bot: Telegraf,
  token: string,
  options: TraceOptions = {},
): void {
  const enableAddTopicCommand = options.enableAddTopicCommand ?? false;
  const consolePrefix = options.consolePrefix ?? "[consultation-trace]";

  if (enableAddTopicCommand) {
    bot.command("addtopic", async (ctx) => {
      const chat = ctx.chat;
      if (!chat) return;
      if (chat.type !== "supergroup") {
        await ctx.reply("Створюйте теми лише у форум-супергрупі (Topics увімкнено).");
        return;
      }

      const chatId = chat.id;
      const n = peekNextTopicIndex(chatId);
      const name = `topic${n}`;
      try {
        const { message_thread_id } = await createForumTopic(token, chatId, name);
        topicNameCounter.set(chatId, n);
        console.log(
          `${consolePrefix} addtopic created name=${name} chat_id=${chatId} topic_id=${message_thread_id}`,
        );
        await ctx.reply(
          `Створено тему «${name}».\nmessage_thread_id (topic_id)=${message_thread_id}`,
          { message_thread_id: ctx.message?.message_thread_id },
        );
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        console.error(`${consolePrefix} addtopic failed:`, err);
        await ctx.reply(
          `Не вдалося створити тему: ${err}\nПеревірте: форум увімкнено, бот — адмін із can_manage_topics.`,
          { message_thread_id: ctx.message?.message_thread_id },
        );
      }
    });
  }

  bot.on("message", (ctx) => {
    const msg = ctx.message;
    if (!msg) return;
    if (enableAddTopicCommand && "text" in msg && isAddTopicCommand(msg.text)) return;
    console.log(JSON.stringify(buildTracePayload("message", msg)));
  });

  bot.on("edited_message", (ctx) => {
    const msg = ctx.editedMessage;
    if (!msg) return;
    console.log(JSON.stringify(buildTracePayload("edited_message", msg)));
  });
}
