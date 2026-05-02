// telegram/consultation/consultation-bot.ts
import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { createForumTopic, sendMessageInTopic } from "./forum-api";

const token = process.env.CONSULTATION_BOT_TOKEN;

if (!token) {
  throw new Error(
    "CONSULTATION_BOT_TOKEN is not set. Add it to the environment (e.g. .env).",
  );
}

/** Forum supergroup id (negative), e.g. -1001234567890 */
const managerChatIdRaw = process.env.CONSULTATION_MANAGER_CHAT_ID;
const managerChatId = managerChatIdRaw
  ? Number(managerChatIdRaw)
  : undefined;

type Session =
  | { step: "idle" }
  | { step: "await_details"; intent: string };

const sessions = new Map<number, Session>();

const INTENTS: Record<string, string> = {
  studied: "Вже навчався / навчалася",
  training: "Хочу навчання",
  diagnostics: "Потрібна діагностика",
  other: "Інше",
};

export const consultationBot = new Telegraf(token);

const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
] as const;

consultationBot.start(async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  sessions.set(uid, { step: "idle" });
  await ctx.reply(
    "Консультація Multimasking.\n\nСпочатку коротка анкета — після неї менеджер зможе підключитися до вашого запиту.\n\nОберіть, що вам ближче:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(INTENTS.studied, "intent:studied"),
        Markup.button.callback(INTENTS.training, "intent:training"),
      ],
      [
        Markup.button.callback(INTENTS.diagnostics, "intent:diagnostics"),
        Markup.button.callback(INTENTS.other, "intent:other"),
      ],
    ]),
  );
});

consultationBot.action(/^intent:(\w+)$/, async (ctx) => {
  const uid = ctx.from?.id;
  const intentKey = ctx.match[1];
  if (!uid || !INTENTS[intentKey]) {
    await ctx.answerCbQuery("Невідомий варіант");
    return;
  }
  await ctx.answerCbQuery();
  sessions.set(uid, { step: "await_details", intent: intentKey });
  await ctx.editMessageText(
    `Обрано: ${INTENTS[intentKey]}\n\nОпишіть запит своїми словами (одне повідомлення). Після цього ми передаємо його команді.`,
  );
});

consultationBot.command("cancel", async (ctx) => {
  const uid = ctx.from?.id;
  if (uid) sessions.set(uid, { step: "idle" });
  await ctx.reply("Анкету скинуто. Натисніть /start, щоб почати знову.");
});

consultationBot.on("text", async (ctx) => {
  const uid = ctx.from?.id;
  if (!uid) return;
  const session = sessions.get(uid) ?? { step: "idle" };
  if (session.step !== "await_details") {
    await ctx.reply("Натисніть /start, щоб пройти анкету.");
    return;
  }

  const details = ctx.message.text.trim();
  if (!details) {
    await ctx.reply("Надішліть непорожній текст.");
    return;
  }

  const intentLabel = INTENTS[session.intent] ?? session.intent;
  const username = ctx.from.username
    ? `@${ctx.from.username}`
    : "(без username)";
  const summary =
    `Нова консультація\n` +
    `Користувач: ${username} (id ${uid})\n` +
    `Намір: ${intentLabel}\n` +
    `Запит:\n${details}`;

  sessions.set(uid, { step: "idle" });

  if (managerChatId === undefined || Number.isNaN(managerChatId)) {
    await ctx.reply(
      "Дякуємо! Ваш запит прийнято. Менеджер підключиться найближчим часом у цьому чаті.\n\n(Адміністратору: задайте CONSULTATION_MANAGER_CHAT_ID для створення тем у форумі.)",
    );
    console.warn(
      "[consultation] CONSULTATION_MANAGER_CHAT_ID not set; skipping forum topic.",
    );
    return;
  }

  const topicTitle = `C ${uid} | ${intentLabel.slice(0, 40)}`;
  try {
    const { message_thread_id } = await createForumTopic(
      token,
      managerChatId,
      topicTitle.slice(0, 128),
    );
    await sendMessageInTopic(token, managerChatId, message_thread_id, summary);
    await ctx.reply(
      "Дякуємо! Запит передано команді — менеджер відповість тут у боті, щойно буде можливість.",
    );
  } catch (e) {
    console.error("[consultation] Forum handoff failed:", e);
    await ctx.reply(
      "Анкету збережено, але не вдалося створити тему для менеджерів. Команда все одно побачить це після налаштування. Дякуємо за терпіння!",
    );
  }
});

export async function launchConsultationBot(): Promise<void> {
  await consultationBot.telegram.setMyCommands([
    { command: "start", description: "Почати анкету консультації" },
    { command: "cancel", description: "Скинути анкету" },
  ]);

  await consultationBot.launch({ allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] });
  console.log("Consultation Telegram bot started (polling)");

  process.once("SIGINT", () => consultationBot.stop("SIGINT"));
  process.once("SIGTERM", () => consultationBot.stop("SIGTERM"));
}
