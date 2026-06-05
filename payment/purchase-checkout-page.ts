import type { Request, Response } from "express";
import { WayforpayPurchaseCheckout } from "../database/WayforpayPurchaseCheckout";
import { WAYFORPAY_PURCHASE_URL } from "./wayforpay-purchase";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPurchaseAutoSubmitHtml(orderReference: string, checkout: WayforpayPurchaseCheckout): string {
  const { scalars, arrays } = checkout.formFields;
  const scalarInputs = Object.entries(scalars)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">`,
    )
    .join("\n");

  const arrayInputs = Object.entries(arrays)
    .flatMap(([name, values]) =>
      values.map(
        (value) =>
          `<input type="hidden" name="${escapeHtml(name)}[]" value="${escapeHtml(value)}">`,
      ),
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <title>Оплата WayForPay</title>
</head>
<body>
  <p>Перенаправлення на WayForPay…</p>
  <form id="wfp" method="post" action="${WAYFORPAY_PURCHASE_URL}" accept-charset="utf-8">
    ${scalarInputs}
    ${arrayInputs}
  </form>
  <script>document.getElementById("wfp").submit();</script>
  <noscript><button type="submit" form="wfp">Перейти до оплати</button></noscript>
  <!-- orderReference: ${escapeHtml(orderReference)} -->
</body>
</html>`;
}

export async function handleWayforpayPurchaseCheckoutPage(
  req: Request,
  res: Response,
): Promise<void> {
  const orderReference = String(req.params.orderReference ?? "").trim();
  if (!orderReference) {
    res.status(400).send("Missing orderReference");
    return;
  }

  const checkout = await WayforpayPurchaseCheckout.findByPk(orderReference);
  if (!checkout) {
    res.status(404).send("Checkout session not found or expired.");
    return;
  }

  res
    .status(200)
    .type("html")
    .send(renderPurchaseAutoSubmitHtml(orderReference, checkout));
}
