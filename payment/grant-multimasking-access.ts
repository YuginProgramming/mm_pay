import { findContactByEmailForBot } from "../database/contact-lookup";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { countContactAccessRowsForKwigaTier } from "../telegram/profile/kwiga-rank-db";
import { normalizeEmail } from "../database/normalize-email";
import { TelegramUser } from "../database/TelegramUser";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_PRODUCT_NAME,
} from "./multimasking-product";
import {
  MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
  MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
} from "./multimasking-telegram-groups";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { kwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { escapeTelegramHtml, telegramHtmlLink } from "../telegram/core/telegram-html";

/**
 * Сума з webhook; ціна в боті (app_settings) може бути іншою — доступ надаємо за фактом підтвердженої оплати.
 */
function parsePositivePaidAmount(
  amount: number | string,
): { ok: true; value: number } | { ok: false } {
  const raw = typeof amount === "string" ? amount.trim().replace(",", ".") : amount;
  const n = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

function formatAmountUaHuman(amount: number): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatEndDateUk(end: Date): string {
  return end.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Kyiv",
  });
}

/**
 * Після верифікації підпису webhook: запис у БД (30 днів) + повідомлення в чат.
 * Ідемпотентно за payload.orderReference.
 */
export async function processApprovedMultimaskingPayment(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
): Promise<void> {
  const orderReference = payload.orderReference;
  const chatId = metadata.chatId.trim();
  const courseName = metadata.courseName.trim();

  const existing = await ContactProductAccess.findOne({
    where: { wayforpayOrderReference: orderReference },
  });
  if (existing) {
    console.log("[payment] skip duplicate webhook for order", orderReference);
    return;
  }

  const paidParse = parsePositivePaidAmount(payload.amount);
  if (!paidParse.ok) {
    console.error("[payment] invalid or zero amount in webhook", {
      orderReference,
      amount: payload.amount,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж зафіксовано, але сума в повідомленні некоректна. Зверніться до підтримки, номер замовлення:\n" +
        orderReference,
    );
    return;
  }
  const paidUah = paidParse.value;

  const currency = String(payload.currency ?? "").toUpperCase();
  if (currency !== "UAH") {
    console.error("[payment] currency mismatch", {
      orderReference,
      currency: payload.currency,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж отримано в іншій валюті, ніж очікується. Зверніться до підтримки:\n" +
        orderReference,
    );
    return;
  }

  if (courseName !== MULTIMASKING_PRODUCT_NAME) {
    console.error("[payment] product name mismatch", {
      orderReference,
      courseName,
      expected: MULTIMASKING_PRODUCT_NAME,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж отримано, але назва продукту не збігається з поточною пропозицією. " +
        "Зверніться до підтримки:\n" +
        orderReference,
    );
    return;
  }

  const telegramUser = await TelegramUser.findOne({
    where: { telegramId: chatId },
  });

  if (!telegramUser?.email) {
    await sendTelegramBotMessage(
      chatId,
      "Оплату зараховано в WayForPay, але в боті не вказано email. " +
        "Надішліть email у боті та зверніться до підтримки для зарахування доступу.",
    );
    return;
  }

  const contact = await findContactByEmailForBot(
    normalizeEmail(telegramUser.email),
  );

  if (!contact) {
    await sendTelegramBotMessage(
      chatId,
      "Оплату отримано, але за вашим email контакт у базі не знайдено. " +
        "Перевірте email у профілі (/profile) або зверніться до підтримки.",
    );
    return;
  }

  const startAt = new Date();
  const endAt = new Date(startAt);
  endAt.setUTCDate(endAt.getUTCDate() + 30);

  console.log("[payment] granting access", {
    orderReference,
    paidUah,
    currency: payload.currency,
    contactId: contact.id,
  });

  try {
    await ContactProductAccess.create({
      contactId: contact.id,
      kwigaProductId: null,
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      externalSubscriptionId: null,
      titleSnapshot: MULTIMASKING_PRODUCT_NAME,
      isActive: true,
      isPaid: true,
      startAt,
      endAt,
      paidAt: new Date(),
      subscriptionStateTitle: "Оплата WayForPay · 30 днів",
      countAvailableDays: 30,
      countLeftDays: null,
      orderId: null,
      offerId: null,
      wayforpayOrderReference: orderReference,
      source: "payment_hook",
      revokedAt: null,
      revokedReason: null,
      lastSyncedAt: null,
    });
  } catch (err: unknown) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: string }).name)
        : "";
    if (name === "SequelizeUniqueConstraintError") {
      console.log("[payment] concurrent duplicate order", orderReference);
      return;
    }
    throw err;
  }

  const tierRowCount = await countContactAccessRowsForKwigaTier(contact.id);
  const tierAfterPayment = kwigaAudienceRank(true, tierRowCount);
  console.log("[payment] post-grant tier for success message", {
    orderReference,
    chatId,
    contactId: contact.id,
    tierRowCountExcludingPaymentHook: tierRowCount,
    tierAfterPayment,
  });

  const commonHead =
    "Вітаємо! Ви здійснили оплату у розмірі " +
    formatAmountUaHuman(paidUah) +
    " грн.\n\n" +
    "Вам надано доступ до професійної спільноти протягом одного місяця (до " +
    formatEndDateUk(endAt) +
    ").\n\n";

  const { successText, urlButtons } = paymentSuccessCopyAndButtons(
    tierAfterPayment,
    commonHead,
  );

  await sendTelegramBotMessage(chatId, successText, urlButtons, {
    parseMode: "HTML",
  });
}

function paymentSuccessCopyAndButtons(
  tier: KwigaAudienceRank,
  commonHead: string,
): {
  successText: string;
  urlButtons: { text: string; url: string }[];
} {
  const head = escapeTelegramHtml(commonHead);

  if (tier === "pro") {
    return {
      successText:
        head +
        "Далі вам доступні дві телеграм-групи — натисніть на назви нижче або кнопки.\n\n" +
        "1) " +
        telegramHtmlLink(
          MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
          "Група для Майстрів",
        ) +
        "\n" +
        "2) " +
        telegramHtmlLink(
          MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
          "Група для Про підписників",
        ) +
        "\n\n" +
        "Перевірте статус у боті: /profile",
      urlButtons: [
        { text: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
        {
          text: "Група для Про підписників",
          url: MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
        },
      ],
    };
  }

  return {
    successText:
      head +
      "Доступна телеграм-група для Майстрів — натисніть на назву нижче або кнопку.\n\n" +
      telegramHtmlLink(
        MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
        "Група для Майстрів",
      ) +
      "\n\n" +
      "Перевірте статус у боті: /profile",
    urlButtons: [
      { text: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
    ],
  };
}
