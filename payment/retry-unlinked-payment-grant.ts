import { ContactProductAccess } from "../database/ContactProductAccess";
import type { TelegramUser } from "../database/TelegramUser";
import { WayforpayWebhookEvent } from "../database/WayforpayWebhookEvent";
import { processApprovedMultimaskingPayment } from "./grant-multimasking-access";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";

/**
 * Якщо користувач оплатив до того, як указав email, грант не створив contact_product_access.
 * Після збереження email перевіряємо wayforpay_webhook_events і повторюємо грант (ідемпотентно).
 */
export async function retryUnlinkedApprovedPaymentsForTelegramUser(
  user: TelegramUser,
): Promise<number> {
  if (!user.email?.trim()) {
    return 0;
  }

  const events = await WayforpayWebhookEvent.findAll({
    where: {
      metadataChatId: user.telegramId,
      transactionStatus: "Approved",
      signatureValid: true,
    },
    order: [["createdAt", "ASC"]],
  });

  let granted = 0;
  const seenOrder = new Set<string>();

  for (const ev of events) {
    if (seenOrder.has(ev.orderReference)) continue;
    seenOrder.add(ev.orderReference);

    const existing = await ContactProductAccess.findOne({
      where: { wayforpayOrderReference: ev.orderReference },
    });
    if (existing) continue;

    const chatId = ev.metadataChatId?.trim();
    if (!chatId || chatId !== user.telegramId) continue;

    const courseName =
      ev.metadataCourseName?.trim() || MULTIMASKING_PRODUCT_NAME;

    const raw = ev.rawPayload as WayForPayWebhookPayload | null | undefined;
    if (
      !raw ||
      typeof raw !== "object" ||
      String(raw.orderReference) !== ev.orderReference
    ) {
      console.warn(
        "[payment] skip retry grant: invalid rawPayload for",
        ev.orderReference,
      );
      continue;
    }

    const metadata: PaymentMetadata = { chatId, courseName };

    try {
      await processApprovedMultimaskingPayment(raw, metadata);
    } catch (err) {
      console.error("[payment] retry grant error", ev.orderReference, err);
      continue;
    }

    const row = await ContactProductAccess.findOne({
      where: { wayforpayOrderReference: ev.orderReference },
    });
    if (row) granted += 1;
  }

  return granted;
}
