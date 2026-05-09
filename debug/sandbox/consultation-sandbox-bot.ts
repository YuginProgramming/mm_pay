import "dotenv/config";
import { Telegraf } from "telegraf";

const token = process.env.CONSULTATION_BOT_TOKEN;

if (!token) {
  throw new Error("CONSULTATION_BOT_TOKEN is not set.");
}

const sandboxBot = new Telegraf(token);
const CONSULTATION_GROUP_CHAT_ID = -1003907688133;
const THREAD_TO_RELAY_USER_ID: Record<number, number> = {
  17: 269694206,
  93: 6956239629,
};
const USER_TO_THREAD_ID: Record<number, number> = {
  269694206: 17,
  6956239629: 93,
};

sandboxBot.on(["message", "edited_message"], async (ctx) => {
  const message = ctx.message;
  if (!message) {
    return;
  }

  const chat = message?.chat;
  const from = message?.from;
  const chatTitle = chat && "title" in chat ? chat.title : null;
  const threadId = "message_thread_id" in message ? message.message_thread_id : null;

  const text =
    "text" in message
      ? message.text
      : "caption" in message
        ? message.caption
        : undefined;

  console.log(
    JSON.stringify(
      {
        type: ctx.updateType,
        date: new Date().toISOString(),
        chatId: chat?.id ?? null,
        chatType: chat?.type ?? null,
        chatTitle,
        messageId: message?.message_id ?? null,
        threadId,
        fromId: from?.id ?? null,
        fromUsername: from?.username ?? null,
        text: text ?? null,
      },
      null,
      2,
    ),
  );

  const relayText = [
    "[sandbox relay]",
    `type: ${ctx.updateType}`,
    `chatId: ${chat?.id ?? "n/a"}`,
    `chatType: ${chat?.type ?? "n/a"}`,
    `chatTitle: ${chatTitle ?? "n/a"}`,
    `messageId: ${message?.message_id ?? "n/a"}`,
    `threadId: ${threadId ?? "n/a"}`,
    `fromId: ${from?.id ?? "n/a"}`,
    `fromUsername: ${from?.username ?? "n/a"}`,
    `text: ${text ?? "<no text>"}`,
  ].join("\n");

  if (chat?.type === "private" && from?.id && from.id in USER_TO_THREAD_ID) {
    const targetThreadId = USER_TO_THREAD_ID[from.id];
    const reverseRelayText = [
      "[sandbox reverse relay]",
      `fromId: ${from.id}`,
      `fromUsername: ${from.username ?? "n/a"}`,
      "",
      text ?? "<no text>",
    ].join("\n");

    try {
      await sandboxBot.telegram.sendMessage(CONSULTATION_GROUP_CHAT_ID, reverseRelayText, {
        message_thread_id: targetThreadId,
      });
    } catch (error) {
      console.error("[sandbox reverse relay] failed to send to thread:", error);
    }
    return;
  }

  if (!threadId || !(threadId in THREAD_TO_RELAY_USER_ID)) {
    return;
  }

  const relayUserId = THREAD_TO_RELAY_USER_ID[threadId];

  try {
    await sandboxBot.telegram.sendMessage(relayUserId, relayText);
  } catch (error) {
    console.error("[sandbox relay] failed to send DM:", error);
  }
});

void (async () => {
  console.log(
    "Sandbox consultation bot started. Stop the main consultation bot first (same token cannot poll in two processes).",
  );

  await sandboxBot.launch({
    allowedUpdates: ["message", "edited_message"],
  });

  process.once("SIGINT", () => sandboxBot.stop("SIGINT"));
  process.once("SIGTERM", () => sandboxBot.stop("SIGTERM"));
})();
