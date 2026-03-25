/**
 * HTTP API for WayForPay: webhook + optional checkout JSON endpoint.
 *
 * Set WFP_SERVICE_URL in the merchant cabinet to:
 *   https://<your-host>/wayforpay/webhook
 *
 * Env:
 *   PAYMENT_HTTP_PORT — listen port (default: PORT or 3000)
 *   WFP_* — see payment.config.ts
 */
import "dotenv/config";
import express from "express";
import { handleCreateCheckout, handleWayForPayWebhook } from "./payment.controller";

const app = express();
const port = Number(process.env.PAYMENT_HTTP_PORT ?? process.env.PORT ?? "3000");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "payment" });
});

app.post("/wayforpay/webhook", (req, res) => {
  const body = req.body;
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  console.log("[payment] POST /wayforpay/webhook", {
    contentType: req.headers["content-type"],
    bodyKeys: keys.slice(0, 20),
    orderReference:
      body && typeof body === "object" && body !== null && "orderReference" in body
        ? (body as { orderReference?: string }).orderReference
        : undefined,
    transactionStatus:
      body && typeof body === "object" && body !== null && "transactionStatus" in body
        ? (body as { transactionStatus?: string }).transactionStatus
        : undefined,
  });
  void handleWayForPayWebhook(req, res);
});
app.post("/wayforpay/checkout", handleCreateCheckout);

app.listen(port, () => {
  console.log(
    `[payment] listening on http://0.0.0.0:${port}\n` +
      `  POST /wayforpay/webhook\n` +
      `  POST /wayforpay/checkout  (JSON: price, courseName, chatId)\n` +
      `  GET  /health`,
  );
});
