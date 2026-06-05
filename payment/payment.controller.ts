import type { Request, Response } from "express";
import type { WayForPayWebhookPayload } from "./payment.types";
import {
  buildAcceptAck,
  buildDeclineAck,
  createCheckoutForCourse,
  isApprovedPayment,
  isPendingOrSuspendedPayment,
  isTerminalPaymentFailure,
  releasePendingIfTerminal,
  resolveWebhookMetadata,
  verifyIncomingWebhook,
} from "./payment.service";
import { notifyTerminalPaymentFailureIfFirstTime } from "./payment-failure-notify";
import { processApprovedMultimaskingPayment } from "./grant-multimasking-access";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import {
  handleSubscriptionAutoApprovedPayment,
  isSubscriptionAutoPlanCode,
} from "./subscription-auto-webhook.service";
import { gateMultimaskingCheckoutForTelegramId } from "./multimasking-checkout-eligibility";
import { MULTIMASKING_PRODUCT_NAME } from "./multimasking-product";
import { logPaymentEvent } from "./payment-events";
import { persistWayforpayWebhookEvent } from "./persist-wayforpay-webhook";
import {
  markPendingOrderTerminal,
  notifyPendingProcessingIfFirstTime,
} from "./payment-pending-notify";
import { getSubscriptionStatusForUserId } from "./subscription-status.service";
import {
  createSubscriptionCheckout,
  renewSubscriptionCheckout,
  recreateSubscriptionCheckout,
  recoverSubscriptionCheckout,
} from "./subscription-checkout.service";
import { subscriptionFlags } from "./subscription-flags";
import {
  logSubscriptionStatusReadFailure,
  logSubscriptionStatusReadSuccess,
} from "./subscription-observability";
import { reconcileSubscriptionOrderFromWebhook } from "./subscription-webhook-resolver";
import { reconcileConsultationOrderFromWebhook } from "./consultation-payment.service";

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

    let subscriptionResolve: Awaited<
      ReturnType<typeof reconcileSubscriptionOrderFromWebhook>
    > = { handled: false, reason: "order_not_found" };
    try {
      subscriptionResolve = await reconcileSubscriptionOrderFromWebhook(data);
      if (subscriptionResolve.handled) {
        console.log("[subscription] webhook resolved", {
          orderReference: subscriptionResolve.orderReference,
          status: subscriptionResolve.status,
          updatedSubscription: subscriptionResolve.updatedSubscription,
        });
      }
    } catch (subscriptionErr) {
      console.error("[subscription] webhook resolver failed:", subscriptionErr);
    }

    try {
      const consultationResolve = await reconcileConsultationOrderFromWebhook(data);
      if (consultationResolve.handled) {
        console.log("[consultation-payment] webhook resolved", {
          orderReference: consultationResolve.orderReference,
          status: consultationResolve.status,
        });
      }
    } catch (consultationErr) {
      console.error("[consultation-payment] webhook resolver failed:", consultationErr);
    }

    if (
      isApprovedPayment(data) &&
      metadata &&
      metadata.courseName === MULTIMASKING_PRODUCT_NAME
    ) {
      try {
        const subOrder = await SubscriptionPaymentOrder.findOne({
          where: { orderReference: data.orderReference },
        });
        const plan =
          subOrder != null
            ? await SubscriptionPlan.findByPk(subOrder.planId, { attributes: ["code"] })
            : null;

        if (
          subOrder &&
          plan &&
          isSubscriptionAutoPlanCode(plan.code) &&
          subscriptionResolve.handled &&
          subscriptionResolve.status === "approved"
        ) {
          await handleSubscriptionAutoApprovedPayment(data, metadata, subOrder, subOrder.planId);
        } else {
          await processApprovedMultimaskingPayment(data, metadata);
        }
      } catch (grantErr) {
        console.error("[payment] grant after approval failed:", grantErr);
      }
    } else if (
      isPendingOrSuspendedPayment(data) &&
      metadata?.flowType !== "consultation_one_time"
    ) {
      try {
        await notifyPendingProcessingIfFirstTime({
          orderReference: data.orderReference,
          chatId: metadata?.chatId ?? null,
          transactionStatus: String(data.transactionStatus),
        });
      } catch (pendingErr) {
        console.error("[payment] pending notify:", pendingErr);
      }
    } else if (
      !isApprovedPayment(data) &&
      isTerminalPaymentFailure(data) &&
      metadata?.flowType !== "consultation_one_time"
    ) {
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

    if (isApprovedPayment(data) || isTerminalPaymentFailure(data)) {
      try {
        await markPendingOrderTerminal({
          orderReference: data.orderReference,
          transactionStatus: String(data.transactionStatus),
        });
      } catch (terminalMarkErr) {
        console.error("[payment] pending terminal marker update failed:", terminalMarkErr);
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
    const legacyOverride =
      String(process.env.LEGACY_WAYFORPAY_CHECKOUT_ENABLED ?? "")
        .trim()
        .toLowerCase() === "true";
    if (subscriptionFlags.subscriptionModeEnabled && !legacyOverride) {
      res.status(410).json({
        error: "legacy checkout is deprecated in subscription mode",
        reason: "legacy_checkout_disabled",
      });
      return;
    }

    const price = Number(req.body?.price);
    const courseName = String(req.body?.courseName ?? "").trim();
    const chatId = String(req.body?.chatId ?? "").trim();

    if (!Number.isFinite(price) || !courseName || !chatId) {
      res.status(400).json({ error: "price, courseName, chatId required" });
      return;
    }

    if (courseName === MULTIMASKING_PRODUCT_NAME) {
      const gate = await gateMultimaskingCheckoutForTelegramId(chatId);
      if (!gate.ok) {
        res.status(403).json({
          error: "multimasking checkout not allowed",
          reason: gate.reason,
          ...("rank" in gate ? { rank: gate.rank } : {}),
          ...("grantEndAtIso" in gate ? { grantEndAt: gate.grantEndAtIso } : {}),
        });
        return;
      }
    }

    const { invoiceUrl, orderReference } = await createCheckoutForCourse(
      price,
      courseName,
      chatId,
    );
    res.json({ invoiceUrl, orderReference });
  } catch (err) {
    console.error("Create checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

const handleGetSubscriptionStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = String(req.query.userId ?? "").trim();
  try {
    if (!userId) {
      res.status(400).json({ error: "userId query param is required" });
      return;
    }

    const status = await getSubscriptionStatusForUserId(userId);
    await logSubscriptionStatusReadSuccess({
      userId,
      status: status.status,
      planCode: status.planCode,
      daysLeft: status.daysLeft,
    });
    res.status(200).json({ userId, ...status });
  } catch (err) {
    if (userId) {
      try {
        await logSubscriptionStatusReadFailure({ userId, error: err });
      } catch (logErr) {
        console.error("Subscription status failure log error:", logErr);
      }
    }
    console.error("Get subscription status error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

const handleCreateSubscriptionCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!subscriptionFlags.subscriptionModeEnabled) {
      res.status(403).json({
        error: "subscription mode is disabled",
        reason: "subscription_mode_disabled",
      });
      return;
    }

    const userId = String(req.body?.userId ?? "").trim();
    const planCode = String(req.body?.planCode ?? "monthly_1m").trim();
    const forceNew =
      req.body?.forceNew === true ||
      String(req.body?.forceNew ?? "")
        .trim()
        .toLowerCase() === "true";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const result = await createSubscriptionCheckout({
      userId,
      planCode,
      forceNew,
    });

    if (!result.ok) {
      const status = result.reason === "plan_not_found" ? 404 : 409;
      res.status(status).json({
        error: "cannot create subscription checkout",
        ...result,
      });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("Create subscription checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

const handleRecoverSubscriptionCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!subscriptionFlags.subscriptionReturnFlowEnabled) {
      res.status(403).json({
        error: "subscription return flow is disabled",
        reason: "subscription_return_flow_disabled",
      });
      return;
    }

    const userId = String(req.query.userId ?? "").trim();
    if (!userId) {
      res.status(400).json({ error: "userId query param is required" });
      return;
    }

    const result = await recoverSubscriptionCheckout(userId);
    res.status(200).json(result);
  } catch (err) {
    console.error("Recover subscription checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

const handleRecreateSubscriptionCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!subscriptionFlags.subscriptionReturnFlowEnabled) {
      res.status(403).json({
        error: "subscription return flow is disabled",
        reason: "subscription_return_flow_disabled",
      });
      return;
    }

    const userId = String(req.body?.userId ?? "").trim();
    const planCode = String(req.body?.planCode ?? "monthly_1m").trim();
    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const result = await recreateSubscriptionCheckout({ userId, planCode });
    if (!result.ok) {
      const status = result.reason === "plan_not_found" ? 404 : 409;
      res.status(status).json({
        error: "cannot recreate subscription checkout",
        ...result,
      });
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("Recreate subscription checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

const handleRenewSubscriptionCheckout = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!subscriptionFlags.subscriptionModeEnabled) {
      res.status(403).json({
        error: "subscription mode is disabled",
        reason: "subscription_mode_disabled",
      });
      return;
    }

    const userId = String(req.body?.userId ?? "").trim();
    const planCode = String(req.body?.planCode ?? "monthly_1m").trim();
    const forceNew =
      req.body?.forceNew === true ||
      String(req.body?.forceNew ?? "")
        .trim()
        .toLowerCase() === "true";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const result = await renewSubscriptionCheckout({
      userId,
      planCode,
      forceNew,
    });
    if (!result.ok) {
      const status = result.reason === "plan_not_found" ? 404 : 409;
      res.status(status).json({
        error: "cannot create renewal checkout",
        ...result,
      });
      return;
    }

    res.status(200).json({
      intent: "renewal",
      ...result,
    });
  } catch (err) {
    console.error("Renew subscription checkout error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

export {
  handleWayForPayWebhook,
  handleCreateCheckout,
  handleCreateSubscriptionCheckout,
  handleRenewSubscriptionCheckout,
  handleRecoverSubscriptionCheckout,
  handleRecreateSubscriptionCheckout,
  handleGetSubscriptionStatus,
  parseWebhookBody,
};
