// telegram/consultation/consultation-bot.ts
import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const token = process.env.CONSULTATION_BOT_TOKEN;

if (!token) {
  throw new Error(
    "CONSULTATION_BOT_TOKEN is not set. Add it to the environment (e.g. .env).",
  );
}

/** Optional: URL for «Хочу навчання» (S20) — e.g. course landing page */
const landingUrl = process.env.CONSULTATION_LANDING_URL?.trim() || undefined;
const accountBotUrl = "https://t.me/multimasking_account_bot";

export const consultationBot = new Telegraf(token);

const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
] as const;

const CB = {
  s1: "menu:s1",
  s10: "menu:s10",
  s2: "menu:s2",
  s20: "menu:s20",
} as const;

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Я проходив навчання", CB.s10)],
    [Markup.button.callback("Консультація", CB.s2)],
    [Markup.button.callback("Хочу навчання", CB.s20)],
  ]);
}

function backKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("« Назад до меню", CB.s1)],
  ]);
}

const TEXT_S1 =
  "Головне меню — вибір сценарію.\n\nОберіть, що вам зараз потрібно:";

const TEXT_S10 =
  "Я проходив навчання\n\n" +
  "Тут буде перехід до підписки та продовження роботи в академії. " +
  "Цей блок у розробці.";

const TEXT_S2 =
  "Консультація\n\n" +
  "Тут буде опис формату консультації та кнопка оплати. " +
  "Далі — коротка анкета та звʼязок із менеджером (підключимо наступним кроком).";

const TEXT_S20 =
  "Хочу навчання\n\n" +
  "Ознайомтеся з програмою на лендингу або поверніться до головного меню.";

consultationBot.start(async (ctx) => {
  await ctx.reply(TEXT_S1, mainMenuKeyboard());
});

consultationBot.action(CB.s1, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(TEXT_S1, mainMenuKeyboard());
});

consultationBot.action(CB.s10, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    TEXT_S10,
    Markup.inlineKeyboard([
      [Markup.button.url("Перейти в акаунт-бот", accountBotUrl)],
      [Markup.button.callback("« Назад до меню", CB.s1)],
    ]),
  );
});

consultationBot.action(CB.s2, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(TEXT_S2, backKeyboard());
});

consultationBot.action(CB.s20, async (ctx) => {
  await ctx.answerCbQuery();
  const s20Body = landingUrl
    ? TEXT_S20
    : `${TEXT_S20}\n\n(Посилання на лендинг зʼявиться після налаштування CONSULTATION_LANDING_URL.)`;
  const kb = landingUrl
    ? Markup.inlineKeyboard([
        [Markup.button.url("Відкрити лендинг", landingUrl)],
        [Markup.button.callback("« Назад до меню", CB.s1)],
      ])
    : backKeyboard();
  await ctx.editMessageText(s20Body, kb);
});

consultationBot.command("cancel", async (ctx) => {
  await ctx.reply(
    "Меню скинуто. Натисніть /start, щоб відкрити головне меню.",
  );
});

export async function launchConsultationBot(): Promise<void> {
  await consultationBot.telegram.setMyCommands([
    { command: "start", description: "Головне меню" },
    { command: "cancel", description: "Скинути й вийти" },
  ]);

  await consultationBot.launch({ allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] });
  console.log("Consultation Telegram bot started (polling)");

  process.once("SIGINT", () => consultationBot.stop("SIGINT"));
  process.once("SIGTERM", () => consultationBot.stop("SIGTERM"));
}
