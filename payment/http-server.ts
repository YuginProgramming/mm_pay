/**
 * HTTP API for WayForPay: webhook + optional checkout JSON endpoint.
 *
 * Set WFP_SERVICE_URL in the merchant cabinet to:
 *   https://<your-host>/wayforpay/webhook
 *
 * Env:
 *   PAYMENT_HTTP_PORT — listen port (default: PORT or 3000)
 *   WFP_* — see payment.config.ts
 *   WAYFORPAY_NOTIFY_FAILURE — set to "false" to skip Telegram message on Declined/Expired/etc.
 *     (default: notify once per orderReference, deduped in wayforpay_failure_notices)
 */
import "dotenv/config";
import express from "express";
import {
  handleCreateCheckout,
  handleWayForPayWebhook,
  parseWebhookBody,
} from "./payment.controller";
import { readRecentPaymentEvents } from "./payment-events";

const app = express();
const port = Number(process.env.PAYMENT_HTTP_PORT ?? process.env.PORT ?? "3000");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "payment" });
});

app.get("/payment-events", async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  const events = await readRecentPaymentEvents(limit);
  res.status(200).json({ count: events.length, events });
});

app.post("/wayforpay/webhook", (req, res) => {
  const body = req.body;
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  const rawTopLevel =
    body && typeof body === "object" && body !== null && "orderReference" in body
      ? (body as { orderReference?: string; transactionStatus?: string }).orderReference
      : undefined;

  let parsedOrderReference: string | undefined;
  let parsedTransactionStatus: string | undefined;
  let parsePreviewOk = false;
  try {
    const parsed = parseWebhookBody(body);
    parsedOrderReference = parsed.orderReference;
    parsedTransactionStatus = String(parsed.transactionStatus);
    parsePreviewOk = true;
  } catch {
    // Реальна обробка й помилка — у handleWayForPayWebhook; тут лише превʼю для логу.
  }

  console.log("[payment] POST /wayforpay/webhook", {
    contentType: req.headers["content-type"],
    rawUrlencodedKeyCount: keys.length,
    rawBodyKeySample: keys.slice(0, 3).map((k) => (k.length > 80 ? `${k.slice(0, 80)}…` : k)),
    orderReferenceRawTopLevel: rawTopLevel,
    orderReference: parsePreviewOk ? parsedOrderReference : undefined,
    transactionStatus: parsePreviewOk ? parsedTransactionStatus : undefined,
    parsePreviewOk,
  });
  void handleWayForPayWebhook(req, res);
});
app.post("/wayforpay/checkout", handleCreateCheckout);

app.listen(port, () => {
  console.log(
    `[payment] listening on http://0.0.0.0:${port}\n` +
      `  POST /wayforpay/webhook\n` +
      `  POST /wayforpay/checkout  (JSON: price, courseName, chatId)\n` +
      `  GET  /health\n` +
      `  GET  /payment-events?limit=20`,
  );
});
