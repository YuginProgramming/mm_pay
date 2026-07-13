import { Op } from "sequelize";
import { getPaidChatAccessDays } from "../database/app-settings-queries";
import { findContactByEmailForBot } from "../database/contact-lookup";
import { ContactProductAccess } from "../database/ContactProductAccess";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/profile/kwiga-rank-db";
import {
  isKwigaRankEligibleForPaidChatPurchase,
  multimaskingPaidButRankIneligibleUa,
} from "../telegram/profile/paid-chat-payment-eligibility";
import { normalizeEmail } from "../database/normalize-email";
import { TelegramUser } from "../database/TelegramUser";
import {
  BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
  MULTIMASKING_PRODUCT_NAME,
} from "./multimasking-product";
import {
  MULTIMASKING_KWIGA_CABINET_URL,
  MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
  MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
} from "./multimasking-telegram-groups";
import { prolongKwigaCourseAccessForPayment } from "./grant-kwiga-course-access";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../telegram/core/support";
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

/** Українська форма «N днів» для текстів бота та `subscriptionStateTitle`. */
function formatDaysDurationUa(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дні`;
  return `${n} днів`;
}

export type MultimaskingGrantOptions = {
  /** Override `paid_chat_access_days` (e.g. subscription auto flow). */
  accessDays?: number;
  /** If set, send this text instead of the standard success message with group links. */
  successMessageText?: string;
  /** Override `subscriptionStateTitle` snapshot in contact_product_access. */
  subscriptionStateLabel?: string;
  /** Продовжити `endAt` від активного grant (recurring renewal), не від `now`. */
  renewalExtendFromActiveGrant?: boolean;
  /** Не надсилати success-повідомлення (напр. renewal DM окремо). */
  skipSuccessMessage?: boolean;
};

export type MultimaskingGrantResult = {
  granted: boolean;
  grantEndAt?: Date;
};

function maxActiveGrantEndAt(rows: ContactProductAccess[], now: Date): Date {
  let max = now;
  for (const row of rows) {
    const end = row.endAt;
    if (end != null && end.getTime() > max.getTime()) {
      max = end;
    }
  }
  return max;
}

async function resolveGrantWindow(
  contactId: number,
  accessDays: number,
  renewalExtend: boolean,
): Promise<{ startAt: Date; endAt: Date }> {
  const now = new Date();
  if (!renewalExtend) {
    const endAt = new Date(now);
    endAt.setUTCDate(endAt.getUTCDate() + accessDays);
    return { startAt: now, endAt };
  }

  const activeRows = await ContactProductAccess.findAll({
    where: {
      contactId,
      source: "payment_hook",
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      revokedAt: null,
      isActive: true,
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }],
    },
    order: [["endAt", "DESC"]],
  });

  const extensionBase = maxActiveGrantEndAt(activeRows, now);
  const endAt = new Date(extensionBase);
  endAt.setUTCDate(endAt.getUTCDate() + accessDays);
  const startAt =
    activeRows.length > 0 && activeRows[0].startAt != null ? activeRows[0].startAt : now;

  return { startAt, endAt };
}

/**
 * Після верифікації підпису webhook: запис у БД (термін — `app_settings.paid_chat_access_days`) + повідомлення в чат.
 * Ідемпотентно за payload.orderReference.
 */
/** Нормалізований вхід ядра видачі доступу (webhook або reconciler). */
export type ApprovedMultimaskingPaymentInput = {
  orderReference: string;
  chatId: string;
  courseName: string;
  amount: number | string;
  currency: string;
};

/** Тонкий адаптер для webhook-шляху: зберігає стару сигнатуру `(payload, metadata, options)`. */
export async function processApprovedMultimaskingPayment(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
  options?: MultimaskingGrantOptions,
): Promise<MultimaskingGrantResult> {
  return grantApprovedMultimaskingAccess(
    {
      orderReference: payload.orderReference,
      chatId: metadata.chatId,
      courseName: metadata.courseName,
      amount: payload.amount,
      currency: payload.currency,
    },
    options,
  );
}

/**
 * Спільне ядро видачі/продовження доступу MULTIMASKING.
 * Використовують і webhook-шлях, і cron/poll reconciler (TZ/update-access.md §8, Option A).
 */
export async function grantApprovedMultimaskingAccess(
  input: ApprovedMultimaskingPaymentInput,
  options?: MultimaskingGrantOptions,
): Promise<MultimaskingGrantResult> {
  const orderReference = input.orderReference;
  const chatId = input.chatId.trim();
  const courseName = input.courseName.trim();

  const existing = await ContactProductAccess.findOne({
    where: { wayforpayOrderReference: orderReference },
  });
  if (existing) {
    console.log("[payment] skip duplicate webhook for order", orderReference);
    return { granted: false };
  }

  const paidParse = parsePositivePaidAmount(input.amount);
  if (!paidParse.ok) {
    console.error("[payment] invalid or zero amount in webhook", {
      orderReference,
      amount: input.amount,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж зафіксовано, але сума в повідомленні некоректна. Зверніться до підтримки, номер замовлення:\n" +
        orderReference +
        "\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { granted: false };
  }
  const paidUah = paidParse.value;

  const currency = String(input.currency ?? "").toUpperCase();
  if (currency !== "UAH") {
    console.error("[payment] currency mismatch", {
      orderReference,
      currency: input.currency,
    });
    await sendTelegramBotMessage(
      chatId,
      "Платіж отримано в іншій валюті, ніж очікується. Зверніться до підтримки:\n" +
        orderReference +
        "\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { granted: false };
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
        orderReference +
        "\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { granted: false };
  }

  const telegramUser = await TelegramUser.findOne({
    where: { telegramId: chatId },
  });

  if (!telegramUser?.email) {
    await sendTelegramBotMessage(
      chatId,
      "Оплату в WayForPay зафіксовано, але в боті не збережено email — без нього ми не зможемо зарахувати доступ до профілю KWIGA.\n\n" +
        "Надішліть у цьому чаті свій email одним повідомленням і перевірте /profile. " +
        "Якщо доступ не з’явиться автоматично — зверніться до підтримки з номером замовлення:\n" +
        orderReference +
        "\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { granted: false };
  }

  const contact = await findContactByEmailForBot(
    normalizeEmail(telegramUser.email),
  );

  if (!contact) {
    await sendTelegramBotMessage(
      chatId,
      "Оплату в WayForPay зафіксовано, але за email із бота контакта у KWIGA не знайдено — автоматично зарахувати доступ неможливо.\n\n" +
        "Перевірте адресу в /profile, за потреби змініть через /change_email або зверніться до підтримки з номером замовлення:\n" +
        orderReference +
        "\n\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { granted: false };
  }

  const preGrantRankSnapshot = await computeKwigaRankSnapshot(telegramUser);
  if (!isKwigaRankEligibleForPaidChatPurchase(preGrantRankSnapshot.rank)) {
    console.error("[payment] grant blocked: rank not eligible for paid chats", {
      orderReference,
      chatId,
      contactId: contact.id,
      rank: preGrantRankSnapshot.rank,
    });
    await sendTelegramBotMessage(
      chatId,
      multimaskingPaidButRankIneligibleUa(orderReference, preGrantRankSnapshot.rank),
    );
    return { granted: false };
  }

  const accessDays =
    options?.accessDays != null && options.accessDays >= 1
      ? Math.floor(options.accessDays)
      : await getPaidChatAccessDays();
  const renewalExtend = Boolean(options?.renewalExtendFromActiveGrant);
  const { startAt, endAt } = await resolveGrantWindow(
    contact.id,
    accessDays,
    renewalExtend,
  );

  console.log("[payment] granting access", {
    orderReference,
    paidUah,
    currency: input.currency,
    contactId: contact.id,
    accessDays,
    renewalExtend,
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
      subscriptionStateTitle:
        options?.subscriptionStateLabel ??
        (options?.accessDays
          ? `Автопродовження · ${formatDaysDurationUa(accessDays)}`
          : `Оплата WayForPay · ${formatDaysDurationUa(accessDays)}`),
      countAvailableDays: accessDays,
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
      return { granted: false };
    }
    throw err;
  }

  try {
    if (contact.externalId != null) {
      const kwigaResult = await prolongKwigaCourseAccessForPayment({
        email: normalizeEmail(telegramUser.email)!,
        kwigaContactId: contact.externalId,
        localContactId: contact.id,
        targetEndAt: endAt,
        orderReference,
        fallbackDays: accessDays,
        apply: true,
      });
      console.log("[payment] kwiga prolong result", {
        orderReference,
        contactId: contact.id,
        kwigaContactId: contact.externalId,
        status: kwigaResult.status,
        grantsApplied: kwigaResult.grantsApplied,
        idempotentSkip: kwigaResult.idempotentSkip ?? false,
      });
    } else {
      console.warn("[payment] kwiga prolong skipped: contact has no externalId", {
        orderReference,
        contactId: contact.id,
      });
    }
  } catch (kwigaErr) {
    console.error("[payment] kwiga prolong failed after group grant", {
      orderReference,
      contactId: contact.id,
      error: kwigaErr instanceof Error ? kwigaErr.message : String(kwigaErr),
    });
  }

  /** Повідомлення після оплати: той самий «ефективний» ранг, що /profile (monotonic з telegram_users, TZ/rank-info.txt), а не сирий count→rank без збереженого pro. */
  const postGrantSnapshot = await computeKwigaRankSnapshot(telegramUser);
  await persistKwigaRankSnapshot(telegramUser, postGrantSnapshot);
  const tierAfterPayment = postGrantSnapshot.rank;
  console.log("[payment] post-grant tier for success message", {
    orderReference,
    chatId,
    contactId: contact.id,
    effectiveRank: postGrantSnapshot.rank,
    candidateRank: postGrantSnapshot.candidateRank,
    accessRowCount: postGrantSnapshot.accessRowCount,
  });

  if (options?.skipSuccessMessage) {
    return { granted: true, grantEndAt: endAt };
  }

  if (options?.successMessageText) {
    const { successText, urlButtons } = paymentSuccessCopyAndButtons(
      tierAfterPayment,
      options.successMessageText + "\n\n",
    );
    await sendTelegramBotMessage(chatId, successText, urlButtons, {
      parseMode: "HTML",
    });
    return { granted: true, grantEndAt: endAt };
  }

  const commonHead =
    "Вітаємо! Ви здійснили оплату у розмірі " +
    formatAmountUaHuman(paidUah) +
    " грн.\n\n" +
    "Вам надано доступ до професійної спільноти на " +
    formatDaysDurationUa(accessDays) +
    " (до " +
    formatEndDateUk(endAt) +
    ").\n\n";

  const { successText, urlButtons } = paymentSuccessCopyAndButtons(
    tierAfterPayment,
    commonHead,
  );

  await sendTelegramBotMessage(chatId, successText, urlButtons, {
    parseMode: "HTML",
  });

  return { granted: true, grantEndAt: endAt };
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
        "\n" +
        "3) " +
        telegramHtmlLink(
          MULTIMASKING_KWIGA_CABINET_URL,
          "Кабінет (відеолекції)",
        ) +
        "\n\n" +
        "Перевірте статус у боті: /profile",
      urlButtons: [
        { text: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
        {
          text: "Група для Про підписників",
          url: MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
        },
        { text: "Кабінет (відеолекції)", url: MULTIMASKING_KWIGA_CABINET_URL },
      ],
    };
  }

  return {
    successText:
      head +
      "Далі вам доступні розділи — натисніть на назви нижче або кнопки.\n\n" +
      "1) " +
      telegramHtmlLink(
        MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
        "Група для Майстрів",
      ) +
      "\n" +
      "2) " +
      telegramHtmlLink(
        MULTIMASKING_KWIGA_CABINET_URL,
        "Кабінет (відеолекції)",
      ) +
      "\n\n" +
      "Перевірте статус у боті: /profile",
    urlButtons: [
      { text: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
      { text: "Кабінет (відеолекції)", url: MULTIMASKING_KWIGA_CABINET_URL },
    ],
  };
}
