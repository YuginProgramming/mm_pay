// telegram/consultation/consultation-bot.ts
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
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

type ConsultationMessage = {
  id: string;
  version: number;
  title: string;
  paragraphs: string[];
  cta: {
    text: string;
    action: "payment_client" | "payment_master";
  };
};

function readMessageJson(fileName: string): ConsultationMessage {
  const candidatePaths = [
    path.resolve(process.cwd(), "telegram/consultation/messages", fileName),
    path.resolve(__dirname, "messages", fileName),
  ];
  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw) as ConsultationMessage;
    }
  }
  throw new Error(`Message file not found: ${fileName}`);
}

function renderMessageText(payload: ConsultationMessage): string {
  return [payload.title, ...payload.paragraphs].join("\n\n");
}

const clientMessage = readMessageJson("descr-client.json");
const masterMessage = readMessageJson("descr-master.json");

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
  s2Client: "menu:s2:client",
  s2Master: "menu:s2:master",
  s2ClientPay: "menu:s2:client:pay",
  s2MasterPay: "menu:s2:master:pay",
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
  "Консультація\n\n" + "Оберіть формат:";

const TEXT_S2_CLIENT = renderMessageText(clientMessage);
const TEXT_S2_MASTER = renderMessageText(masterMessage);

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
  await ctx.editMessageText(
    TEXT_S2,
    Markup.inlineKeyboard([
      [Markup.button.callback("👤 Хочу результат для себе", CB.s2Client)],
      [Markup.button.callback("🎓 Я працюю з клієнтами", CB.s2Master)],
      [Markup.button.callback("« Назад до меню", CB.s1)],
    ]),
  );
});

consultationBot.action(CB.s2Client, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    TEXT_S2_CLIENT,
    Markup.inlineKeyboard([
      [Markup.button.callback(clientMessage.cta.text, CB.s2ClientPay)],
      [Markup.button.callback("« Назад", CB.s2)],
      [Markup.button.callback("« Назад до меню", CB.s1)],
    ]),
  );
});

consultationBot.action(CB.s2Master, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    TEXT_S2_MASTER,
    Markup.inlineKeyboard([
      [Markup.button.callback(masterMessage.cta.text, CB.s2MasterPay)],
      [Markup.button.callback("« Назад", CB.s2)],
      [Markup.button.callback("« Назад до меню", CB.s1)],
    ]),
  );
});

consultationBot.action(CB.s2ClientPay, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Блок оплати персональної консультації буде підключено наступним кроком.",
  );
});

consultationBot.action(CB.s2MasterPay, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Блок оплати консультації для майстрів буде підключено наступним кроком.",
  );
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
