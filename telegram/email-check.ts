// telegram/email-check.ts
import { Context, Markup, Telegraf } from "telegraf";
import { TelegramUser } from "../database/TelegramUser";
import { Contact } from "../database/Contact";

const PROCHAT_BUTTON_CALLBACK = "prochat_access_button";

/**
 * Builds the email request text and inline button "Отримати доступ в ProChat".
 */
export function buildEmailRequestMessage() {
  const text =
    "Щоб повноцінно користуватися цим ботом, потрібно вказати свою електронну адресу.\n\n" +
    "Будь ласка, напишіть свій email (наприклад, name@example.com) і надішліть його в цьому чаті.\n\n" +
    "Після цього ви можете натиснути кнопку нижче, щоб перевірити доступ до ProChat.";

  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback("Отримати доступ в ProChat", PROCHAT_BUTTON_CALLBACK),
  ]);

  // `keyboard` can be passed directly as the second argument to ctx.reply
  return { text, extra: keyboard };
}

/**
 * Registers handler for the "Отримати доступ в ProChat" button.
 *
 * Logic:
 *  - Take Telegram user from telegram_users (by telegramId)
 *  - Ensure they have an email saved
 *  - Check if that email exists in contacts.email
 *  - If yes → send ProChat invite link
 *  - If no  → send "немає в базі даних" message
 */
export function registerProChatAccessHandler(bot: Telegraf<Context>) {
  bot.action(PROCHAT_BUTTON_CALLBACK, async (ctx) => {
    try {
      if (!ctx.from) {
        return;
      }

      // Stop the loading spinner on the button
      await ctx.answerCbQuery();

      const telegramId = String(ctx.from.id);

      // 1) Find Telegram user
      const telegramUser = await TelegramUser.findOne({ where: { telegramId } });

      if (!telegramUser || !telegramUser.email) {
        await ctx.reply(
          "У вашому профілі не знайдено email.\n\n" +
            "Будь ласка, спочатку вкажіть свій email, відповівши на запит у цьому боті.",
        );
        return;
      }

      const email = telegramUser.email;

      // 2) Check if this email exists in contacts table
      const contact = await Contact.findOne({ where: { email } });

      if (contact) {
        await ctx.reply(
          "Вітаю! Ваш контакт знайдено в базі даних.\n\n" +
            "Ось посилання для доступу в ProChat:\n" +
            "https://t.me/+r2cVyb4dDUI1MmRi",
        );
      } else {
        await ctx.reply(
          "Вашого контакту немає в базі даних, будь ласка зверніться до адміністратора.",
        );
      }
    } catch (error) {
      console.error("Error while checking ProChat access:", error);
      await ctx.reply(
        "Сталася помилка під час перевірки доступу. Спробуйте, будь ласка, пізніше.",
      );
    }
  });
}