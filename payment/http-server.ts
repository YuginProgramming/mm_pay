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
  handleCreateSubscriptionCheckout,
  handleGetSubscriptionStatus,
  handleRenewSubscriptionCheckout,
  handleRecreateSubscriptionCheckout,
  handleRecoverSubscriptionCheckout,
  handleWayForPayWebhook,
  parseWebhookBody,
} from "./payment.controller";
import { readRecentPaymentEvents } from "./payment-events";
import { startPendingPaymentReminderLoop } from "./pending-payment-reminder";
import { startSubscriptionRenewalReminderLoop } from "./subscription-renewal-reminder";
import { subscriptionFlags } from "./subscription-flags";
import { handleWayforpayPurchaseCheckoutPage } from "./purchase-checkout-page";

const app = express();
const port = Number(process.env.PAYMENT_HTTP_PORT ?? process.env.PORT ?? "3000");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "payment" });
});

app.get("/subscription/mode", (_req, res) => {
  const legacyWayforpayCheckoutEnabled =
    String(process.env.LEGACY_WAYFORPAY_CHECKOUT_ENABLED ?? "")
      .trim()
      .toLowerCase() === "true";

  res.status(200).json({
    ok: true,
    mode: {
      subscriptionModeEnabled: subscriptionFlags.subscriptionModeEnabled,
      subscriptionReturnFlowEnabled: subscriptionFlags.subscriptionReturnFlowEnabled,
      subscriptionRenewalJobsEnabled: subscriptionFlags.subscriptionRenewalJobsEnabled,
      legacyWayforpayCheckoutEnabled,
    },
  });
});

app.get("/payment-events", async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  const events = await readRecentPaymentEvents(limit);
  res.status(200).json({ count: events.length, events });
});
app.get("/subscription/status", handleGetSubscriptionStatus);
app.get("/subscription/checkout/recover", handleRecoverSubscriptionCheckout);

app.get("/wayforpay/purchase/:orderReference", (req, res) => {
  void handleWayforpayPurchaseCheckoutPage(req, res);
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
app.post("/subscription/checkout", handleCreateSubscriptionCheckout);
app.post("/subscription/renew", handleRenewSubscriptionCheckout);
app.post("/subscription/checkout/recreate", handleRecreateSubscriptionCheckout);

app.listen(port, () => {
  startPendingPaymentReminderLoop();
  startSubscriptionRenewalReminderLoop();
  if (process.env.SUBSCRIPTION_MODE_ENABLED === "true") {
    console.warn(
      "[payment] subscription mode is enabled: /wayforpay/checkout is treated as legacy " +
        "(set LEGACY_WAYFORPAY_CHECKOUT_ENABLED=true only for temporary fallback).",
    );
  }
  console.log(
    `[payment] listening on http://0.0.0.0:${port}\n` +
      `  GET  /wayforpay/purchase/:orderReference (Purchase auto-submit)\n` +
      `  POST /wayforpay/webhook\n` +
      `  POST /wayforpay/checkout  (legacy; JSON: price, courseName, chatId)\n` +
      `  POST /subscription/checkout (JSON: userId, planCode?, forceNew?)\n` +
      `  POST /subscription/renew (JSON: userId, planCode?, forceNew?)\n` +
      `  GET  /subscription/checkout/recover?userId=<telegram_id>\n` +
      `  POST /subscription/checkout/recreate (JSON: userId, planCode?)\n` +
      `  GET  /subscription/status?userId=<telegram_id>\n` +
      `  GET  /subscription/mode\n` +
      `  GET  /health\n` +
      `  GET  /payment-events?limit=20`,
  );
});
