/**
 * Зведення subscription_payment_orders: order_reference, тип (recurring / one_time), статус.
 *
 *   npx ts-node debug/payments/list-subscription-payment-orders.ts
 *   npx ts-node debug/payments/list-subscription-payment-orders.ts 50
 *
 * Для recurring-рядків (plan `subscription_auto` або `monthly_1m`) додатково викликає
 * WayForPay regularApi STATUS, якщо задано WFP_MERCHANT_PASSWORD.
 */
import "dotenv/config";
import { literal, Op } from "sequelize";
import { SubscriptionPaymentOrder } from "../../database/SubscriptionPaymentOrder";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { sequelize } from "../../database/db";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";
import { getWayforpayRegularPaymentStatus } from "../../payment/wayforpay-regular-api";
import { isMultimaskingRecurringPlanCode } from "../../payment/subscription-plan-codes";

type OrderType = "recurring" | "one_time";

type RowSummary = {
  orderReference: string;
  userId: string;
  planCode: string;
  orderType: OrderType;
  dbStatus: string;
  amount: string;
  terminalAt: string | null;
  createdAt: string;
  wayforpayRegularStatus: string | null;
  wayforpayRegularMode: string | null;
  wayforpayNextPayment: string | null;
  statusOrderReference: string | null;
};

function parseLimit(): number | null {
  const arg = process.argv[2]?.trim();
  if (!arg) return null;
  if (/^\d+$/.test(arg)) {
    return Math.min(500, Math.max(1, parseInt(arg, 10)));
  }
  return null;
}

function isRecurringPlanCode(planCode: string): boolean {
  return isMultimaskingRecurringPlanCode(planCode);
}

function formatWayforpayDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

async function resolveWayforpayRegularStatus(args: {
  orderReference: string;
  userId: string;
  planId: number;
  anchorByUserPlan: Map<string, string>;
}): Promise<
  Pick<
    RowSummary,
    "wayforpayRegularStatus" | "wayforpayRegularMode" | "wayforpayNextPayment" | "statusOrderReference"
  >
> {
  const empty = {
    wayforpayRegularStatus: null,
    wayforpayRegularMode: null,
    wayforpayNextPayment: null,
    statusOrderReference: null,
  };

  if (!getWayforpayMerchantPassword()) {
    return {
      ...empty,
      wayforpayRegularStatus: "(WFP_MERCHANT_PASSWORD not set)",
    };
  }

  const anchor =
    args.anchorByUserPlan.get(`${args.userId}:${args.planId}`)?.trim() ||
    args.orderReference;

  try {
    const status = await getWayforpayRegularPaymentStatus(anchor);
    return {
      statusOrderReference: anchor,
      wayforpayRegularStatus: status.status ?? null,
      wayforpayRegularMode: status.mode ?? null,
      wayforpayNextPayment: formatWayforpayDate(status.nextPaymentDate),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusOrderReference: anchor,
      wayforpayRegularStatus: `error: ${message.slice(0, 120)}`,
      wayforpayRegularMode: null,
      wayforpayNextPayment: null,
    };
  }
}

function formatOrderCreatedAt(order: SubscriptionPaymentOrder): string {
  const raw = order.createdAt ?? order.get("created_at");
  if (raw instanceof Date) return raw.toISOString();
  if (raw != null && raw !== "") return String(raw);
  return "—";
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const cfg = sequelize.config;
  console.log(`DB: ${cfg.database} @ ${cfg.host}:${cfg.port}\n`);

  const limit = parseLimit();

  const [orders, plans, autoRenews] = await Promise.all([
    SubscriptionPaymentOrder.findAll({
      order: literal('"created_at" DESC'),
      ...(limit ? { limit } : {}),
    }),
    SubscriptionPlan.findAll({ attributes: ["id", "code"] }),
    SubscriptionAuto.findAll({
      attributes: ["userId", "planId", "anchorOrderReference"],
      where: { anchorOrderReference: { [Op.not]: null } },
    }),
  ]);

  const planCodeById = new Map(plans.map((p) => [p.id, p.code]));
  const anchorByUserPlan = new Map<string, string>();
  for (const row of autoRenews) {
    const ref = row.anchorOrderReference?.trim();
    if (ref) {
      anchorByUserPlan.set(`${row.userId}:${row.planId}`, ref);
    }
  }

  const summaries: RowSummary[] = [];

  for (const order of orders) {
    const planCode = planCodeById.get(order.planId) ?? `(plan_id=${order.planId})`;
    const orderType: OrderType = isRecurringPlanCode(planCode) ? "recurring" : "one_time";

    const base: RowSummary = {
      orderReference: order.orderReference,
      userId: order.userId,
      planCode,
      orderType,
      dbStatus: order.status,
      amount: String(order.amount),
      terminalAt: order.terminalAt?.toISOString() ?? null,
      createdAt: formatOrderCreatedAt(order),
      wayforpayRegularStatus: null,
      wayforpayRegularMode: null,
      wayforpayNextPayment: null,
      statusOrderReference: null,
    };

    if (orderType === "recurring") {
      const wfp = await resolveWayforpayRegularStatus({
        orderReference: order.orderReference,
        userId: order.userId,
        planId: order.planId,
        anchorByUserPlan,
      });
      summaries.push({ ...base, ...wfp });
    } else {
      summaries.push(base);
    }
  }

  const total = await SubscriptionPaymentOrder.count();
  const byDbStatus = new Map<string, number>();
  const byOrderType = new Map<OrderType, number>();

  for (const row of summaries) {
    byDbStatus.set(row.dbStatus, (byDbStatus.get(row.dbStatus) ?? 0) + 1);
    byOrderType.set(row.orderType, (byOrderType.get(row.orderType) ?? 0) + 1);
  }

  console.log("=== Summary ===");
  console.log({
    total_in_table: total,
    shown: summaries.length,
    by_order_type: Object.fromEntries(byOrderType),
    by_db_status: Object.fromEntries(byDbStatus),
  });
  console.log("");

  console.log("=== Orders ===\n");
  for (const row of summaries) {
    console.log({
      order_reference: row.orderReference,
      order_type: row.orderType,
      db_status: row.dbStatus,
      plan_code: row.planCode,
      user_id: row.userId,
      amount_uah: row.amount,
      ...(row.orderType === "recurring"
        ? {
            wayforpay_regular_status: row.wayforpayRegularStatus,
            wayforpay_mode: row.wayforpayRegularMode,
            wayforpay_next_payment: row.wayforpayNextPayment,
            status_order_reference: row.statusOrderReference,
          }
        : {}),
      terminal_at: row.terminalAt,
      created_at: row.createdAt,
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
