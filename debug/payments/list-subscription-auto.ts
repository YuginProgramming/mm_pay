/**
 * Зведення subscription_auto + WayForPay regularApi STATUS.
 *
 *   npx ts-node debug/payments/list-subscription-auto.ts
 *   npx ts-node debug/payments/list-subscription-auto.ts 50
 */
import "dotenv/config";
import { literal } from "sequelize";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { sequelize } from "../../database/db";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";
import { getWayforpayRegularPaymentStatus } from "../../payment/wayforpay-regular-api";

type RowSummary = {
  id: number;
  userId: string;
  planCode: string;
  anchorOrderReference: string | null;
  latestOrderReference: string | null;
  autoRenewEnabled: boolean;
  hasPaymentToken: boolean;
  dbNextChargeAt: string | null;
  dbWayforpayStatus: string | null;
  dbWayforpayMode: string | null;
  dbLastChargeStatus: string | null;
  dbLastChargeAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  liveWayforpayStatus: string | null;
  liveWayforpayMode: string | null;
  liveWayforpayNextPayment: string | null;
  liveWayforpayEmail: string | null;
  liveWayforpayCard: string | null;
};

function parseLimit(): number | null {
  const arg = process.argv[2]?.trim();
  if (!arg) return null;
  if (/^\d+$/.test(arg)) {
    return Math.min(500, Math.max(1, parseInt(arg, 10)));
  }
  return null;
}

function formatWayforpayDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

function formatDbDate(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

async function fetchLiveStatus(anchor: string | null): Promise<
  Pick<
    RowSummary,
    | "liveWayforpayStatus"
    | "liveWayforpayMode"
    | "liveWayforpayNextPayment"
    | "liveWayforpayEmail"
    | "liveWayforpayCard"
  >
> {
  const empty = {
    liveWayforpayStatus: null,
    liveWayforpayMode: null,
    liveWayforpayNextPayment: null,
    liveWayforpayEmail: null,
    liveWayforpayCard: null,
  };

  if (!anchor?.trim()) {
    return { ...empty, liveWayforpayStatus: "(no anchor_order_reference)" };
  }

  if (!getWayforpayMerchantPassword()) {
    return { ...empty, liveWayforpayStatus: "(WFP_MERCHANT_PASSWORD not set)" };
  }

  try {
    const status = await getWayforpayRegularPaymentStatus(anchor.trim());
    return {
      liveWayforpayStatus: status.status ?? null,
      liveWayforpayMode: status.mode ?? null,
      liveWayforpayNextPayment: formatWayforpayDate(status.nextPaymentDate),
      liveWayforpayEmail: status.email ?? null,
      liveWayforpayCard: status.card ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...empty,
      liveWayforpayStatus: `error: ${message.slice(0, 160)}`,
    };
  }
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const cfg = sequelize.config;
  console.log(`DB: ${cfg.database} @ ${cfg.host}:${cfg.port}\n`);

  const limit = parseLimit();

  const [rows, plans] = await Promise.all([
    SubscriptionAuto.findAll({
      order: literal('"created_at" DESC'),
      ...(limit ? { limit } : {}),
    }),
    SubscriptionPlan.findAll({ attributes: ["id", "code"] }),
  ]);

  const planCodeById = new Map(plans.map((p) => [p.id, p.code]));
  const summaries: RowSummary[] = [];

  for (const row of rows) {
    const live = await fetchLiveStatus(row.anchorOrderReference);
    summaries.push({
      id: row.id,
      userId: row.userId,
      planCode: planCodeById.get(row.planId) ?? `(plan_id=${row.planId})`,
      anchorOrderReference: row.anchorOrderReference,
      latestOrderReference: row.latestOrderReference,
      autoRenewEnabled: row.autoRenewEnabled,
      hasPaymentToken: Boolean(row.paymentToken?.trim()),
      dbNextChargeAt: formatDbDate(row.nextChargeAt),
      dbWayforpayStatus: row.wayforpayStatus,
      dbWayforpayMode: row.wayforpayMode,
      dbLastChargeStatus: row.lastChargeStatus,
      dbLastChargeAt: formatDbDate(row.lastChargeAt),
      cancelledAt: formatDbDate(row.cancelledAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...live,
    });
  }

  const total = await SubscriptionAuto.count();

  console.log("=== Summary ===");
  console.log({
    total_in_table: total,
    shown: summaries.length,
    with_anchor_reference: summaries.filter((r) => r.anchorOrderReference).length,
    with_payment_token: summaries.filter((r) => r.hasPaymentToken).length,
    auto_renew_enabled: summaries.filter((r) => r.autoRenewEnabled && !r.cancelledAt).length,
  });
  console.log("");

  if (summaries.length === 0) {
    console.log(
      "Таблиця subscription_auto порожня — /subauto ще не створював автопродовження на цій БД.",
    );
    return;
  }

  console.log("=== subscription_auto ===\n");
  for (const row of summaries) {
    console.log({
      id: row.id,
      user_id: row.userId,
      plan_code: row.planCode,
      anchor_order_reference: row.anchorOrderReference,
      latest_order_reference: row.latestOrderReference,
      auto_renew_enabled: row.autoRenewEnabled,
      has_payment_token: row.hasPaymentToken,
      db_wayforpay_status: row.dbWayforpayStatus,
      db_wayforpay_mode: row.dbWayforpayMode,
      db_next_charge_at: row.dbNextChargeAt,
      db_last_charge_status: row.dbLastChargeStatus,
      db_last_charge_at: row.dbLastChargeAt,
      live_wayforpay_status: row.liveWayforpayStatus,
      live_wayforpay_mode: row.liveWayforpayMode,
      live_wayforpay_next_payment: row.liveWayforpayNextPayment,
      live_wayforpay_email: row.liveWayforpayEmail,
      live_wayforpay_card: row.liveWayforpayCard,
      cancelled_at: row.cancelledAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    });
    console.log("—");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
