import type { ConsultationProductCode } from "./consultation-product";

function productLabel(productCode: ConsultationProductCode): string {
  return productCode === "consultation_master_one_time"
    ? "консультації для майстрів"
    : "персональної консультації";
}

async function sendConsultationMessage(chatId: string, text: string): Promise<void> {
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
  await sendConsultationMessage(
    input.chatId,
    `Оплату ${productLabel(input.productCode)} підтверджено ✅\n\n` +
      "Дякуємо! Наступний крок буде надіслано у цьому чаті.\n\n" +
      `Номер замовлення: ${input.orderReference}`,
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
