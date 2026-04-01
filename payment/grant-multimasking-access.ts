import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { TelegramUser } from "../database/TelegramUser";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_ACCESS_PRICE_UAH,
  MULTIMASKING_PRODUCT_NAME,
} from "./multimasking-product";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";

function amountMatchesExpected(amount: number | string, expected: number): boolean {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) {
    return false;
  }
  return Math.abs(n - expected) < 0.01;
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

  if (!amountMatchesExpected(payload.amount, MULTIMASKING_ACCESS_PRICE_UAH)) {
    console.error("[payment] amount mismatch", {
      orderReference,
      amount: payload.amount,
      expected: MULTIMASKING_ACCESS_PRICE_UAH,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж зафіксовано, але сума не збігається з очікуваною. " +
        "Зверніться до підтримки та вкажіть номер замовлення:\n" +
        orderReference,
    );
    return;
  }

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

  const contact = await Contact.findOne({
    where: { email: telegramUser.email.trim() },
  });

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

  await sendTelegramBotMessage(
    chatId,
    "Оплату успішно зараховано. Доступ активний до " +
      formatEndDateUk(endAt) +
      " (30 днів з моменту оплати).\n\n" +
      "Перевірте статус: /profile",
  );
}
