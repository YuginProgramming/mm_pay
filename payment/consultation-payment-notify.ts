import { ConsultationCase } from "../database/ConsultationCase";
import type { ConsultationProductCode } from "./consultation-product";
import { PAYMENT_APPROVED_ASK_DISPLAY_NAME_SUFFIX } from "../telegram/consultation/content";
import { sendPostDisplayNameFollowUp } from "../telegram/consultation/display-name-handlers";

function productLabel(productCode: ConsultationProductCode): string {
  return productCode === "consultation_master_one_time"
    ? "консультації для майстрів"
    : "персональної консультації";
}

async function sendConsultationMessage(
  chatId: string,
  text: string,
  callbackDataButton?: { text: string; callbackData: string },
): Promise<void> {
  const token = process.env.CONSULTATION_BOT_TOKEN;
  if (!token) {
    console.error("[consultation-payment] CONSULTATION_BOT_TOKEN is not set");
    return;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(callbackDataButton
          ? {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: callbackDataButton.text,
                      callback_data: callbackDataButton.callbackData,
                    },
                  ],
                ],
              },
            }
          : {}),
      }),
    },
  );
  if (!res.ok) {
    console.error(
      "[consultation-payment] sendMessage failed",
      res.status,
      await res.text(),
    );
  }
}

export async function notifyConsultationPaymentApproved(input: {
  chatId: string;
  productCode: ConsultationProductCode;
  orderReference: string;
}): Promise<void> {
  const existingCase = await ConsultationCase.findOne({
    where: { orderReference: input.orderReference },
  });
  if (existingCase?.displayName?.trim()) {
    await sendPostDisplayNameFollowUp({
      chatId: input.chatId,
      productCode: existingCase.productCode,
    });
    return;
  }

  await sendConsultationMessage(
    input.chatId,
    `Оплату ${productLabel(input.productCode)} підтверджено ✅\n\n` +
      PAYMENT_APPROVED_ASK_DISPLAY_NAME_SUFFIX,
  );
}

export async function notifyConsultationPaymentPending(input: {
  chatId: string;
  productCode: ConsultationProductCode;
  orderReference: string;
  transactionStatus: string;
}): Promise<void> {
  await sendConsultationMessage(
    input.chatId,
    `Статус оплати ${productLabel(input.productCode)}: в обробці.\n\n` +
      `WayForPay статус: ${input.transactionStatus}.\n` +
      "Підтвердження може зайняти кілька хвилин, будь ласка, не оплачуйте повторно.\n\n" +
      `Номер замовлення: ${input.orderReference}`,
  );
}

export async function notifyConsultationPaymentFailed(input: {
  chatId: string;
  productCode: ConsultationProductCode;
  orderReference: string;
  transactionStatus: string;
}): Promise<void> {
  await sendConsultationMessage(
    input.chatId,
    `Оплату ${productLabel(input.productCode)} не завершено ❌\n\n` +
      `WayForPay статус: ${input.transactionStatus}.\n` +
      "Спробуйте оплатити ще раз з кнопки у меню консультації.\n\n" +
      `Номер замовлення: ${input.orderReference}`,
  );
}
