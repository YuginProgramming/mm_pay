import { Context, Telegraf } from "telegraf";
import { TelegramUser } from "../database/TelegramUser";
import {
  buildStandalonePaymentMenuKeyboard,
  DEFER_EMAIL_CALLBACK,
} from "./payment-menu-keyboards";
import { buildRulesMessageAndKeyboard, hasAcceptedCurrentRules } from "./rules";

export function registerDeferEmailHandler(bot: Telegraf<Context>) {
  bot.action(DEFER_EMAIL_CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      if (!ctx.from) return;

      const telegramId = String(ctx.from.id);
      const user = await TelegramUser.findOne({ where: { telegramId } });

      if (!user) {
        await ctx.reply("Профіль не знайдено. Спробуй /start.");
        return;
      }

      user.awaitingEmail = false;
      await user.save();

      if (!(await hasAcceptedCurrentRules(telegramId))) {
        const { text, extra } = buildRulesMessageAndKeyboard();
        await ctx.reply(
          "Ок, email можна вказати пізніше.\n\n" + text,
          extra,
        );
        return;
      }

      await ctx.reply(
        "Ок, email можна вказати пізніше.\n\nМеню оплати:",
        await buildStandalonePaymentMenuKeyboard(true),
      );
    } catch (err) {
      console.error("defer email payment menu:", err);
      await ctx.reply("Помилка. Спробуй /payment або /start.");
    }
  });
}
