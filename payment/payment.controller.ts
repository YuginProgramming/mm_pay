import type { Request, Response } from "express";
import type { WayForPayWebhookPayload } from "./payment.types";
import {
  buildAcceptAck,
  buildDeclineAck,
  createCheckoutForCourse,
  isApprovedPayment,
  isTerminalPaymentFailure,
  releasePendingIfTerminal,
  resolveWebhookMetadata,
  verifyIncomingWebhook,
} from "./payment.service";
import { notifyTerminalPaymentFailureIfFirstTime } from "./payment-failure-notify";
import { processApprovedMultimaskingPayment } from "./grant-multimasking-access";
import { logPaymentEvent } from "./payment-events";
import { persistWayforpayWebhookEvent } from "./persist-wayforpay-webhook";

const parseWebhookBody = (body: unknown): WayForPayWebhookPayload => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("[webhook] Invalid body");
  }

  const record = body as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) {
    throw new Error("[webhook] Empty body");
  }

  // Standard JSON body case.
  if ("merchantAccount" in record) {
    return record as WayForPayWebhookPayload;
  }

  // WayForPay x-www-form-urlencoded case:
  // first key is JSON prefix and first value contains products object pieces.
  const [mainRawBody, objRawProducts = {}] = entries[0];
  const rawProducts =
    objRawProducts && typeof objRawProducts === "object"
      ? Object.keys(objRawProducts as Record<string, unknown>)
      : [];

  try {
    const reconstructed = rawProducts.length > 0 ? `${mainRawBody}[${rawProducts}]}` : mainRawBody;
    return JSON.parse(reconstructed) as WayForPayWebhookPayload;
  } catch {
    // Fallback: sometimes first key can already be a full JSON string.
    try {
      return JSON.parse(mainRawBody) as WayForPayWebhookPayload;
    } catch {
      throw new Error("[webhook] Cannot parse WayForPay payload");
    }
  }
};

const handleWayForPayWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = parseWebhookBody(req.body);
    const metadata = await resolveWebhookMetadata(data);
    const signatureValid = verifyIncomingWebhook(data);

    await persistWayforpayWebhookEvent({
      payload: data,
      metadata,
      signatureValid,
    });

    if (!signatureValid) {
      res
        .status(400)
        .json("Corrupted webhook received. Webhook signature is not authentic.");
      return;
    }

    if (isApprovedPayment(data) && metadata) {
      try {
        await processApprovedMultimaskingPayment(data, metadata);
      } catch (grantErr) {
        console.error("[payment] grant after approval failed:", grantErr);
      }
    } else if (!isApprovedPayment(data) && isTerminalPaymentFailure(data)) {
      if (metadata) {
        console.log("[payment] terminal non-success webhook", {
          orderReference: data.orderReference,
          transactionStatus: data.transactionStatus,
          chatId: metadata.chatId,
        });
        try {
          await notifyTerminalPaymentFailureIfFirstTime(
            data.orderReference,
            metadata.chatId,
            String(data.transactionStatus),
          );
        } catch (notifyErr) {
          console.error("[payment] failure notify:", notifyErr);
        }
      } else {
        console.log("[payment] terminal failure, no chat metadata", {
          orderReference: data.orderReference,
          transactionStatus: data.transactionStatus,
        });
      }
    }

    await logPaymentEvent({ payload: data, metadata });

    await releasePendingIfTerminal(data);

    const ack = isApprovedPayment(data)
      ? buildAcceptAck(data.orderReference)
      : buildDeclineAck(data.orderReference);

    res.status(200).json(ack);
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send("Server Error");
  }
};

/** Same flow as old bot: invoice URL for callback handler */
const handleCreateCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const price = Number(req.body?.price);
    const courseName = String(req.body?.courseName ?? "").trim();
    const chatId = String(req.body?.chatId ?? "").trim();

    if (!Number.isFinite(price) || !courseName || !chatId) {
      res.status(400).json({ error: "price, courseName, chatId required" });
      return;
    }

    const { invoiceUrl } = await createCheckoutForCourse(price, courseName, chatId);
    res.json({ invoiceUrl });
  } catch (err) {
    console.error("Create checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

export { handleWayForPayWebhook, handleCreateCheckout, parseWebhookBody };
