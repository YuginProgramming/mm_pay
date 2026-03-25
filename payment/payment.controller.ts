import type { Request, Response } from "express";
import type { WayForPayWebhookPayload } from "./payment.types";
import {
  buildAcceptAck,
  buildDeclineAck,
  createCheckoutForCourse,
  isApprovedPayment,
  releasePendingIfTerminal,
  resolveWebhookMetadata,
  verifyIncomingWebhook,
} from "./payment.service";
import { logPaymentEvent } from "./payment-events";

const parseWebhookBody = (body: unknown): WayForPayWebhookPayload => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("[webhook] Invalid body");
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length === 1) {
    const firstKey = keys[0];
    try {
      const parsed = JSON.parse(firstKey) as WayForPayWebhookPayload;
      if (parsed?.merchantAccount) return parsed;
    } catch {
      // fall through to direct body
    }
  }

  return body as WayForPayWebhookPayload;
};

const handleWayForPayWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const data = parseWebhookBody(req.body);

    if (!verifyIncomingWebhook(data)) {
      res
        .status(400)
        .json("Corrupted webhook received. Webhook signature is not authentic.");
      return;
    }

    const metadata = resolveWebhookMetadata(data);
    await logPaymentEvent({ payload: data, metadata });

    releasePendingIfTerminal(data);

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
