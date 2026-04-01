// telegram/wayforpay-invoice.ts — WayForPay оформлення оплати з бота (callback → посилання на оплату)
import { Context, Markup, Telegraf } from "telegraf";
import {
  MULTIMASKING_ACCESS_PRICE_UAH,
  MULTIMASKING_PRODUCT_NAME,
} from "../payment/multimasking-product";
import { hasAcceptedCurrentRules } from "./rules";

/**
 * Стабільний ідентифікатор callback: у старих чатах кнопки вже зберегли це значення.
 */
const WAYFORPAY_INVOICE_CALLBACK = "wfp_smoke_test_invoice";

export { MULTIMASKING_ACCESS_PRICE_UAH, MULTIMASKING_PRODUCT_NAME };

export function buildWayForPayInvoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "Оплатити 500 грн (WayForPay)",
        WAYFORPAY_INVOICE_CALLBACK,
      ),
    ],
  ]);
}

export function registerWayForPayInvoiceHandlers(bot: Telegraf<Context>): void {
  bot.action(WAYFORPAY_INVOICE_CALLBACK, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;

      const telegramId = String(chatId);
      if (!(await hasAcceptedCurrentRules(telegramId))) {
        await ctx.answerCbQuery("Спочатку прийміть правила в боті.", {
          show_alert: true,
        });
        return;
      }

      await ctx.answerCbQuery();

      const { createCheckoutForCourse } = await import(
        "../payment/payment.service"
      );

      const { invoiceUrl } = await createCheckoutForCourse(
        MULTIMASKING_ACCESS_PRICE_UAH,
        MULTIMASKING_PRODUCT_NAME,
        String(chatId),
      );

      await ctx.reply(
        "Рахунок WayForPay на суму 500 грн за доступ до навчального продукту " +
          "«Multimasking Learning Project» створено.\n\n" +
          "Натисніть кнопку нижче, щоб перейти до безпечної оплати.",
        Markup.inlineKeyboard([
          Markup.button.url("Перейти до оплати", invoiceUrl),
        ]),
      );
    } catch (err) {
      console.error("WayForPay invoice (bot callback) failed:", err);
      await ctx.reply(
        "Не вдалося створити рахунок. Перевірте налаштування WayForPay (WFP_* у .env) " +
          "та доступність платіжного сервера.",
      );
    }
  });
}
