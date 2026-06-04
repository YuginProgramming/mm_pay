import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { YearlyAutoRenewSubscription } from "../database/YearlyAutoRenewSubscription";
import {
  getYearlySubscriptionTestPeriodDays,
  YEARLY_SUBSCRIPTION_TEST_PLAN_CODE,
} from "./yearly-subscription-test-settings";
import {
  processApprovedMultimaskingPayment,
  type MultimaskingGrantOptions,
} from "./grant-multimasking-access";
import { getWayforpayRegularPaymentStatus } from "./wayforpay-regular-api";
import { getWayforpayMerchantPassword } from "./payment.config";
import type { PaymentMetadata, WayForPayWebhookPayload } from "./payment.types";
import { sendTelegramBotMessage } from "./telegram-notify";

export function isTestAutoSubscriptionPlanCode(planCode: string | null | undefined): boolean {
  return planCode === YEARLY_SUBSCRIPTION_TEST_PLAN_CODE;
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

async function buildTestAutoDiagnosticMessage(args: {
  orderReference: string;
  recToken: string | null;
  statusOrderReference: string;
}): Promise<string> {
  const recLine = args.recToken ? "так" : "ні";

  let statusBlock = "STATUS: не викликано (немає WFP_MERCHANT_PASSWORD у env).";
  if (getWayforpayMerchantPassword()) {
    try {
      const status = await getWayforpayRegularPaymentStatus(args.statusOrderReference);
      statusBlock =
        `STATUS: ${status.status ?? "—"}\n` +
        `Наступне списання: ${formatStatusTimestamp(status.nextPaymentDate)}\n` +
        `Режим: ${status.mode ?? "—"}`;
    } catch (err) {
      console.error("[testauto] STATUS failed:", err);
      statusBlock = "STATUS: помилка виклику (див. логи сервера).";
    }
  }

  return (
    "Тест автопродовження: оплату зафіксовано.\n\n" +
    `recToken: ${recLine}\n` +
    `orderReference: ${args.orderReference}\n` +
    `${statusBlock}\n\n` +
    "Доступ на 1 день (тест) — перевірте /profile."
  );
}

async function upsertYearlyAutoRenewFromTestPayment(args: {
  userId: string;
  planId: number;
  orderReference: string;
  recToken: string | null;
}): Promise<{ statusOrderReference: string; isRenewal: boolean }> {
  const existing = await YearlyAutoRenewSubscription.findOne({
    where: { userId: args.userId, planId: args.planId },
  });

  const isRenewal = Boolean(existing?.wayforpayRecurringOrderReference);

  const statusOrderReference =
    existing?.wayforpayRecurringOrderReference?.trim() || args.orderReference;

  let nextChargeAt: Date | null = null;
  if (getWayforpayMerchantPassword()) {
    try {
      const status = await getWayforpayRegularPaymentStatus(statusOrderReference);
      const raw = status.nextPaymentDate;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        nextChargeAt = new Date(raw > 1e12 ? raw : raw * 1000);
      }
    } catch (err) {
      console.error("[testauto] STATUS for next_charge_at failed:", err);
    }
  }

  if (existing) {
    await existing.update({
      paymentToken: args.recToken ?? existing.paymentToken,
      autoRenewEnabled: true,
      lastChargeStatus: "Approved",
      nextChargeAt: nextChargeAt ?? existing.nextChargeAt,
      wayforpayRecurringOrderReference: existing.wayforpayRecurringOrderReference ?? args.orderReference,
    });
    return { statusOrderReference, isRenewal };
  }

  await YearlyAutoRenewSubscription.create({
    userId: args.userId,
    planId: args.planId,
    wayforpayRecurringOrderReference: args.orderReference,
    paymentToken: args.recToken,
    autoRenewEnabled: true,
    nextChargeAt,
    lastChargeStatus: "Approved",
    cancelledAt: null,
  });

  return { statusOrderReference: args.orderReference, isRenewal: false };
}

/**
 * After subscription ledger reconcile: grant 1d access, store recToken, diagnostic DM.
 */
export async function handleTestAutoApprovedPayment(
  payload: WayForPayWebhookPayload,
  metadata: PaymentMetadata,
  order: SubscriptionPaymentOrder,
  planId: number,
): Promise<void> {
  const accessDays = await getYearlySubscriptionTestPeriodDays();
  const recToken = parseRecToken(payload);

  const { statusOrderReference, isRenewal } = await upsertYearlyAutoRenewFromTestPayment({
    userId: order.userId,
    planId,
    orderReference: order.orderReference,
    recToken,
  });

  const grantOptions: MultimaskingGrantOptions = {
    accessDays,
    successMessageText: await buildTestAutoDiagnosticMessage({
      orderReference: order.orderReference,
      recToken,
      statusOrderReference,
    }),
  };

  await processApprovedMultimaskingPayment(payload, metadata, grantOptions);

  if (isRenewal) {
    await sendTelegramBotMessage(
      metadata.chatId.trim(),
      "Тестове повторне списання: успіх.\n\n" +
        `orderReference: ${payload.orderReference}\n` +
        `Доступ продовжено на ${accessDays} дн. (тест).`,
    );
  }

  console.log("[testauto] approved webhook handled", {
    orderReference: order.orderReference,
    userId: order.userId,
    recToken: Boolean(recToken),
    isRenewal,
    statusOrderReference,
  });
}
