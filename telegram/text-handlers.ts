import { Telegraf } from "telegraf";
import { EmailChangeLog } from "../database/EmailChangeLog";
import { buildStandalonePaymentMenuKeyboard } from "./payment-menu-keyboards";
import {
  buildRulesMessageAndKeyboard,
  hasAcceptedCurrentRules,
} from "./rules";
import { StartContext } from "./user-tracking";
import { getTelegramUserFromContext } from "./user-tracking";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerTextHandlers(bot: Telegraf<StartContext>): void {
  bot.on("text", async (ctx) => {
    const message = ctx.message;
    if (!message || message.text === undefined) return;

    const text = message.text.trim();
    if (text.startsWith("/")) return;

    const user = await getTelegramUserFromContext(ctx);
    if (!user) return;

    if (user.email && !user.awaitingEmail) return;
    if (!user.awaitingEmail) return;

    if (!emailRegex.test(text)) {
      await ctx.reply(
        "Схоже, це не схоже на email.\n\n" +
          "Будь ласка, введіть коректну адресу, наприклад: name@example.com",
      );
      return;
    }

    const previousEmail = user.emailChangeFrom;

    user.email = text;
    user.awaitingEmail = false;
    user.emailChangeFrom = null;
    await user.save();

    if (previousEmail) {
      try {
        await EmailChangeLog.create({
          telegramId: user.telegramId,
          oldEmail: previousEmail,
          newEmail: text,
        });
      } catch (err) {
        console.error("EmailChangeLog.create:", err);
      }
      await ctx.reply(
        `Email оновлено.\n\n` +
          `Було: ${previousEmail}\n` +
          `Стало: ${text}\n\n` +
          "Перевірте профіль: /profile",
      );
      if (!(await hasAcceptedCurrentRules(user.telegramId))) {
        const { text: rulesText, extra } = buildRulesMessageAndKeyboard();
        await ctx.reply(rulesText, extra);
      }
      return;
    }

    await ctx.reply(
      `Дякую! Ми зберегли вашу електронну адресу: ${text}\n\n` +
        "Тепер ви можете повноцінно користуватися ботом.",
    );
    if (!(await hasAcceptedCurrentRules(user.telegramId))) {
      const { text: rulesText, extra } = buildRulesMessageAndKeyboard();
      await ctx.reply(rulesText, extra);
      return;
    }
    await ctx.reply(
      "Меню оплати та перевірок:",
      buildStandalonePaymentMenuKeyboard(true),
    );
  });
}
