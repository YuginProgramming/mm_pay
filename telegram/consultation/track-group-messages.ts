/**
 * Logs incoming Telegram updates so you can read chat_id and message_thread_id (topic id).
 * Uses CONSULTATION_BOT_TOKEN from .env.
 *
 * Command `/addtopic` (in a forum supergroup): creates a new topic named `topic1`, `topic2`, … per chat.
 *
 * Important:
 * - Stop the main consultation bot (or any other poller) while this runs — one token = one getUpdates consumer.
 * - In groups, if the bot does not see normal messages, disable privacy: BotFather → /setprivacy → Disable.
 * - Bot must be admin with `can_manage_topics` in that supergroup.
 */
import "dotenv/config";
import { Telegraf } from "telegraf";
import type { Message } from "telegraf/types";
import { createForumTopic } from "./forum-api";

const token = process.env.CONSULTATION_BOT_TOKEN;
if (!token) {
  throw new Error("CONSULTATION_BOT_TOKEN is not set.");
}

/** Per-chat sequential index for `/addtopic` names (topic1, topic2, …). */
const topicNameCounter = new Map<number, number>();

function peekNextTopicIndex(chatId: number): number {
  return (topicNameCounter.get(chatId) ?? 0) + 1;
}

function isAddTopicCommand(text: string | undefined): boolean {
  if (!text) return false;
  return /^\/addtopic(@\S+)?(\s|$)/.test(text.trim());
}

function preview(msg: Message): string {
  if ("text" in msg && msg.text) {
    return msg.text.slice(0, 400);
  }
  if ("caption" in msg && msg.caption) {
    return `[caption] ${msg.caption.slice(0, 350)}`;
  }
  if ("photo" in msg && msg.photo?.length) return "[photo]";
  if ("video" in msg && msg.video) return "[video]";
  if ("animation" in msg && msg.animation) return "[gif]";
  if ("document" in msg && msg.document) {
    return `[document] ${msg.document.file_name ?? ""}`;
  }
  if ("voice" in msg && msg.voice) return "[voice]";
  if ("video_note" in msg && msg.video_note) return "[video_note]";
  if ("sticker" in msg && msg.sticker) return "[sticker]";
  return "[non-text]";
}

function logUpdate(kind: string, msg: Message): void {
  const chat = msg.chat;
  const threadId = msg.message_thread_id;
  const from =
    msg.from?.username != null
      ? `@${msg.from.username}`
      : msg.from?.id != null
        ? String(msg.from.id)
        : "?";

  console.log(
    `[${kind}] chat_id=${chat.id} chat_type=${chat.type} topic_id=${threadId ?? "—"} from=${from}`,
  );
  console.log(`  body: ${preview(msg)}`);
}

const bot = new Telegraf(token);

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
      `[addtopic] created name=${name} chat_id=${chatId} topic_id=${message_thread_id}`,
    );
    await ctx.reply(
      `Створено тему «${name}».\nmessage_thread_id (topic_id)=${message_thread_id}`,
      { message_thread_id: ctx.message?.message_thread_id },
    );
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error("[addtopic] failed:", err);
    await ctx.reply(
      `Не вдалося створити тему: ${err}\nПеревірте: форум увімкнено, бот — адмін із can_manage_topics.`,
      { message_thread_id: ctx.message?.message_thread_id },
    );
  }
});

bot.on("message", (ctx) => {
  const msg = ctx.message;
  if (!msg) return;
  if ("text" in msg && isAddTopicCommand(msg.text)) return;
  logUpdate("message", msg);
});

bot.on("edited_message", (ctx) => {
  const msg = ctx.editedMessage;
  if (!msg) return;
  logUpdate("edited_message", msg);
});

void (async () => {
  console.log(
    "Tracking messages for CONSULTATION_BOT_TOKEN (all chats the bot receives). Ctrl+C to stop.\n",
  );
  await bot.launch({
    allowedUpdates: ["message", "edited_message"],
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();
