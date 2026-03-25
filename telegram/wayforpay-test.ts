// telegram/wayforpay-test.ts
import { Context, Markup, Telegraf } from "telegraf";

const CALLBACK = "wfp_smoke_test_invoice";

const TEST_PRICE_UAH = 1;
const TEST_COURSE = "smoke-test-course";

export function buildWayForPayTestKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "WayForPay: тестове посилання на оплату",
        CALLBACK,
      ),
    ],
  ]);
}

export function registerWayForPayTestHandlers(bot: Telegraf<Context>) {
  bot.action(CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const chatId = ctx.from?.id;
      if (chatId == null) return;

      const { createCheckoutForCourse } = await import(
        "../payment/payment.service"
      );

      const { invoiceUrl } = await createCheckoutForCourse(
        TEST_PRICE_UAH,
        TEST_COURSE,
        String(chatId),
      );

      await ctx.reply(
        "Інвойс WayForPay створено. Відкрий сторінку оплати кнопкою нижче.",
        Markup.inlineKeyboard([
          Markup.button.url("Перейти до оплати", invoiceUrl),
        ]),
      );
    } catch (err) {
      console.error("WayForPay smoke test failed:", err);
      await ctx.reply(
        "Не вдалося створити інвойс. Перевір WFP_* у .env і залежність overshom-wayforpay.",
      );
    }
  });
}
