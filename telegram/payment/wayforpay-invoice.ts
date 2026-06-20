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
import { hasActiveMultimaskingAccess } from "../../payment/multimasking-access-status";
import { computeKwigaRankSnapshot } from "../profile/kwiga-rank-db";
import {
  buildMultimaskingAlreadyActiveAlertUa,
  buildMultimaskingAlreadyActivePaymentMessageUa,
  isKwigaRankEligibleForPaidChatPurchase,
  multimaskingIneligibleUserMessageUa,
  toAlreadyActiveContext,
} from "../profile/paid-chat-payment-eligibility";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import { sparkleLabel } from "../core/sparkle-label";
import {
  MONTHLY_SUBSCRIPTION_PLAN_CODE,
  YEARLY_SUBSCRIPTION_PLAN_CODE,
  isYearlySubscriptionPlanCode,
} from "../../payment/subscription-plan-codes";
import { getYearlySubscriptionPricing } from "../../payment/yearly-subscription-pricing";
import { subscriptionFlags } from "../../payment/subscription-flags";
import {
  createSubscriptionCheckout,
  renewSubscriptionCheckout,
  recoverSubscriptionCheckout,
  recreateSubscriptionCheckout,
} from "../../payment/subscription-checkout.service";

/**
 * Стабільний ідентифікатор callback: у старих чатах кнопки вже зберегли це значення.
 */
const WAYFORPAY_INVOICE_CALLBACK = "wfp_smoke_test_invoice";
const WFP_SUB_MONTHLY_CALLBACK = "wfp_sub_monthly";
const WFP_SUB_YEARLY_CALLBACK = "wfp_sub_yearly";

/** Пояснення, чому приховано WayForPay (лише masters/pro за KWIGA). */
const WFP_RANK_INELIGIBLE_INFO = "wfp_rank_ineligible_info";

/** Немає email у telegram_users — рахунок не створюємо (див. gateMultimaskingCheckoutForTelegramId). */
const WFP_EMAIL_REQUIRED_INFO = "wfp_email_required_info";

/** Активний payment_hook MULTIMASKING — повторна оплата не пропонується. */
const WFP_ALREADY_ACTIVE_INFO = "wfp_already_active_info";
const SUBSCRIPTION_CONTINUE_CHECKOUT_CALLBACK = "subscription_continue_checkout";
const SUBSCRIPTION_RECREATE_CHECKOUT_CALLBACK = "subscription_recreate_checkout";
const SUBSCRIPTION_RENEW_NOW_CALLBACK = "subscription_renew_now";

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

type ProductionSubscriptionPlanCode =
  | typeof MONTHLY_SUBSCRIPTION_PLAN_CODE
  | typeof YEARLY_SUBSCRIPTION_PLAN_CODE;

function describeSubscriptionPlanPeriodUa(planCode: string | null | undefined): string {
  return isYearlySubscriptionPlanCode(planCode) ? "річної" : "щомісячної";
}

async function buildEligiblePayKeyboardRows(): Promise<
  ReturnType<typeof Markup.button.callback>[][]
> {
  if (subscriptionFlags.subscriptionModeEnabled) {
    const pricing = await getYearlySubscriptionPricing();
    const yearlyDiscount =
      pricing.discountPercent > 0 ? ` (−${pricing.discountPercent}%)` : "";
    return [
      [
        Markup.button.callback(
          sparkleLabel(`Підписка ${pricing.monthlyPriceUah} грн/міс`),
          WFP_SUB_MONTHLY_CALLBACK,
        ),
      ],
      [
        Markup.button.callback(
          sparkleLabel(`Річна ${pricing.yearlyPriceUah} грн/рік${yearlyDiscount}`),
          WFP_SUB_YEARLY_CALLBACK,
        ),
      ],
    ];
  }

  const price = await getMultimaskingCoursePriceUah();
  return [
    [Markup.button.callback(sparkleLabel(`Оплатити ${price} грн`), WAYFORPAY_INVOICE_CALLBACK)],
  ];
}

function buildLegacyCheckoutCreatedMessageUa(price: number, orderReference: string): string {
  return (
    `Рахунок WayForPay на суму ${price} грн за доступ до навчального продукту ` +
    "«Multimasking Learning Project» створено.\n\n" +
    "Натисніть кнопку нижче, щоб перейти до безпечної оплати.\n\n" +
    "Після оплати підтвердження зазвичай надходить протягом 1-2 хвилин. " +
    "Будь ласка, не створюйте повторну оплату, доки очікуєте результат.\n\n" +
    `Номер замовлення: ${orderReference}`
  );
}

function buildMonthlySubscriptionCheckoutMessageUa(
  price: number,
  orderReference: string,
): string {
  return (
    `Щомісячна підписка WayForPay — ${price} грн/міс за доступ до навчального продукту ` +
    "«Multimasking Learning Project».\n\n" +
    "Перше списання — зараз; наступні — автоматично щомісяця, поки підписка активна.\n\n" +
    "Натисніть кнопку нижче, щоб перейти до оформлення на WayForPay.\n\n" +
    "Після першої оплати підтвердження зазвичай надходить протягом 1-2 хвилин. " +
    "Не створюйте повторне оформлення, доки очікуєте результат.\n\n" +
    `Номер замовлення: ${orderReference}`
  );
}

function buildYearlySubscriptionCheckoutMessageUa(
  price: number,
  orderReference: string,
): string {
  return (
    `Річна підписка WayForPay — ${price} грн/рік за доступ до навчального продукту ` +
    "«Multimasking Learning Project».\n\n" +
    "Перше списання — зараз; наступні — автоматично щороку, поки підписка активна.\n\n" +
    "Натисніть кнопку нижче, щоб перейти до оформлення на WayForPay.\n\n" +
    "Після першої оплати підтвердження зазвичай надходить протягом 1-2 хвилин. " +
    "Не створюйте повторне оформлення, доки очікуєте результат.\n\n" +
    `Номер замовлення: ${orderReference}`
  );
}

function buildSubscriptionCheckoutMessageUa(
  planCode: ProductionSubscriptionPlanCode,
  price: number,
  orderReference: string,
): string {
  return isYearlySubscriptionPlanCode(planCode)
    ? buildYearlySubscriptionCheckoutMessageUa(price, orderReference)
    : buildMonthlySubscriptionCheckoutMessageUa(price, orderReference);
}

async function runMultimaskingCheckoutPrechecks(
  ctx: Context,
): Promise<{ ok: true; chatId: number; telegramId: string } | { ok: false }> {
  const chatId = ctx.from?.id;
  if (chatId == null) {
    return { ok: false };
  }
  if (!isPrivateChat(ctx)) {
    await ctx.answerCbQuery().catch(() => {});
    return { ok: false };
  }

  const telegramId = String(chatId);
  if (!(await hasAcceptedCurrentRules(telegramId))) {
    await ctx.answerCbQuery(CALLBACK_ALERT_CONSENT_REQUIRED_FOR_PAYMENT_UA, {
      show_alert: true,
    });
    const { text, extra } = buildPaymentNeedsConsentMessageAndKeyboard();
    await ctx.reply(text, extra);
    return { ok: false };
  }

  const dbUser = await TelegramUser.findOne({ where: { telegramId } });
  const emailRaw = dbUser?.email?.trim();

  if (!dbUser) {
    await ctx.answerCbQuery("Профіль не знайдено. Спробуйте /start.");
    await ctx.reply("Профіль не знайдено. Спробуйте /start.");
    return { ok: false };
  }
  if (!emailRaw) {
    await ctx.answerCbQuery(CALLBACK_ALERT_EMAIL_REQUIRED_FOR_PAYMENT_UA, {
      show_alert: true,
    });
    await ctx.reply(EMAIL_REQUIRED_BEFORE_PAYMENT_MESSAGE_UA);
    return { ok: false };
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
        "Після оновлення email знову відкрийте меню оплати (/payment).\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { ok: false };
  }

  const rankSnapshot = await computeKwigaRankSnapshot(dbUser);
  if (!isKwigaRankEligibleForPaidChatPurchase(rankSnapshot.rank)) {
    await ctx.answerCbQuery();
    await ctx.reply(multimaskingIneligibleUserMessageUa(rankSnapshot.rank));
    return { ok: false };
  }

  const access = await hasActiveMultimaskingAccess(contact.id, telegramId);
  if (access.hasAccess) {
    const activeCtx = toAlreadyActiveContext(access);
    await ctx.answerCbQuery(buildMultimaskingAlreadyActiveAlertUa(activeCtx), {
      show_alert: true,
    });
    await ctx.reply(await buildMultimaskingAlreadyActivePaymentMessageUa(activeCtx));
    return { ok: false };
  }

  return { ok: true, chatId, telegramId };
}

async function handleMultimaskingSubscriptionCheckout(
  ctx: Context,
  planCode: ProductionSubscriptionPlanCode,
): Promise<void> {
  const precheck = await runMultimaskingCheckoutPrechecks(ctx);
  if (!precheck.ok) {
    return;
  }

  await ctx.answerCbQuery();

  const { chatId } = precheck;

  if (subscriptionFlags.subscriptionReturnFlowEnabled) {
    const recovered = await recoverSubscriptionCheckout(String(chatId));
    if (recovered.hasActiveOrder) {
      const planLabel = describeSubscriptionPlanPeriodUa(recovered.planCode);
      await ctx.reply(
        `У вас уже є незавершене оформлення ${planLabel} підписки. Оберіть дію:`,
        Markup.inlineKeyboard([
          Markup.button.callback(
            sparkleLabel("Продовжити оформлення"),
            SUBSCRIPTION_CONTINUE_CHECKOUT_CALLBACK,
          ),
          Markup.button.callback(
            sparkleLabel("Створити новий рахунок"),
            SUBSCRIPTION_RECREATE_CHECKOUT_CALLBACK,
          ),
        ]),
      );
      return;
    }
  }

  const checkout = await createSubscriptionCheckout({
    userId: String(chatId),
    planCode,
    forceNew: false,
  });
  if (!checkout.ok) {
    await ctx.reply(
      checkout.reason === "plan_not_found"
        ? "План підписки не знайдено. Зверніться до підтримки."
        : "Не вдалося створити рахунок. Спробуйте пізніше.",
    );
    return;
  }

  const pricing = await getYearlySubscriptionPricing();
  const price = isYearlySubscriptionPlanCode(planCode)
    ? pricing.yearlyPriceUah
    : pricing.monthlyPriceUah;

  await ctx.reply(
    buildSubscriptionCheckoutMessageUa(planCode, price, checkout.orderReference),
    Markup.inlineKeyboard([
      Markup.button.url(sparkleLabel("Оформити підписку"), checkout.checkoutUrl),
    ]),
  );
}

async function handleLegacyMultimaskingCheckout(ctx: Context): Promise<void> {
  const precheck = await runMultimaskingCheckoutPrechecks(ctx);
  if (!precheck.ok) {
    return;
  }

  await ctx.answerCbQuery();

  const price = await getMultimaskingCoursePriceUah();
  const { createCheckoutForCourse } = await import("../../payment/payment.service");
  const legacy = await createCheckoutForCourse(
    price,
    MULTIMASKING_PRODUCT_NAME,
    String(precheck.chatId),
  );

  await ctx.reply(
    buildLegacyCheckoutCreatedMessageUa(price, legacy.orderReference),
    Markup.inlineKeyboard([
      Markup.button.url(sparkleLabel("Перейти до оплати"), legacy.invoiceUrl),
    ]),
  );
}

/**
 * Кнопка оплати — лише якщо email є, контакт у KWIGA є і ранг masters/pro.
 * Інакше одна кнопка з поясненням (деталі по натисканню).
 */
export async function buildWayForPayInvoiceKeyboard(telegramId: string) {
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
    return Markup.inlineKeyboard(await buildEligiblePayKeyboardRows());
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

  const access = await hasActiveMultimaskingAccess(contact.id, telegramId);
  if (access.hasAccess) {
    const activeRows: ReturnType<typeof Markup.button.callback>[][] = [
      [
        Markup.button.callback(
          sparkleLabel("Доступ уже активний"),
          WFP_ALREADY_ACTIVE_INFO,
        ),
      ],
    ];
    if (
      subscriptionFlags.subscriptionModeEnabled &&
      access.source !== "subscription_auto"
    ) {
      activeRows.push([
        Markup.button.callback(
          sparkleLabel("Продовжити підписку"),
          SUBSCRIPTION_RENEW_NOW_CALLBACK,
        ),
      ]);
    }
    return Markup.inlineKeyboard(activeRows);
  }

  return Markup.inlineKeyboard(await buildEligiblePayKeyboardRows());
}

export function registerWayForPayInvoiceHandlers(bot: Telegraf<Context>): void {
  bot.action(SUBSCRIPTION_RENEW_NOW_CALLBACK, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery();

      if (!subscriptionFlags.subscriptionModeEnabled) {
        await ctx.reply(
          "Режим підписок зараз вимкнено. Спробуйте пізніше або зверніться до підтримки.",
        );
        return;
      }

      const renewed = await renewSubscriptionCheckout({
        userId: String(chatId),
        planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
        forceNew: false,
      });
      if (!renewed.ok) {
        await ctx.reply(
          renewed.reason === "plan_not_found"
            ? "План підписки не знайдено. Зверніться до підтримки."
            : "Не вдалося створити рахунок на продовження. Спробуйте пізніше.",
        );
        return;
      }

      await ctx.reply(
        "Посилання на щомісячну підписку WayForPay сформовано.\n\n" +
          "Перше списання — зараз; далі — автоматично щомісяця.\n\n" +
          `Номер замовлення: ${renewed.orderReference}`,
        Markup.inlineKeyboard([
          Markup.button.url(
            sparkleLabel("Оформити підписку"),
            renewed.checkoutUrl,
          ),
        ]),
      );
    } catch (err) {
      console.error("subscription renew callback:", err);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Помилка при оформленні продовження. Спробуйте пізніше.");
    }
  });

  bot.action(SUBSCRIPTION_CONTINUE_CHECKOUT_CALLBACK, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery();

      const recovered = await recoverSubscriptionCheckout(String(chatId));
      if (!recovered.hasActiveOrder) {
        await ctx.reply(
          "Активний рахунок не знайдено. Створіть новий через кнопку «Створити новий рахунок».",
        );
        return;
      }
      if (!recovered.checkoutUrl) {
        await ctx.reply(
          "Знайдено незавершений платіж, але посилання недоступне. Створіть новий рахунок.",
          Markup.inlineKeyboard([
            Markup.button.callback(
              sparkleLabel("Створити новий рахунок"),
              SUBSCRIPTION_RECREATE_CHECKOUT_CALLBACK,
            ),
          ]),
        );
        return;
      }

      await ctx.reply(
        `Знайшли незавершене оформлення ${describeSubscriptionPlanPeriodUa(recovered.planCode)} підписки. Продовжіть за наявним посиланням:\n\n` +
          `Номер замовлення: ${recovered.orderReference}`,
        Markup.inlineKeyboard([
          Markup.button.url(
            sparkleLabel("Продовжити оформлення"),
            recovered.checkoutUrl,
          ),
          Markup.button.callback(
            sparkleLabel("Створити новий рахунок"),
            SUBSCRIPTION_RECREATE_CHECKOUT_CALLBACK,
          ),
        ]),
      );
    } catch (err) {
      console.error("subscription continue checkout callback:", err);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Помилка при відновленні оплати. Спробуйте пізніше.");
    }
  });

  bot.action(SUBSCRIPTION_RECREATE_CHECKOUT_CALLBACK, async (ctx) => {
    try {
      const chatId = ctx.from?.id;
      if (chatId == null) return;
      if (!isPrivateChat(ctx)) {
        await ctx.answerCbQuery().catch(() => {});
        return;
      }
      await ctx.answerCbQuery();

      const recovered = await recoverSubscriptionCheckout(String(chatId));
      const planCode =
        recovered.hasActiveOrder &&
        recovered.planCode === YEARLY_SUBSCRIPTION_PLAN_CODE
          ? YEARLY_SUBSCRIPTION_PLAN_CODE
          : MONTHLY_SUBSCRIPTION_PLAN_CODE;

      const recreated = await recreateSubscriptionCheckout({
        userId: String(chatId),
        planCode,
      });
      if (!recreated.ok) {
        await ctx.reply(
          recreated.reason === "plan_not_found"
            ? "План підписки не знайдено. Зверніться до підтримки."
            : "Не вдалося створити новий рахунок. Спробуйте пізніше.",
        );
        return;
      }

      const pricing = await getYearlySubscriptionPricing();
      const price = isYearlySubscriptionPlanCode(planCode)
        ? pricing.yearlyPriceUah
        : pricing.monthlyPriceUah;

      await ctx.reply(
        `Створено нове оформлення ${describeSubscriptionPlanPeriodUa(planCode)} підписки (${price} грн).\n\n` +
          `Номер замовлення: ${recreated.orderReference}`,
        Markup.inlineKeyboard([
          Markup.button.url(sparkleLabel("Оформити підписку"), recreated.checkoutUrl),
        ]),
      );
    } catch (err) {
      console.error("subscription recreate checkout callback:", err);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Помилка при створенні нового рахунку. Спробуйте пізніше.");
    }
  });

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
      const access = await hasActiveMultimaskingAccess(contact.id, telegramId);
      if (!access.hasAccess) {
        await ctx.answerCbQuery(
          "Активної оплати вже немає — відкрийте /payment та оформіть доступ.",
        );
        return;
      }
      const activeCtx = toAlreadyActiveContext(access);
      await ctx.answerCbQuery(buildMultimaskingAlreadyActiveAlertUa(activeCtx), {
        show_alert: true,
      });
      await ctx.reply(await buildMultimaskingAlreadyActivePaymentMessageUa(activeCtx));
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

  bot.action(WFP_SUB_MONTHLY_CALLBACK, async (ctx) => {
    try {
      await handleMultimaskingSubscriptionCheckout(ctx, MONTHLY_SUBSCRIPTION_PLAN_CODE);
    } catch (err) {
      console.error("WayForPay monthly subscription callback failed:", err);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Не вдалося створити рахунок. Спробуйте пізніше.");
    }
  });

  bot.action(WFP_SUB_YEARLY_CALLBACK, async (ctx) => {
    try {
      await handleMultimaskingSubscriptionCheckout(ctx, YEARLY_SUBSCRIPTION_PLAN_CODE);
    } catch (err) {
      console.error("WayForPay yearly subscription callback failed:", err);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply("Не вдалося створити рахунок. Спробуйте пізніше.");
    }
  });

  bot.action(WAYFORPAY_INVOICE_CALLBACK, async (ctx) => {
    try {
      if (subscriptionFlags.subscriptionModeEnabled) {
        await handleMultimaskingSubscriptionCheckout(ctx, MONTHLY_SUBSCRIPTION_PLAN_CODE);
        return;
      }
      await handleLegacyMultimaskingCheckout(ctx);
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
