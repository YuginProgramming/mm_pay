import { Context, Markup, Telegraf } from "telegraf";
import {
  cancelSubscriptionAutoForUser,
  hasActiveSubscriptionAutoRenew,
} from "../../payment/cancel-subscription-auto.service";
import { UNSUBSCRIBE_MANAGE_CALLBACK } from "../../payment/telegram-notify";
import { gateMultimaskingCheckoutForTelegramId } from "../../payment/multimasking-checkout-eligibility";
import { createSubscriptionAutoCheckout } from "../../payment/subscription-auto-checkout.service";
import {
  getSubscriptionAutoAccessDays,
  getSubscriptionAutoPriceUah,
} from "../../payment/subscription-auto-settings";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import { isPrivateChat } from "../core/chat-guards";
import { StartContext, trackTelegramUser } from "../core/user-tracking";
import {
  buildPaymentNeedsConsentMessageAndKeyboard,
  hasAcceptedCurrentRules,
} from "./rules";
import {
  buildMultimaskingAlreadyActivePaymentMessageUa,
  multimaskingIneligibleUserMessageUa,
} from "../profile/paid-chat-payment-eligibility";
import { EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA } from "../payment/wayforpay-invoice";

const UNSUBSCRIBE_CONFIRM_CALLBACK = "unsub_confirm";
const UNSUBSCRIBE_ABORT_CALLBACK = "unsub_abort";

const UNSUBSCRIBE_CONFIRM_TEXT_UA =
  "Скасувати автопродовження підписки?\n\n" +
  "Поточний оплачений період доступу збережеться до дати закінчення " +
  "(див. /profile). Повторні списання з картки буде зупинено.";

function unsubscribeConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Так, скасувати", UNSUBSCRIBE_CONFIRM_CALLBACK),
      Markup.button.callback("Ні", UNSUBSCRIBE_ABORT_CALLBACK),
    ],
  ]);
}

async function gateFailureMessageUa(
  gate: Awaited<ReturnType<typeof gateMultimaskingCheckoutForTelegramId>>,
): Promise<string> {
  if (gate.ok) return "";
  switch (gate.reason) {
    case "no_consent":
      return "Спочатку прийміть правила проєкту (кнопка під правилами або /payment).";
    case "no_email":
      return EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA;
    case "already_active_access":
      return buildMultimaskingAlreadyActivePaymentMessageUa({
        grantEndAt: gate.grantEndAtIso ? new Date(gate.grantEndAtIso) : null,
        accessSource: gate.accessSource,
        autoRenew: gate.autoRenew,
      });
    case "no_user":
    case "no_contact":
    case "rank_ineligible":
      return multimaskingIneligibleUserMessageUa(gate.rank);
    default:
      return "Оплата недоступна. Перевірте /profile.";
  }
}

export function registerSubscriptionAutoHandlers(bot: Telegraf<StartContext>): void {
  bot.command("subauto", async (ctx: Context) => {
    try {
      if (!ctx.from) return;
      if (!isPrivateChat(ctx)) return;

      const { user } = await trackTelegramUser(ctx as StartContext);
      const telegramId = user.telegramId;

      if (!(await hasAcceptedCurrentRules(telegramId))) {
        const { text, extra } = buildPaymentNeedsConsentMessageAndKeyboard();
        await ctx.reply(text, extra);
        return;
      }

      const gate = await gateMultimaskingCheckoutForTelegramId(telegramId);
      if (!gate.ok) {
        await ctx.reply(await gateFailureMessageUa(gate));
        return;
      }

      const checkout = await createSubscriptionAutoCheckout(telegramId);
      if (!checkout.ok) {
        console.error("[subscription-auto] checkout failed", {
          telegramId,
          reason: checkout.reason,
          orderReference: checkout.orderReference,
        });
        if (checkout.reason === "plan_not_found") {
          await ctx.reply(
            "План subscription_auto не знайдено в БД. Запустіть міграції.",
          );
          return;
        }
        await ctx.reply(
          "Не вдалося створити замовлення. Спробуйте пізніше або зверніться до підтримки.",
        );
        return;
      }

      const priceUah = checkout.priceUah ?? (await getSubscriptionAutoPriceUah());
      const accessDays = await getSubscriptionAutoAccessDays();

      await ctx.reply(
        "Автопродовження WayForPay (Purchase + regular).\n\n" +
          `Сума: ${priceUah} грн. Після оплати — доступ на **${accessDays}** дн.\n` +
          `Номер замовлення: ${checkout.orderReference}` +
          (checkout.reused ? "\n\n(використано наявне незавершене замовлення)" : ""),
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [Markup.button.url("Перейти до оплати", checkout.checkoutUrl)],
          ]),
        },
      );
    } catch (error) {
      console.error("Error handling /subauto:", error);
      await ctx.reply("Помилка. Спробуйте пізніше.");
    }
  });

  bot.command("unsubscribe", async (ctx: Context) => {
    try {
      if (!ctx.from) return;
      if (!isPrivateChat(ctx)) return;

      const { user } = await trackTelegramUser(ctx as StartContext);
      const hasActive = await hasActiveSubscriptionAutoRenew(user.telegramId);
      if (!hasActive) {
        await ctx.reply(
          "Активного автопродовження немає — скасовувати нічого.\n\n" +
            "Деталі доступу: /profile",
        );
        return;
      }

      await ctx.reply(UNSUBSCRIBE_CONFIRM_TEXT_UA, unsubscribeConfirmKeyboard());
    } catch (error) {
      console.error("Error handling /unsubscribe:", error);
      await ctx.reply("Помилка. Спробуйте пізніше.");
    }
  });

  bot.action(UNSUBSCRIBE_MANAGE_CALLBACK, async (ctx) => {
    try {
      if (!ctx.from) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }

      await ctx.answerCbQuery();
      const { user } = await trackTelegramUser(ctx as StartContext);
      const hasActive = await hasActiveSubscriptionAutoRenew(user.telegramId);
      if (!hasActive) {
        await ctx.reply(
          "Активного автопродовження немає — скасовувати нічого.\n\n" +
            "Деталі доступу: /profile",
        );
        return;
      }

      await ctx.reply(UNSUBSCRIBE_CONFIRM_TEXT_UA, unsubscribeConfirmKeyboard());
    } catch (error) {
      console.error("Error handling unsub_manage:", error);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Помилка. Спробуйте пізніше.");
    }
  });

  bot.action(UNSUBSCRIBE_ABORT_CALLBACK, async (ctx) => {
    try {
      if (!ctx.from) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery();
      await ctx.editMessageText("Скасування автопродовження не виконано.").catch(async () => {
        await ctx.reply("Скасування автопродовження не виконано.");
      });
    } catch (error) {
      console.error("Error handling unsub_abort:", error);
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  bot.action(UNSUBSCRIBE_CONFIRM_CALLBACK, async (ctx) => {
    try {
      if (!ctx.from) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }

      await ctx.answerCbQuery();
      const { user } = await trackTelegramUser(ctx as StartContext);
      const result = await cancelSubscriptionAutoForUser(user.telegramId);

      if (result.kind === "none") {
        await ctx.editMessageText(
          "Активного автопродовження немає — скасовувати нічого.\n\nДеталі: /profile",
        ).catch(async () => {
          await ctx.reply(
            "Активного автопродовження немає — скасовувати нічого.\n\nДеталі: /profile",
          );
        });
        return;
      }

      if (!result.ok) {
        console.error("[unsubscribe] cancel failed", {
          telegramId: user.telegramId,
          message: result.message,
          cancelledCount: result.cancelled.length,
        });
        const failText =
          "Не вдалося повністю скасувати автопродовження. Спробуйте пізніше або зверніться до підтримки.\n\n" +
          SUPPORT_CONTACT_SUFFIX_PLAIN_UA;
        await ctx.editMessageText(failText).catch(async () => {
          await ctx.reply(failText);
        });
        return;
      }

      const okText =
        "Автопродовження скасовано. Повторні списання з картки зупинено.\n\n" +
        "Оплачений період доступу залишається чинним до дати закінчення — див. /profile.";
      await ctx.editMessageText(okText).catch(async () => {
        await ctx.reply(okText);
      });
    } catch (error) {
      console.error("Error handling unsub_confirm:", error);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(
        "Помилка під час скасування. Спробуйте пізніше або зверніться до підтримки.\n\n" +
          SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
      );
    }
  });
}
