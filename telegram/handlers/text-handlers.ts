import { Telegraf } from "telegraf";
import { UniqueConstraintError } from "sequelize";
import { EmailChangeLog } from "../../database/EmailChangeLog";
import { normalizeEmail } from "../../database/normalize-email";
import { findConflictingTelegramUserForEmail } from "../../database/telegram-user-email";
import { retryUnlinkedApprovedPaymentsForTelegramUser } from "../../payment/retry-unlinked-payment-grant";
import { buildStandalonePaymentMenuKeyboard } from "../payment/payment-menu-keyboards";
import {
  buildRulesMessageAndKeyboard,
  hasAcceptedCurrentRules,
} from "./rules";
import { isPrivateChat } from "../core/chat-guards";
import { StartContext } from "../core/user-tracking";
import { getTelegramUserFromContext } from "../core/user-tracking";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_ALREADY_LINKED_MESSAGE =
  "Цей email уже прив’язаний до іншого Telegram-акаунта.\n\n" +
  "Якщо це справді ваша пошта — увійдіть у бот з того акаунта або зверніться до підтримки.\n" +
  "Якщо ви помилилися — введіть іншу адресу або скористайтесь /change_email.";

export function registerTextHandlers(bot: Telegraf<StartContext>): void {
  bot.on("text", async (ctx) => {
    const message = ctx.message;
    if (!message || message.text === undefined) return;

    const text = message.text.trim();
    if (text.startsWith("/")) return;
    if (!isPrivateChat(ctx)) return;

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
    const normalized = normalizeEmail(text);

    const conflicting = await findConflictingTelegramUserForEmail(
      normalized,
      user.telegramId,
    );
    if (conflicting) {
      await ctx.reply(EMAIL_ALREADY_LINKED_MESSAGE);
      return;
    }

    user.email = normalized;
    user.awaitingEmail = false;
    user.emailChangeFrom = null;
    try {
      await user.save();
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        await ctx.reply(EMAIL_ALREADY_LINKED_MESSAGE);
        return;
      }
      throw err;
    }

    if (previousEmail) {
      try {
        await EmailChangeLog.create({
          telegramId: user.telegramId,
          oldEmail: normalizeEmail(previousEmail),
          newEmail: normalized,
        });
      } catch (err) {
        console.error("EmailChangeLog.create:", err);
      }
      await ctx.reply(
        `Email оновлено.\n\n` +
          `Було: ${normalizeEmail(previousEmail)}\n` +
          `Стало: ${normalized}\n\n` +
          "Перевірте профіль: /profile",
      );
      await user.reload();
      const linked = await retryUnlinkedApprovedPaymentsForTelegramUser(user);
      if (linked > 0) {
        await ctx.reply(
          "Знайдено успішну оплату WayForPay без зарахованого доступу — зараз зараховано. Перевірте /profile.",
        );
      }
      if (!(await hasAcceptedCurrentRules(user.telegramId))) {
        const { text: rulesText, extra } = buildRulesMessageAndKeyboard();
        await ctx.reply(rulesText, extra);
      }
      return;
    }

    await ctx.reply(
      `Дякую! Ми зберегли вашу електронну адресу: ${normalized}\n\n` +
        "Тепер ви можете повноцінно користуватися ботом.",
    );
    await user.reload();
    const linkedAfterFirstEmail =
      await retryUnlinkedApprovedPaymentsForTelegramUser(user);
    if (linkedAfterFirstEmail > 0) {
      await ctx.reply(
        "Знайдено вашу раніше успішну оплату WayForPay — доступ зараховано. Перевірте /profile.",
      );
    }
    if (!(await hasAcceptedCurrentRules(user.telegramId))) {
      const { text: rulesText, extra } = buildRulesMessageAndKeyboard();
      await ctx.reply(rulesText, extra);
      return;
    }
    await ctx.reply(
      "Меню оплати:",
      await buildStandalonePaymentMenuKeyboard(true),
    );
  });
}
