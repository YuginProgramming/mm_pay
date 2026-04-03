import { WayforpayWebhookEvent } from "../database/WayforpayWebhookEvent";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";

function payloadToJsonObject(
  payload: WayForPayWebhookPayload,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

/**
 * Зберігає кожен розпарсений виклик WayForPay webhook у БД (успіх/відмова,
 * будь-яка сума, злі / вірні підписи), для аудиту й аналітики.
 */
export async function persistWayforpayWebhookEvent(input: {
  payload: WayForPayWebhookPayload;
  metadata: PaymentMetadata | null;
  signatureValid: boolean;
}): Promise<void> {
  const { payload, metadata, signatureValid } = input;

  try {
    await WayforpayWebhookEvent.create({
      orderReference: payload.orderReference,
      transactionStatus: String(payload.transactionStatus ?? ""),
      amountRaw: String(payload.amount ?? ""),
      currency: String(payload.currency ?? ""),
      reasonCode:
        payload.reasonCode === undefined || payload.reasonCode === null
          ? null
          : String(payload.reasonCode),
      merchantAccount: String(payload.merchantAccount ?? ""),
      signatureValid,
      metadataChatId: metadata?.chatId?.trim() ?? null,
      metadataCourseName: metadata?.courseName?.trim() ?? null,
      rawPayload: payloadToJsonObject(payload),
    });
  } catch (err) {
    console.error("[payment] wayforpay_webhook_events insert failed:", err);
  }
}
