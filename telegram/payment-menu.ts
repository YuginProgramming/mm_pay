// telegram/payment-menu.ts — оплата та перевірки без обовʼязкового email
import type { InlineKeyboardMarkup } from "@telegraf/types/markup";
import { Context, Markup, Telegraf } from "telegraf";
import { TelegramUser } from "../database/TelegramUser";
import { buildWayForPayTestKeyboard } from "./wayforpay-test";

const DEFER_EMAIL_CALLBACK = "payment_menu_defer_email";

function rowsOf(
  keyboard: { reply_markup?: InlineKeyboardMarkup },
): InlineKeyboardMarkup["inline_keyboard"] {
  return keyboard.reply_markup?.inline_keyboard ?? [];
}

/**
 * Клавіатура після /start, коли просимо email: ProChat + списки оплат + WayForPay + «без email».
 */
export function buildMergedStartEmailKeyboard(emailProChatExtra: {
  reply_markup?: InlineKeyboardMarkup;
}) {
  const wfp = buildWayForPayTestKeyboard();
  const defer = Markup.inlineKeyboard([
    Markup.button.callback(
      "Пізніше вкажу email — тільки меню оплати",
      DEFER_EMAIL_CALLBACK,
    ),
  ]);

  return {
    reply_markup: {
      inline_keyboard: [
        ...rowsOf(emailProChatExtra),
        ...rowsOf(wfp),
        ...rowsOf(defer),
      ],
    },
  };
}

/** Меню оплати / перевірок без рядка ProChat (для /payment або після «без email»). */
export function buildStandalonePaymentMenuKeyboard() {
  const wfp = buildWayForPayTestKeyboard();

  return {
    reply_markup: {
      inline_keyboard: [...rowsOf(wfp)],
    },
  };
}

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

      const preferences = (user.preferences ?? {}) as Record<string, unknown>;
      preferences.awaitingEmail = false;
      user.preferences = preferences;
      await user.save();

      await ctx.reply(
        "Ок, email можна вказати пізніше.\n\n" +
          "Меню оплати та перевірок (команда /payment завжди відкриває це меню):",
        buildStandalonePaymentMenuKeyboard(),
      );
    } catch (err) {
      console.error("defer email payment menu:", err);
      await ctx.reply("Помилка. Спробуй /payment або /start.");
    }
  });
}
