import { Op } from "sequelize";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { extendRecurringMultimaskingAccess } from "./extend-recurring-access";
import { getWayforpayMerchantPassword } from "./payment.config";
import {
  getWayforpayRegularPaymentStatus,
  type WayforpayRegularStatusResponse,
} from "./wayforpay-regular-api";
import { isMultimaskingRecurringPlanCode } from "./subscription-plan-codes";

export type SubscriptionAccessExtension = {
  userId: string;
  /** Groups Multimasking `payment_hook.end_at` — target for KWIGA exact end-date step. */
  targetEndAt: Date;
};

export type SubscriptionAccessReconcileResult = {
  checked: number;
  extended: number;
  skipped: number;
  errors: string[];
  /** Successfully applied group extends in this run (for KWIGA follow-up). Empty on dry-run. */
  extensions: SubscriptionAccessExtension[];
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

type ReconcileOutcome =
  | { kind: "skipped" }
  | { kind: "extended"; userId: string; grantEndAt: Date | null };

function uniqueRegularStatusRefs(row: SubscriptionAuto): string[] {
  const refs: string[] = [];
  const anchor = row.anchorOrderReference?.trim();
  const latest = row.latestOrderReference?.trim();
  if (anchor) {
    refs.push(anchor);
  }
  if (latest && latest !== anchor) {
    refs.push(latest);
  }
  return refs;
}

function pickReconcileCharge(
  polled: Array<{ ref: string; status: WayforpayRegularStatusResponse }>,
  highWater: Date | null,
): { ref: string; status: WayforpayRegularStatusResponse; lastPayed: Date } | null {
  let best: { ref: string; status: WayforpayRegularStatusResponse; lastPayed: Date } | null =
    null;

  for (const item of polled) {
    if (item.status.status !== "Active") {
      continue;
    }
    if (item.status.lastPayedStatus !== "Approved") {
      continue;
    }
    const lastPayed = parseWayforpayEpoch(item.status.lastPayedDate);
    if (lastPayed == null) {
      continue;
    }
    if (
      highWater != null &&
      lastPayed.getTime() <= highWater.getTime() + RECONCILE_EPSILON_MS
    ) {
      continue;
    }
    if (best == null || lastPayed.getTime() > best.lastPayed.getTime()) {
      best = { ref: item.ref, status: item.status, lastPayed };
    }
  }

  return best;
}

async function reconcileOneSubscription(
  row: SubscriptionAuto,
  apply: boolean,
): Promise<ReconcileOutcome> {
  const plan = await SubscriptionPlan.findByPk(row.planId, { attributes: ["code"] });
  if (!isMultimaskingRecurringPlanCode(plan?.code)) {
    return { kind: "skipped" };
  }

  const refs = uniqueRegularStatusRefs(row);
  if (refs.length === 0) {
    return { kind: "skipped" };
  }

  const polled: Array<{ ref: string; status: WayforpayRegularStatusResponse }> = [];
  let lastError: unknown = null;
  for (const ref of refs) {
    try {
      const status = await getWayforpayRegularPaymentStatus(ref);
      polled.push({ ref, status });
    } catch (err) {
      lastError = err;
    }
  }
  if (polled.length === 0) {
    if (lastError != null) {
      throw lastError;
    }
    return { kind: "skipped" };
  }

  const highWater = maxDate(row.lastChargeAt ?? null, row.lastReconciledPayedAt ?? null);
  const charge = pickReconcileCharge(polled, highWater);
  if (charge == null) {
    return { kind: "skipped" };
  }

  const lastPayedEpochSeconds = Math.floor(charge.lastPayed.getTime() / 1000);
  const syntheticOrderReference = `reg-${charge.ref}-${lastPayedEpochSeconds}`;

  const alreadyGranted = await ContactProductAccess.findOne({
    where: {
      [Op.or]: [
        { wayforpayOrderReference: syntheticOrderReference },
        { wayforpayOrderReference: { [Op.like]: `${charge.ref}_WFPREG-%` } },
      ],
    },
  });
  if (alreadyGranted) {
    return { kind: "skipped" };
  }

  if (!apply) {
    console.log("[access-reconciler] would extend (dry-run)", {
      autoId: row.id,
      userId: row.userId,
      planId: row.planId,
      statusRef: charge.ref,
      syntheticOrderReference,
      lastPayed: charge.lastPayed.toISOString(),
    });
    return { kind: "extended", userId: row.userId, grantEndAt: null };
  }

  const grant = await extendRecurringMultimaskingAccess({
    userId: row.userId,
    planId: row.planId,
    orderReference: syntheticOrderReference,
    amount: charge.status.amount ?? 0,
    currency: charge.status.currency ?? "UAH",
    source: "reconciler",
  });

  if (!grant.granted) {
    console.warn("[access-reconciler] grant refused", {
      autoId: row.id,
      userId: row.userId,
      syntheticOrderReference,
    });
    return { kind: "skipped" };
  }

  await row.update({
    lastReconciledPayedAt: charge.lastPayed,
    nextChargeAt: parseWayforpayEpoch(charge.status.nextPaymentDate) ?? row.nextChargeAt,
    wayforpayStatus: charge.status.status ?? row.wayforpayStatus,
    wayforpayMode: charge.status.mode ?? row.wayforpayMode,
  });

  console.log("[access-reconciler] extended", {
    autoId: row.id,
    userId: row.userId,
    planId: row.planId,
    syntheticOrderReference,
    grantEndAt: grant.grantEndAt?.toISOString() ?? null,
  });

  return {
    kind: "extended",
    userId: row.userId,
    grantEndAt: grant.grantEndAt ?? null,
  };
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
    extensions: [],
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
      if (outcome.kind === "extended") {
        result.extended += 1;
        if (opts.apply && outcome.grantEndAt != null) {
          result.extensions.push({
            userId: outcome.userId,
            targetEndAt: outcome.grantEndAt,
          });
        }
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
