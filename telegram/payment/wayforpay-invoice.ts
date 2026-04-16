// telegram/payment/wayforpay-invoice.ts — WayForPay оформлення оплати з бота (callback → посилання на оплату)
import { Context, Markup, Telegraf } from "telegraf";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { normalizeEmail } from "../../database/normalize-email";
import { TelegramUser } from "../../database/TelegramUser";
import { MULTIMASKING_PRODUCT_NAME } from "../../payment/multimasking-product";
import { getMultimaskingCoursePriceUah } from "../../payment/multimasking-price";
import { isPrivateChat } from "../core/chat-guards";
import {
  buildPaymentNeedsConsentMessageAndKeyboard,
  CALLBACK_ALERT_CONSENT_REQUIRED_FOR_PAYMENT_UA,
  hasAcceptedCurrentRules,
} from "../handlers/rules";
import { getActiveMultimaskingPaymentSummaryForContact } from "../paid-chat-janitor/paid-chat-allowlist";
import { computeKwigaRankSnapshot } from "../profile/kwiga-rank-db";
import {
  buildMultimaskingAlreadyActivePaymentMessageUa,
  CALLBACK_ALERT_ALREADY_ACTIVE_MULTIMASKING_UA,
  isKwigaRankEligibleForPaidChatPurchase,
  multimaskingIneligibleUserMessageUa,
} from "../profile/paid-chat-payment-eligibility";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import { sparkleLabel } from "../core/sparkle-label";

/**
 * Стабільний ідентифікатор callback: у старих чатах кнопки вже зберегли це значення.
 */
const WAYFORPAY_INVOICE_CALLBACK = "wfp_smoke_test_invoice";

/** Пояснення, чому приховано WayForPay (лише masters/pro за KWIGA). */
const WFP_RANK_INELIGIBLE_INFO = "wfp_rank_ineligible_info";

/** Немає email у telegram_users — рахунок не створюємо (див. gateMultimaskingCheckoutForTelegramId). */
const WFP_EMAIL_REQUIRED_INFO = "wfp_email_required_info";

/** Активний payment_hook MULTIMASKING — повторна оплата не пропонується. */
const WFP_ALREADY_ACTIVE_INFO = "wfp_already_active_info";

/**
 * Довге повідомлення: кнопка «потрібен email», застаріла кнопка «Оплатити» без email у профілі.
 */
export const EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA =
  "Без збереженого email у боті ми не зможемо зв’язати платіж WayForPay із вашим профілем у KWIGA й зарахувати доступ.\n\n" +
  "Що зробити:\n" +
  "• надішліть у цьому чаті свій email одним повідомленням (бажано той самий, що й у Kwiga);\n" +
  "• перевірте, що адреса збереглася: /profile;\n" +
  "• після цього знову відкрийте меню оплати (/payment).\n\n" +
  "Загальний порядок: згода з правилами → email → оплата.\n\n" +
  "Якщо ви вже оплатили, але email ще не вказували — надішліть адресу зараз: бот спробує зіставити оплату з акаунтом автоматично.\n\n" +
  SUPPORT_CONTACT_SUFFIX_PLAIN_UA;

/** Короткий текст для спливаючого вікна (як для згоди з правилами). */
export const CALLBACK_ALERT_EMAIL_REQUIRED_FOR_PAYMENT_UA =
  "Спочатку надішліть email у боті одним повідомленням у цьому чаті. Перевірте /profile.";

export { MULTIMASKING_PRODUCT_NAME };

function payButtonRow(price: number) {
  return [
    Markup.button.callback(
      sparkleLabel(`Оплатити ${price} грн`),
      WAYFORPAY_INVOICE_CALLBACK,
    ),
  ];
}

/**
 * Кнопка оплати — лише якщо email є, контакт у KWIGA є і ранг masters/pro.
 * Інакше одна кнопка з поясненням (деталі по натисканню).
 */
export async function buildWayForPayInvoiceKeyboard(telegramId: string) {
  const price = await getMultimaskingCoursePriceUah();
  const dbUser = await TelegramUser.findOne({ where: { telegramId } });
  const emailRaw = dbUser?.email?.trim();

  if (!dbUser || !emailRaw) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          sparkleLabel("Спочатку вкажіть email (Kwiga)"),
          WFP_EMAIL_REQUIRED_INFO,
        ),
      ],
    ]);
  }

  const contact = await findContactByEmailForBot(normalizeEmail(emailRaw));
  if (!contact) {
    return Markup.inlineKeyboard([payButtonRow(price)]);
  }

  const rankSnapshot = await computeKwigaRankSnapshot(dbUser);
  if (!isKwigaRankEligibleForPaidChatPurchase(rankSnapshot.rank)) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          sparkleLabel("Оплата: потрібен статус masters або pro"),
          WFP_RANK_INELIGIBLE_INFO,
        ),
      ],
    ]);
  }

  const botPaySummary = await getActiveMultimaskingPaymentSummaryForContact(
    contact.id,
  );
  if (botPaySummary.active) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(
          sparkleLabel("Доступ уже активний"),
          WFP_ALREADY_ACTIVE_INFO,
        ),
      ],
    ]);
  }

  return Markup.inlineKeyboard([payButtonRow(price)]);
}

export function registerWayForPayInvoiceHandlers(bot: Telegraf<Context>): void {
  bot.action(WFP_ALREADY_ACTIVE_INFO, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      const telegramId = String(chatId);
      const dbUser = await TelegramUser.findOne({ where: { telegramId } });
      const emailRaw = dbUser?.email?.trim();
      if (!dbUser || !emailRaw) {
        await ctx.answerCbQuery();
        await ctx.reply("Профіль або email не знайдено. Спробуйте /start.");
        return;
      }
      const contact = await findContactByEmailForBot(normalizeEmail(emailRaw));
      if (!contact) {
        await ctx.answerCbQuery();
        await ctx.reply("Контакт за email не знайдено. Перевірте /profile.");
        return;
      }
      const summary = await getActiveMultimaskingPaymentSummaryForContact(
        contact.id,
      );
      if (!summary.active) {
        await ctx.answerCbQuery(
          "Активної оплати вже немає — відкрийте /payment та оформіть доступ.",
        );
        return;
      }
      await ctx.answerCbQuery(CALLBACK_ALERT_ALREADY_ACTIVE_MULTIMASKING_UA, {
        show_alert: true,
      });
      await ctx.reply(await buildMultimaskingAlreadyActivePaymentMessageUa(summary));
    } catch (err) {
      console.error("WayForPay already active callback:", err);
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  bot.action(WFP_EMAIL_REQUIRED_INFO, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery(CALLBACK_ALERT_EMAIL_REQUIRED_FOR_PAYMENT_UA, {
        show_alert: true,
      });
      await ctx.reply(EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA);
    } catch (err) {
      console.error("WayForPay email required callback:", err);
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  bot.action(WFP_RANK_INELIGIBLE_INFO, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery().catch(() => {});
      const telegramId = String(chatId);
      const dbUser = await TelegramUser.findOne({ where: { telegramId } });
      if (!dbUser) {
        await ctx.reply("Профіль не знайдено. Спробуйте /start.");
        return;
      }
      const rankSnapshot = await computeKwigaRankSnapshot(dbUser);
      await ctx.reply(multimaskingIneligibleUserMessageUa(rankSnapshot.rank));
    } catch (err) {
      console.error("WayForPay rank info callback:", err);
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  bot.action(WAYFORPAY_INVOICE_CALLBACK, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }

      const telegramId = String(chatId);
      if (!(await hasAcceptedCurrentRules(telegramId))) {
        await ctx.answerCbQuery(CALLBACK_ALERT_CONSENT_REQUIRED_FOR_PAYMENT_UA, {
          show_alert: true,
        });
        const { text, extra } = buildPaymentNeedsConsentMessageAndKeyboard();
        await ctx.reply(text, extra);
        return;
      }

      const dbUser = await TelegramUser.findOne({ where: { telegramId } });
      const emailRaw = dbUser?.email?.trim();

      if (!dbUser) {
        await ctx.answerCbQuery("Профіль не знайдено. Спробуйте /start.");
        await ctx.reply("Профіль не знайдено. Спробуйте /start.");
        return;
      }
      if (!emailRaw) {
        await ctx.answerCbQuery(CALLBACK_ALERT_EMAIL_REQUIRED_FOR_PAYMENT_UA, {
          show_alert: true,
        });
        await ctx.reply(EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA);
        return;
      }

      const contact = await findContactByEmailForBot(normalizeEmail(emailRaw));
      if (!contact) {
        await ctx.answerCbQuery(
          "Контакт за цим email у KWIGA не знайдено — див. повідомлення нижче.",
          { show_alert: true },
        );
        await ctx.reply(
          "За вказаним email контакта у базі KWIGA не знайдено — після оплати доступ не можна буде зарахувати автоматично.\n\n" +
            "Перевірте адресу в /profile, за потреби змініть її через /change_email. " +
            "Після оновлення email знову натисніть «Оплатити».\n\n" +
            SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
        );
        return;
      }

      const rankSnapshot = await computeKwigaRankSnapshot(dbUser);
      if (!isKwigaRankEligibleForPaidChatPurchase(rankSnapshot.rank)) {
        await ctx.answerCbQuery();
        await ctx.reply(multimaskingIneligibleUserMessageUa(rankSnapshot.rank));
        return;
      }

      const botPaySummary = await getActiveMultimaskingPaymentSummaryForContact(
        contact.id,
      );
      if (botPaySummary.active) {
        await ctx.answerCbQuery(CALLBACK_ALERT_ALREADY_ACTIVE_MULTIMASKING_UA, {
          show_alert: true,
        });
        await ctx.reply(
          await buildMultimaskingAlreadyActivePaymentMessageUa(botPaySummary),
        );
        return;
      }

      await ctx.answerCbQuery();

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
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(
        "Не вдалося створити рахунок. Перевірте налаштування WayForPay (WFP_* у .env) " +
          "та доступність платіжного сервера.",
      );
    }
  });
}
