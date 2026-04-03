import { WayforpayFailureNotice } from "../database/WayforpayFailureNotice";
import { sendTelegramBotMessage } from "./telegram-notify";

/**
 * Notify user about terminal non-success payment once per orderReference (idempotent).
 * Disable with WAYFORPAY_NOTIFY_FAILURE=false.
 */
export async function notifyTerminalPaymentFailureIfFirstTime(
  orderReference: string,
  chatId: string,
  transactionStatus: string,
): Promise<void> {
  if (process.env.WAYFORPAY_NOTIFY_FAILURE === "false") {
    return;
  }

  try {
    await WayforpayFailureNotice.create({ orderReference });
  } catch (err: unknown) {
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: string }).name)
        : "";
    if (name === "SequelizeUniqueConstraintError") {
      return;
    }
    throw err;
  }

  const status = transactionStatus.trim() || "невідомо";
  await sendTelegramBotMessage(
    chatId,
    "Оплату не завершено (статус WayForPay: " +
      status +
      "). Можливі причини: відмова банку, недостатньо коштів, прострочена сесія.\n\n" +
      "Спробуйте ще раз через /payment або зверніться до підтримки.\n" +
      "Номер замовлення: " +
      orderReference,
  );
}
