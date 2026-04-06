// telegram/payment/wayforpay-invoice.ts — WayForPay оформлення оплати з бота (callback → посилання на оплату)
import { Context, Markup, Telegraf } from "telegraf";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { normalizeEmail } from "../../database/normalize-email";
import { TelegramUser } from "../../database/TelegramUser";
import { MULTIMASKING_PRODUCT_NAME } from "../../payment/multimasking-product";
import { getMultimaskingCoursePriceUah } from "../../payment/multimasking-price";
import { hasAcceptedCurrentRules } from "../handlers/rules";
import { sparkleLabel } from "../core/sparkle-label";

/**
 * Стабільний ідентифікатор callback: у старих чатах кнопки вже зберегли це значення.
 */
const WAYFORPAY_INVOICE_CALLBACK = "wfp_smoke_test_invoice";

export { MULTIMASKING_PRODUCT_NAME };

export async function buildWayForPayInvoiceKeyboard() {
  const price = await getMultimaskingCoursePriceUah();
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        sparkleLabel(`Оплатити ${price} грн`),
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

      const dbUser = await TelegramUser.findOne({ where: { telegramId } });
      const emailRaw = dbUser?.email?.trim();
      if (!emailRaw) {
        await ctx.reply(
          "Оплату можна виставити лише після того, як ви надішлете свій email у чат бота " +
            "(порядок: згода з правилами → email → оплата). Інакше WayForPay зарахувати доступ до вашого профілю не вдасться.\n\n" +
            "Якщо вже оплатили без email — надішліть адресу зараз; бот спробує зв’язати оплату з акаунтом автоматично.",
        );
        return;
      }

      const contact = await findContactByEmailForBot(normalizeEmail(emailRaw));
      if (!contact) {
        await ctx.reply(
          "За вказаним email контакта у базі KWIGA не знайдено — після оплати доступ не можна буде зарахувати автоматично. " +
            "Перевірте email (/profile) або зверніться до підтримки, а потім знову натисніть «Оплатити».",
        );
        return;
      }

      const price = await getMultimaskingCoursePriceUah();
      const { createCheckoutForCourse } = await import(
        "../../payment/payment.service"
      );

      const { invoiceUrl } = await createCheckoutForCourse(
        price,
        MULTIMASKING_PRODUCT_NAME,
        String(chatId),
      );

      await ctx.reply(
        `Рахунок WayForPay на суму ${price} грн за доступ до навчального продукту ` +
          "«Multimasking Learning Project» створено.\n\n" +
          "Натисніть кнопку нижче, щоб перейти до безпечної оплати.",
        Markup.inlineKeyboard([
          Markup.button.url(sparkleLabel("Перейти до оплати"), invoiceUrl),
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
