// telegram/bot.ts
import { Telegraf, Context } from "telegraf";
import { TelegramUser } from "../database/TelegramUser";
import {
  buildEmailRequestMessage,
  registerProChatAccessHandler,
} from "./email-check";
import {
  buildPaymentCheckKeyboard,
  registerPaymentCheckHandlers,
} from "./payment-check";

// Narrow type so we can access ctx.from safely
type StartContext = Context & {
  from: NonNullable<Context["from"]>;
};

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is not set. Please add it to your environment (e.g. .env).",
  );
}

export const bot = new Telegraf<StartContext>(token);

// Register inline button handler for ProChat access
registerProChatAccessHandler(bot as unknown as any);
// Register inline button handlers for payment checks
registerPaymentCheckHandlers(bot as unknown as any);

/**
 * Helper to upsert a TelegramUser based on ctx.from
 * Returns { user, isNew } where isNew is true for first-time users.
 */
async function trackTelegramUser(ctx: StartContext): Promise<{
  user: TelegramUser;
  isNew: boolean;
}> {
  const from = ctx.from;

  const telegramId = String(from.id);

  const [user, created] = await TelegramUser.findOrCreate({
    where: { telegramId },
    defaults: {
      telegramId,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
      isBot: from.is_bot ?? false,
      // These fields may not exist on all Telegram versions, so we fall back safely
      isPremium: (from as any).is_premium ?? false,
      addedToAttachmentMenu: (from as any).added_to_attachment_menu ?? false,
      // When user starts the bot, we assume they allow PMs
      allowsWriteToPm: true,
      lastActivity: new Date(),
      totalInteractions: 1,
      isActive: true,
      preferences: null,
    },
  });

  if (!created) {
    // Update profile and activity stats for returning users
    user.username = from.username ?? user.username;
    user.firstName = from.first_name ?? user.firstName;
    user.lastName = from.last_name ?? user.lastName;
    user.languageCode = from.language_code ?? user.languageCode;
    user.isBot = from.is_bot ?? user.isBot;
    user.isPremium = (from as any).is_premium ?? user.isPremium;
    user.addedToAttachmentMenu =
      (from as any).added_to_attachment_menu ?? user.addedToAttachmentMenu;

    user.lastActivity = new Date();
    user.totalInteractions = (user.totalInteractions ?? 0) + 1;
    user.isActive = true;

    await user.save();
  }

  return { user, isNew: created };
}

// Handle /start command – track first comers here
bot.start(async (ctx) => {
  try {
    if (!ctx.from) {
      // Very unlikely, but avoid crashes
      return;
    }

    const { user, isNew } = await trackTelegramUser(ctx);

    if (isNew) {
      await ctx.reply(
        `Привіт, ${user.firstName ?? "друже"}! 👋\n\n` +
          "Дякую, що запустив(ла) бота. Твій профіль успішно зареєстровано.",
      );
    } else {
      await ctx.reply(
        `Рада бачити тебе знову, ${user.firstName ?? "друже"}! 👋\n\n` +
          "Ми оновили твою активність у системі.",
      );
    }

    const preferences = (user.preferences ?? {}) as Record<string, any>;

    if (!preferences.email) {
      preferences.awaitingEmail = true;
      user.preferences = preferences;
      await user.save();

      const { text, extra } = buildEmailRequestMessage();
      const paymentKeyboard = buildPaymentCheckKeyboard();

      // Merge inline keyboards: keep original ProChat button and add payment buttons below it
      const mergedKeyboard = {
        ...paymentKeyboard,
        reply_markup: {
          inline_keyboard: [
            // @ts-ignore – internal structure of Markup
            ...(extra.reply_markup?.inline_keyboard ?? []),
            // @ts-ignore
            ...(paymentKeyboard.reply_markup?.inline_keyboard ?? []),
          ],
        },
      };

      await ctx.reply(text, mergedKeyboard);
    }
  } catch (error) {
    console.error("Error handling /start:", error);
    await ctx.reply(
      "На жаль, сталася помилка під час реєстрації. Спробуй, будь ласка, ще раз пізніше.",
    );
  }
});

// Handle plain text messages to collect email when needed
bot.on("text", async (ctx) => {
  const message = ctx.message;
  if (!message || message.text === undefined) {
    return;
  }

  const text = message.text.trim();

  // Ignore commands like /start, /help, etc.
  if (text.startsWith("/")) {
    return;
  }

  const from = ctx.from;
  if (!from) {
    return;
  }

  const telegramId = String(from.id);
  const user = await TelegramUser.findOne({ where: { telegramId } });
  if (!user) {
    return;
  }

  const preferences = (user.preferences ?? {}) as Record<string, any>;

  // If we never asked for email and it's already set, nothing to do
  if (!preferences.awaitingEmail && preferences.email) {
    return;
  }

  // Very simple email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(text)) {
    await ctx.reply(
      "Схоже, це не схоже на email.\n\n" +
        "Будь ласка, введіть коректну адресу, наприклад: name@example.com",
    );
    return;
  }

  preferences.email = text;
  preferences.awaitingEmail = false;
  user.preferences = preferences;
  user.email = text;
  await user.save();

  await ctx.reply(
    `Дякую! Ми зберегли вашу електронну адресу: ${text}\n\n` +
      "Тепер ви можете повноцінно користуватися ботом.",
  );
});

/**
 * Helper to launch the bot from your main app entrypoint.
 */
export async function launchTelegramBot(): Promise<void> {
  await bot.launch();
  console.log("Telegram bot started and is now polling for updates");

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

