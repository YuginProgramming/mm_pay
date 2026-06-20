import { Op } from "sequelize";
import { getPaidChatAccessDays } from "../database/app-settings-queries";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { getSubscriptionAutoAccessDays } from "./subscription-auto-settings";
import {
  isMultimaskingRecurringPlanCode,
  isMonthlySubscriptionPlanCode,
  isYearlySubscriptionPlanCode,
  MONTHLY_SUBSCRIPTION_PLAN_CODE,
  SUBSCRIPTION_AUTO_PLAN_CODE,
  YEARLY_SUBSCRIPTION_PLAN_CODE,
} from "./subscription-plan-codes";
import { getYearlySubscriptionAccessDays } from "./yearly-subscription-settings";
import {
  processApprovedMultimaskingPayment,
  type MultimaskingGrantOptions,
} from "./grant-multimasking-access";
import { reconcileUserSubscriptionFromRecurringWebhook } from "./subscription-webhook-resolver";
import { getWayforpayRegularPaymentStatus } from "./wayforpay-regular-api";
import { getWayforpayMerchantPassword } from "./payment.config";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";

export {
  isMultimaskingRecurringPlanCode,
  isSubscriptionAutoPlanCode,
} from "./subscription-plan-codes";

async function resolveRecurringAccessDays(planCode: string): Promise<number> {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return getPaidChatAccessDays();
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return getYearlySubscriptionAccessDays();
  }
  return getSubscriptionAutoAccessDays();
}

function resolveDefaultWayforpayMode(planCode: string): string | null {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return "monthly";
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return "yearly";
  }
  return null;
}

function buildSubscriptionStateLabel(planCode: string, accessDays: number): string {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return `Щомісячна підписка · ${accessDays} дн.`;
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return `Річна підписка · ${accessDays} дн.`;
  }
  return `Автопродовження · ${accessDays} дн.`;
}

function buildRenewalIntroUa(planCode: string): string {
  if (planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE) {
    return "Повторне щомісячне списання: успіх.\n\n";
  }
  if (planCode === YEARLY_SUBSCRIPTION_PLAN_CODE) {
    return "Повторне річне списання: успіх.\n\n";
  }
  return "Повторне списання (автопродовження): успіх.\n\n";
}

function usesStandardMultimaskingSuccessMessage(planCode: string): boolean {
  return isMonthlySubscriptionPlanCode(planCode) || isYearlySubscriptionPlanCode(planCode);
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

async function fetchWayforpayRegularSnapshot(
  anchorOrderReference: string,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<{
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

  const retries = Math.max(1, options?.retries ?? 3);
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 2000);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const status = await getWayforpayRegularPaymentStatus(anchorOrderReference);
      const snapshot = {
        wayforpayStatus: status.status ?? null,
        wayforpayMode: status.mode ?? null,
        nextChargeAt: parseWayforpayTimestamp(status.nextPaymentDate),
      };
      if (
        snapshot.wayforpayStatus != null ||
        snapshot.wayforpayMode != null ||
        snapshot.nextChargeAt != null ||
        attempt === retries
      ) {
        return snapshot;
      }
    } catch (err) {
      console.error("[subscription-auto] STATUS failed:", err);
      if (attempt === retries) {
        return empty;
      }
    }

    if (attempt < retries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return empty;
}

function resolveWayforpayFieldsAfterApproved(args: {
  wfp: {
    wayforpayStatus: string | null;
    wayforpayMode: string | null;
    nextChargeAt: Date | null;
  };
  planCode: string;
  existing: SubscriptionAuto | null;
}): {
  wayforpayStatus: string | null;
  wayforpayMode: string | null;
  nextChargeAt: Date | null;
} {
  const defaultMode = resolveDefaultWayforpayMode(args.planCode);

  return {
    wayforpayStatus:
      args.wfp.wayforpayStatus ??
      args.existing?.wayforpayStatus ??
      "Active",
    wayforpayMode:
      args.wfp.wayforpayMode ?? args.existing?.wayforpayMode ?? defaultMode,
    nextChargeAt: args.wfp.nextChargeAt ?? args.existing?.nextChargeAt ?? null,
  };
}

async function buildRecurringDiagnosticMessageUa(args: {
  planCode: string;
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

  const intro =
    args.planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE
      ? "Щомісячна підписка WayForPay: оплату зафіксовано.\n\n"
      : args.planCode === YEARLY_SUBSCRIPTION_PLAN_CODE
        ? "Річна підписка WayForPay: оплату зафіксовано.\n\n"
        : "Автопродовження WayForPay: оплату зафіксовано.\n\n";

  return (
    intro +
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

  const anchorOrderReference =
    existing?.anchorOrderReference?.trim() || args.orderReference;
  const isRenewal = Boolean(
    existing &&
      (existing.anchorOrderReference?.trim() || "") !== args.orderReference.trim(),
  );

  const plan = await SubscriptionPlan.findByPk(args.planId, { attributes: ["code"] });
  const planCode = plan?.code ?? SUBSCRIPTION_AUTO_PLAN_CODE;

  const wfp = await fetchWayforpayRegularSnapshot(anchorOrderReference);
  const resolved = resolveWayforpayFieldsAfterApproved({
    wfp,
    planCode,
    existing,
  });
  const now = new Date();

  if (existing) {
    await existing.update({
      latestOrderReference: args.orderReference,
      paymentToken: args.recToken ?? existing.paymentToken,
      autoRenewEnabled: true,
      lastChargeStatus: "Approved",
      lastChargeAt: now,
      nextChargeAt: resolved.nextChargeAt,
      wayforpayStatus: resolved.wayforpayStatus,
      wayforpayMode: resolved.wayforpayMode,
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
    nextChargeAt: resolved.nextChargeAt,
    wayforpayStatus: resolved.wayforpayStatus,
    wayforpayMode: resolved.wayforpayMode,
    lastChargeStatus: "Approved",
    lastChargeAt: now,
    cancelledAt: null,
  });

  return { anchorOrderReference: args.orderReference, isRenewal: false };
}

export type RecurringApprovedPaymentContext = {
  userId: string;
  planId: number;
  orderReference: string;
};

function formatEndDateUk(end: Date): string {
  return end.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Kyiv",
  });
}

async function resolveRecurringAutoForRenewalWebhook(
  orderReference: string,
  userId: string,
): Promise<SubscriptionAuto | null> {
  const byRef = await SubscriptionAuto.findOne({
    where: {
      [Op.or]: [
        { anchorOrderReference: orderReference },
        { latestOrderReference: orderReference },
      ],
    },
  });
  if (byRef) {
    return byRef.userId === userId ? byRef : null;
  }

  const autos = await SubscriptionAuto.findAll({ where: { userId } });
  for (const row of autos) {
    const plan = await SubscriptionPlan.findByPk(row.planId, { attributes: ["code"] });
    if (!isMultimaskingRecurringPlanCode(plan?.code)) continue;
    if (row.cancelledAt != null) continue;
    const anchor = row.anchorOrderReference?.trim() || "";
    if (anchor && anchor !== orderReference) {
      return row;
    }
  }

  return null;
}

/**
 * Renewal webhook без рядка в `subscription_payment_orders` (новий orderReference від WayForPay).
 */
export async function tryHandleMultimaskingRecurringRenewalWebhook(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
): Promise<boolean> {
  const orderReference = payload.orderReference.trim();
  const userId = metadata.chatId.trim();

  const auto = await resolveRecurringAutoForRenewalWebhook(orderReference, userId);
  if (!auto) {
    return false;
  }

  await handleSubscriptionAutoApprovedPayment(payload, metadata, {
    userId: auto.userId,
    planId: auto.planId,
    orderReference,
  });
  return true;
}

/**
 * Після reconcile subscription order (або renewal ctx): grant, upsert subscription_auto, DM.
 */
export async function handleSubscriptionAutoApprovedPayment(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
  ctx: RecurringApprovedPaymentContext,
): Promise<void> {
  const { userId, planId, orderReference } = ctx;
  const plan = await SubscriptionPlan.findByPk(planId, { attributes: ["code"] });
  const planCode = plan?.code ?? SUBSCRIPTION_AUTO_PLAN_CODE;
  const accessDays = await resolveRecurringAccessDays(planCode);
  const recToken = parseRecToken(payload);

  const { anchorOrderReference, isRenewal } = await upsertSubscriptionAutoFromPayment({
    userId,
    planId,
    orderReference,
    recToken,
  });

  const wfp = await fetchWayforpayRegularSnapshot(anchorOrderReference);

  const subscriptionStateLabel = buildSubscriptionStateLabel(planCode, accessDays);

  const grantOptions: MultimaskingGrantOptions = {
    accessDays,
    subscriptionStateLabel,
    renewalExtendFromActiveGrant: isRenewal,
    ...(isRenewal
      ? { skipSuccessMessage: true }
      : usesStandardMultimaskingSuccessMessage(planCode)
        ? {}
        : {
            successMessageText: await buildRecurringDiagnosticMessageUa({
              planCode,
              orderReference,
              recToken,
              anchorOrderReference,
              wayforpayStatus: wfp.wayforpayStatus,
              wayforpayMode: wfp.wayforpayMode,
              nextChargeAt: wfp.nextChargeAt,
              accessDays,
            }),
          }),
  };

  const grantResult = await processApprovedMultimaskingPayment(
    payload,
    metadata,
    grantOptions,
  );

  if (grantResult.granted) {
    try {
      const mirrored = await reconcileUserSubscriptionFromRecurringWebhook({
        userId,
        planId,
        orderReference,
      });
      if (mirrored) {
        console.log("[subscription-auto] user_subscriptions mirrored", {
          userId,
          planId,
          orderReference,
          isRenewal,
        });
      }
    } catch (mirrorErr) {
      console.error("[subscription-auto] user_subscriptions mirror failed:", mirrorErr);
    }
  }

  if (isRenewal && grantResult.granted) {
    const endLine = grantResult.grantEndAt
      ? ` (до ${formatEndDateUk(grantResult.grantEndAt)})`
      : "";
    const renewalIntro = buildRenewalIntroUa(planCode);
    await sendTelegramBotMessage(
      metadata.chatId.trim(),
      renewalIntro +
        `orderReference: ${payload.orderReference}\n` +
        `Доступ продовжено на ${accessDays} дн.${endLine}`,
    );
  }

  console.log("[subscription-auto] approved webhook handled", {
    planCode,
    orderReference,
    userId,
    recToken: Boolean(recToken),
    isRenewal,
    anchorOrderReference,
    wayforpayStatus: wfp.wayforpayStatus,
    granted: grantResult.granted,
  });
}
