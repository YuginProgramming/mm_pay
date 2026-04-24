import { Op } from "sequelize";
import { WayforpayPendingNotice } from "../database/WayforpayPendingNotice";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../telegram/core/support";
import { sendTelegramBotMessage } from "./telegram-notify";

const PENDING_NOTIFY_ENABLED = process.env.WAYFORPAY_NOTIFY_PENDING !== "false";

function parseEnvSeconds(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getPendingReminderSeconds(): number {
  return parseEnvSeconds("WAYFORPAY_PENDING_REMINDER_SECONDS", 120);
}

export function getPendingTimeoutSeconds(): number {
  return parseEnvSeconds("WAYFORPAY_PENDING_TIMEOUT_SECONDS", 900);
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function ensurePendingNoticeRow(
  orderReference: string,
  chatId?: string | null,
): Promise<void> {
  const safeChatId = isNonEmptyString(chatId) ? chatId.trim() : null;
  const existing = await WayforpayPendingNotice.findByPk(orderReference);
  if (existing) {
    if (!existing.chatId && safeChatId) {
      existing.chatId = safeChatId;
      await existing.save();
    }
    return;
  }
  await WayforpayPendingNotice.create({
    orderReference,
    chatId: safeChatId,
  });
}

export async function notifyPendingProcessingIfFirstTime(input: {
  orderReference: string;
  chatId?: string | null;
  transactionStatus: string;
}): Promise<void> {
  if (!PENDING_NOTIFY_ENABLED) {
    return;
  }

  const { orderReference, chatId, transactionStatus } = input;
  const now = new Date();
  await ensurePendingNoticeRow(orderReference, chatId);

  const [updatedCount] = await WayforpayPendingNotice.update(
    {
      firstPendingAt: now,
      pendingNotifiedAt: now,
    },
    {
      where: {
        orderReference,
        terminalStatusAt: { [Op.is]: null },
        pendingNotifiedAt: { [Op.is]: null },
      },
    },
  );

  if (updatedCount < 1) {
    await WayforpayPendingNotice.update(
      { firstPendingAt: now },
      {
        where: {
          orderReference,
          terminalStatusAt: { [Op.is]: null },
          firstPendingAt: { [Op.is]: null },
        },
      },
    );
    return;
  }

  if (!isNonEmptyString(chatId)) {
    console.error("[payment] pending notify skipped: missing chatId", {
      orderReference,
      transactionStatus,
    });
    return;
  }

  const status = transactionStatus.trim() || "Pending";
  await sendTelegramBotMessage(
    chatId.trim(),
    "Статус оплати: Оплата обробляється.\n\n" +
      "Платіж отримано і зараз триває підтвердження банком/3DS (статус WayForPay: " +
      status +
      "). Це нормально.\n\n" +
      "Будь ласка, не оплачуйте повторно. Ми надішлемо фінальне підтвердження автоматично.\n\n" +
      "Номер замовлення: " +
      orderReference,
  );
}

export async function markPendingOrderTerminal(input: {
  orderReference: string;
  transactionStatus: string;
}): Promise<void> {
  const { orderReference, transactionStatus } = input;
  await ensurePendingNoticeRow(orderReference);
  await WayforpayPendingNotice.update(
    {
      terminalStatusAt: new Date(),
      terminalStatusValue: transactionStatus.trim() || null,
    },
    {
      where: {
        orderReference,
        terminalStatusAt: { [Op.is]: null },
      },
    },
  );
}

async function markStageAndSendMessage(input: {
  orderReference: string;
  field: "pendingReminderSentAt" | "pendingTimeoutSentAt";
  textBuilder: (orderReference: string) => string;
}): Promise<void> {
  const row = await WayforpayPendingNotice.findByPk(input.orderReference);
  if (!row || row.terminalStatusAt || !isNonEmptyString(row.chatId)) {
    return;
  }

  const now = new Date();
  const [updatedCount] = await WayforpayPendingNotice.update(
    { [input.field]: now },
    {
      where: {
        orderReference: input.orderReference,
        terminalStatusAt: { [Op.is]: null },
        [input.field]: { [Op.is]: null },
      },
    },
  );
  if (updatedCount < 1) {
    return;
  }

  await sendTelegramBotMessage(
    row.chatId,
    input.textBuilder(input.orderReference),
  );
}

export async function sendDuePendingReminderAlerts(now: Date = new Date()): Promise<void> {
  if (!PENDING_NOTIFY_ENABLED) {
    return;
  }
  const reminderSince = new Date(now.getTime() - getPendingReminderSeconds() * 1000);
  const rows = await WayforpayPendingNotice.findAll({
    where: {
      terminalStatusAt: { [Op.is]: null },
      pendingNotifiedAt: { [Op.not]: null },
      pendingReminderSentAt: { [Op.is]: null },
      firstPendingAt: { [Op.lte]: reminderSince },
    },
    limit: 100,
    order: [["firstPendingAt", "ASC"]],
  });

  for (const row of rows) {
    await markStageAndSendMessage({
      orderReference: row.orderReference,
      field: "pendingReminderSentAt",
      textBuilder: (orderReference) =>
        "Статус оплати: Все ще очікуємо підтвердження.\n\n" +
        "Ми ще чекаємо відповідь банку. Зазвичай підтвердження надходить протягом 5-10 хвилин.\n\n" +
        "Будь ласка, не створюйте повторну оплату.\n\n" +
        "Номер замовлення: " +
        orderReference,
    });
  }
}

export async function sendDuePendingTimeoutAlerts(now: Date = new Date()): Promise<void> {
  if (!PENDING_NOTIFY_ENABLED) {
    return;
  }
  const timeoutSince = new Date(now.getTime() - getPendingTimeoutSeconds() * 1000);
  const rows = await WayforpayPendingNotice.findAll({
    where: {
      terminalStatusAt: { [Op.is]: null },
      pendingNotifiedAt: { [Op.not]: null },
      pendingTimeoutSentAt: { [Op.is]: null },
      firstPendingAt: { [Op.lte]: timeoutSince },
    },
    limit: 100,
    order: [["firstPendingAt", "ASC"]],
  });

  for (const row of rows) {
    await markStageAndSendMessage({
      orderReference: row.orderReference,
      field: "pendingTimeoutSentAt",
      textBuilder: (orderReference) =>
        "Статус оплати: Підтвердження затримується.\n\n" +
        "Підтвердження від банку займає більше часу, ніж зазвичай. Збережіть номер замовлення та перевірте статус пізніше.\n\n" +
        "За потреби зверніться до підтримки:\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA +
        "\n\nНомер замовлення: " +
        orderReference,
    });
  }
}
