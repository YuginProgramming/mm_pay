import { Context, Markup, Telegraf } from "telegraf";
import { gateMultimaskingCheckoutForTelegramId } from "../../payment/multimasking-checkout-eligibility";
import { createSubscriptionAutoCheckout } from "../../payment/subscription-auto-checkout.service";
import {
  getSubscriptionAutoAccessDays,
  getSubscriptionAutoPriceUah,
} from "../../payment/subscription-auto-settings";
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
        active: true,
        grantEndAt: gate.grantEndAtIso ? new Date(gate.grantEndAtIso) : null,
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
}
