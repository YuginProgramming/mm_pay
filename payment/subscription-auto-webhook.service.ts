import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import {
  getSubscriptionAutoAccessDays,
  SUBSCRIPTION_AUTO_PLAN_CODE,
} from "./subscription-auto-settings";
import {
  processApprovedMultimaskingPayment,
  type MultimaskingGrantOptions,
} from "./grant-multimasking-access";
import { getWayforpayRegularPaymentStatus } from "./wayforpay-regular-api";
import { getWayforpayMerchantPassword } from "./payment.config";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";

export function isSubscriptionAutoPlanCode(planCode: string | null | undefined): boolean {
  return planCode === SUBSCRIPTION_AUTO_PLAN_CODE;
}

function parseRecToken(payload: WayForPayWebhookPayload): string | null {
  const raw = payload.recToken;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatStatusTimestamp(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
  }
  return String(value);
}

function parseWayforpayTimestamp(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  return null;
}

async function fetchWayforpayRegularSnapshot(anchorOrderReference: string): Promise<{
  wayforpayStatus: string | null;
  wayforpayMode: string | null;
  nextChargeAt: Date | null;
}> {
  const empty = {
    wayforpayStatus: null,
    wayforpayMode: null,
    nextChargeAt: null,
  };

  if (!getWayforpayMerchantPassword()) {
    return empty;
  }

  try {
    const status = await getWayforpayRegularPaymentStatus(anchorOrderReference);
    return {
      wayforpayStatus: status.status ?? null,
      wayforpayMode: status.mode ?? null,
      nextChargeAt: parseWayforpayTimestamp(status.nextPaymentDate),
    };
  } catch (err) {
    console.error("[subscription-auto] STATUS failed:", err);
    return empty;
  }
}

async function buildSubscriptionAutoDiagnosticMessage(args: {
  orderReference: string;
  recToken: string | null;
  anchorOrderReference: string;
  wayforpayStatus: string | null;
  wayforpayMode: string | null;
  nextChargeAt: Date | null;
  accessDays: number;
}): Promise<string> {
  const recLine = args.recToken ? "так" : "ні";
  const statusLine = args.wayforpayStatus ?? "—";
  const modeLine = args.wayforpayMode ?? "—";
  const nextLine = args.nextChargeAt
    ? args.nextChargeAt.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })
    : "—";

  let statusBlock = `STATUS: ${statusLine}\nРежим: ${modeLine}\nНаступне списання: ${nextLine}`;
  if (!getWayforpayMerchantPassword()) {
    statusBlock = "STATUS: не викликано (немає WFP_MERCHANT_PASSWORD у env).";
  }

  return (
    "Автопродовження WayForPay: оплату зафіксовано.\n\n" +
    `recToken: ${recLine}\n` +
    `orderReference: ${args.orderReference}\n` +
    `anchor (STATUS): ${args.anchorOrderReference}\n` +
    `${statusBlock}\n\n` +
    `Доступ на ${args.accessDays} дн. — перевірте /profile.`
  );
}

async function upsertSubscriptionAutoFromPayment(args: {
  userId: string;
  planId: number;
  orderReference: string;
  recToken: string | null;
}): Promise<{ anchorOrderReference: string; isRenewal: boolean }> {
  const existing = await SubscriptionAuto.findOne({
    where: { userId: args.userId, planId: args.planId },
  });

  const isRenewal = Boolean(existing?.anchorOrderReference);
  const anchorOrderReference =
    existing?.anchorOrderReference?.trim() || args.orderReference;

  const wfp = await fetchWayforpayRegularSnapshot(anchorOrderReference);
  const now = new Date();

  if (existing) {
    await existing.update({
      latestOrderReference: args.orderReference,
      paymentToken: args.recToken ?? existing.paymentToken,
      autoRenewEnabled: true,
      lastChargeStatus: "Approved",
      lastChargeAt: now,
      nextChargeAt: wfp.nextChargeAt ?? existing.nextChargeAt,
      wayforpayStatus: wfp.wayforpayStatus ?? existing.wayforpayStatus,
      wayforpayMode: wfp.wayforpayMode ?? existing.wayforpayMode,
      anchorOrderReference: existing.anchorOrderReference ?? args.orderReference,
      cancelledAt: null,
    });
    return { anchorOrderReference, isRenewal };
  }

  await SubscriptionAuto.create({
    userId: args.userId,
    planId: args.planId,
    anchorOrderReference: args.orderReference,
    latestOrderReference: args.orderReference,
    paymentToken: args.recToken,
    autoRenewEnabled: true,
    nextChargeAt: wfp.nextChargeAt,
    wayforpayStatus: wfp.wayforpayStatus,
    wayforpayMode: wfp.wayforpayMode,
    lastChargeStatus: "Approved",
    lastChargeAt: now,
    cancelledAt: null,
  });

  return { anchorOrderReference: args.orderReference, isRenewal: false };
}

/**
 * Після reconcile subscription order: grant access, upsert subscription_auto, diagnostic DM.
 */
export async function handleSubscriptionAutoApprovedPayment(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
  order: SubscriptionPaymentOrder,
  planId: number,
): Promise<void> {
  const accessDays = await getSubscriptionAutoAccessDays();
  const recToken = parseRecToken(payload);

  const { anchorOrderReference, isRenewal } = await upsertSubscriptionAutoFromPayment({
    userId: order.userId,
    planId,
    orderReference: order.orderReference,
    recToken,
  });

  const wfp = await fetchWayforpayRegularSnapshot(anchorOrderReference);

  const grantOptions: MultimaskingGrantOptions = {
    accessDays,
    successMessageText: await buildSubscriptionAutoDiagnosticMessage({
      orderReference: order.orderReference,
      recToken,
      anchorOrderReference,
      wayforpayStatus: wfp.wayforpayStatus,
      wayforpayMode: wfp.wayforpayMode,
      nextChargeAt: wfp.nextChargeAt,
      accessDays,
    }),
    subscriptionStateLabel: `Автопродовження · ${accessDays} дн.`,
  };

  await processApprovedMultimaskingPayment(payload, metadata, grantOptions);

  if (isRenewal) {
    await sendTelegramBotMessage(
      metadata.chatId.trim(),
      "Повторне списання (автопродовження): успіх.\n\n" +
        `orderReference: ${payload.orderReference}\n` +
        `Доступ продовжено на ${accessDays} дн.`,
    );
  }

  console.log("[subscription-auto] approved webhook handled", {
    orderReference: order.orderReference,
    userId: order.userId,
    recToken: Boolean(recToken),
    isRenewal,
    anchorOrderReference,
    wayforpayStatus: wfp.wayforpayStatus,
  });
}
