import { Context, Telegraf } from "telegraf";
import { buildProfileMessage } from "./profile-message";
import { buildEmailRequestMessage } from "./email-check";
import {
  buildMergedStartEmailKeyboard,
  buildStandalonePaymentMenuKeyboard,
} from "./payment-menu";
import { buildRulesMessageAndKeyboard, hasAcceptedCurrentRules } from "./rules";
import { StartContext, trackTelegramUser } from "./user-tracking";

export function registerCommandHandlers(bot: Telegraf<StartContext>): void {
  bot.start(async (ctx) => {
    try {
      if (!ctx.from) return;
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

      if (!user.email) {
        user.awaitingEmail = true;
        await user.save();

        const rulesAccepted = await hasAcceptedCurrentRules(user.telegramId);
        const { text, extra } = buildEmailRequestMessage();
        await ctx.reply(
          text,
          await buildMergedStartEmailKeyboard(extra, rulesAccepted),
        );
        return;
      }

      if (!(await hasAcceptedCurrentRules(user.telegramId))) {
        const { text, extra } = buildRulesMessageAndKeyboard();
        await ctx.reply(text, extra);
        return;
      }

      await ctx.reply(
        "Меню оплати:",
        await buildStandalonePaymentMenuKeyboard(true),
      );
    } catch (error) {
      console.error("Error handling /start:", error);
      await ctx.reply(
        "На жаль, сталася помилка під час реєстрації. Спробуй, будь ласка, ще раз пізніше.",
      );
    }
  });

  bot.command("payment", async (ctx: Context) => {
    try {
      if (!ctx.from) return;
      const { user } = await trackTelegramUser(ctx as StartContext);
      if (!(await hasAcceptedCurrentRules(user.telegramId))) {
        const { text, extra } = buildRulesMessageAndKeyboard();
        await ctx.reply(
          "Спочатку прийміть правила доступу (це потрібно й без email):\n\n" + text,
          extra,
        );
        return;
      }
      await ctx.reply(
        "Меню оплати:",
        await buildStandalonePaymentMenuKeyboard(true),
      );
    } catch (error) {
      console.error("Error handling /payment:", error);
      await ctx.reply("Помилка. Спробуй пізніше.");
    }
  });

  bot.command("profile", async (ctx: Context) => {
    try {
      if (!ctx.from) return;
      const { user } = await trackTelegramUser(ctx as StartContext);
      await ctx.reply(await buildProfileMessage(user));
    } catch (error) {
      console.error("Error handling /profile:", error);
      await ctx.reply("Помилка під час завантаження профілю. Спробуй пізніше.");
    }
  });

  bot.command("change_email", async (ctx: Context) => {
    try {
      if (!ctx.from) return;
      const { user } = await trackTelegramUser(ctx as StartContext);
      const previousEmail = user.email;

      user.awaitingEmail = true;
      user.emailChangeFrom = previousEmail ?? null;
      user.email = null;
      await user.save();

      await ctx.reply(
        "Надішліть у чат нову електронну адресу (наприклад, name@example.com).\n\n" +
          "Після зміни перевірте статус: /profile",
      );
    } catch (error) {
      console.error("Error handling /change_email:", error);
      await ctx.reply("Помилка. Спробуй пізніше або /start.");
    }
  });
}
