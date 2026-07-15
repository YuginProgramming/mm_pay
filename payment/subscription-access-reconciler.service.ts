import { Op } from "sequelize";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { extendRecurringMultimaskingAccess } from "./extend-recurring-access";
import { getWayforpayMerchantPassword } from "./payment.config";
import { getWayforpayRegularPaymentStatus } from "./wayforpay-regular-api";
import { isMultimaskingRecurringPlanCode } from "./subscription-plan-codes";

export type SubscriptionAccessReconcileResult = {
  checked: number;
  extended: number;
  skipped: number;
  errors: string[];
};

/** Мінімальний інтервал (мс), на який `lastPayedDate` має бути новішим за high-water mark. */
const RECONCILE_EPSILON_MS = 60_000;

/**
 * "Lite iterations": опитуємо WayForPay STATUS лише для підписок, у яких списання
 * реально настало. Тобто `next_charge_at IS NULL` (дата ще невідома) АБО
 * `next_charge_at <= now + POLL_WINDOW`. Решту пропускаємо БЕЗ виклику API,
 * що для місячної підписки дає ~0 запитів більшість місяця (TZ/update-access.md §5).
 */
const RECONCILE_POLL_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseWayforpayEpoch(value: unknown): Date | null {
  if (value == null || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return new Date(n > 1e12 ? n : n * 1000);
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a == null) return b;
  if (b == null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReconcileOutcome = "extended" | "skipped";

async function reconcileOneSubscription(
  row: SubscriptionAuto,
  apply: boolean,
): Promise<ReconcileOutcome> {
  const plan = await SubscriptionPlan.findByPk(row.planId, { attributes: ["code"] });
  if (!isMultimaskingRecurringPlanCode(plan?.code)) {
    return "skipped";
  }

  const anchor = row.anchorOrderReference?.trim();
  if (!anchor) {
    return "skipped";
  }

  const status = await getWayforpayRegularPaymentStatus(anchor);

  if (status.status !== "Active") {
    return "skipped";
  }
  if (status.lastPayedStatus !== "Approved") {
    return "skipped";
  }

  const lastPayed = parseWayforpayEpoch(status.lastPayedDate);
  if (lastPayed == null) {
    return "skipped";
  }

  // High-water mark: webhook (last_charge_at) або попередній reconciler-прогін.
  const highWater = maxDate(row.lastChargeAt ?? null, row.lastReconciledPayedAt ?? null);
  if (
    highWater != null &&
    lastPayed.getTime() <= highWater.getTime() + RECONCILE_EPSILON_MS
  ) {
    return "skipped";
  }

  const lastPayedEpochSeconds = Math.floor(lastPayed.getTime() / 1000);
  const syntheticOrderReference = `reg-${anchor}-${lastPayedEpochSeconds}`;

  const alreadyGranted = await ContactProductAccess.findOne({
    where: { wayforpayOrderReference: syntheticOrderReference },
  });
  if (alreadyGranted) {
    return "skipped";
  }

  if (!apply) {
    console.log("[access-reconciler] would extend (dry-run)", {
      autoId: row.id,
      userId: row.userId,
      planId: row.planId,
      anchor,
      syntheticOrderReference,
      lastPayed: lastPayed.toISOString(),
    });
    return "extended";
  }

  const grant = await extendRecurringMultimaskingAccess({
    userId: row.userId,
    planId: row.planId,
    orderReference: syntheticOrderReference,
    amount: status.amount ?? 0,
    currency: status.currency ?? "UAH",
    source: "reconciler",
  });

  if (!grant.granted) {
    console.warn("[access-reconciler] grant refused", {
      autoId: row.id,
      userId: row.userId,
      syntheticOrderReference,
    });
    return "skipped";
  }

  await row.update({
    lastReconciledPayedAt: lastPayed,
    nextChargeAt: parseWayforpayEpoch(status.nextPaymentDate) ?? row.nextChargeAt,
    wayforpayStatus: status.status ?? row.wayforpayStatus,
    wayforpayMode: status.mode ?? row.wayforpayMode,
  });

  console.log("[access-reconciler] extended", {
    autoId: row.id,
    userId: row.userId,
    planId: row.planId,
    syntheticOrderReference,
    grantEndAt: grant.grantEndAt?.toISOString() ?? null,
  });

  return "extended";
}

/**
 * Один прогін reconciler: опитати WayForPay STATUS по активних recurring-підписках і
 * продовжити доступ, якщо було пропущене успішне списання (TZ/update-access.md §5-§7).
 * `apply: false` — dry-run (нічого не пише).
 */
export async function runSubscriptionAccessReconcileOnce(opts: {
  apply: boolean;
  delayMs?: number;
}): Promise<SubscriptionAccessReconcileResult> {
  const result: SubscriptionAccessReconcileResult = {
    checked: 0,
    extended: 0,
    skipped: 0,
    errors: [],
  };

  if (!getWayforpayMerchantPassword()) {
    console.warn(
      "[access-reconciler] WFP_MERCHANT_PASSWORD not set — skip (немає доступу до regularApi STATUS)",
    );
    return result;
  }

  const dueThreshold = new Date(Date.now() + RECONCILE_POLL_WINDOW_MS);
  const rows = await SubscriptionAuto.findAll({
    where: {
      autoRenewEnabled: true,
      cancelledAt: null,
      [Op.or]: [{ nextChargeAt: null }, { nextChargeAt: { [Op.lte]: dueThreshold } }],
    },
  });

  const delayMs = opts.delayMs && opts.delayMs > 0 ? opts.delayMs : 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    result.checked += 1;
    try {
      const outcome = await reconcileOneSubscription(row, opts.apply);
      if (outcome === "extended") {
        result.extended += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`auto#${row.id}: ${message.slice(0, 200)}`);
      console.error("[access-reconciler] row error", { autoId: row.id, message });
    }

    // Пауза між зверненнями до WayForPay STATUS (не після останнього рядка).
    if (delayMs > 0 && i < rows.length - 1) {
      await sleep(delayMs);
    }
  }

  return result;
}
