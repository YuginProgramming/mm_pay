/**
 * Cancel WayForPay recurring (regularApi REMOVE) and mark subscription_auto cancelled in DB.
 *
 *   npx ts-node debug/payments/cancel-subscription-auto-recurring.ts 6956239629
 *   npx ts-node debug/payments/cancel-subscription-auto-recurring.ts 6956239629 --dry-run
 */
import "dotenv/config";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { sequelize } from "../../database/db";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";
import {
  getWayforpayRegularPaymentStatus,
  removeWayforpayRegularPayment,
} from "../../payment/wayforpay-regular-api";
import { resolveDebugTelegramUserId } from "../telegram/resolve-debug-telegram-id";

function dryRunMode(): boolean {
  return process.argv.includes("--dry-run");
}

function argvIndexForId(): number {
  const idArg = process.argv.find((a) => /^\d+$/.test(a));
  if (idArg) return process.argv.indexOf(idArg);
  return 2;
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const dryRun = dryRunMode();
  const telegramId = await resolveDebugTelegramUserId(
    argvIndexForId(),
    "npx ts-node debug/payments/cancel-subscription-auto-recurring.ts <telegram_id> [--dry-run]",
  );
  const userId = telegramId;

  const cfg = sequelize.config;
  console.log(`DB: ${cfg.database} @ ${cfg.host}:${cfg.port}`);
  console.log({ telegram_id: telegramId, user_id: userId, mode: dryRun ? "dry-run" : "apply" });
  console.log("");

  const rows = await SubscriptionAuto.findAll({
    where: {
      userId,
      cancelledAt: null,
      autoRenewEnabled: true,
    },
    order: [["id", "ASC"]],
  });

  if (rows.length === 0) {
    const anyRows = await SubscriptionAuto.count({ where: { userId } });
    if (anyRows === 0) {
      console.log("No subscription_auto rows for this user.");
    } else {
      console.log(
        "No active auto-renew rows (all already cancelled or auto_renew_enabled=false).",
      );
    }
    return;
  }

  const plans = await SubscriptionPlan.findAll({ attributes: ["id", "code"] });
  const planCodeById = new Map(plans.map((p) => [p.id, p.code]));

  if (!getWayforpayMerchantPassword() && !dryRun) {
    throw new Error(
      "WFP_MERCHANT_PASSWORD is not set — required for regularApi REMOVE (use --dry-run to preview only).",
    );
  }

  for (const row of rows) {
    const anchor = row.anchorOrderReference?.trim() ?? "";
    const planCode = planCodeById.get(row.planId) ?? `(plan_id=${row.planId})`;

    console.log("--- subscription_auto row ---");
    console.log({
      id: row.id,
      plan_code: planCode,
      anchor_order_reference: anchor || null,
      auto_renew_enabled: row.autoRenewEnabled,
      wayforpay_status: row.wayforpayStatus,
      next_charge_at: row.nextChargeAt?.toISOString() ?? null,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
    });

    if (anchor) {
      try {
        const before = await getWayforpayRegularPaymentStatus(anchor);
        console.log("WayForPay STATUS (before):", {
          status: before.status ?? null,
          mode: before.mode ?? null,
          nextPaymentDate: before.nextPaymentDate ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("WayForPay STATUS (before) failed:", message.slice(0, 200));
      }
    } else {
      console.warn("No anchor_order_reference — will only update DB row.");
    }

    if (dryRun) {
      console.log("[dry-run] would call regularApi REMOVE and set cancelled_at\n");
      continue;
    }

    if (anchor) {
      const removeResult = await removeWayforpayRegularPayment(anchor);
      console.log("WayForPay REMOVE:", removeResult);
    }

    const now = new Date();
    let wayforpayStatus = row.wayforpayStatus;
    if (anchor) {
      try {
        const after = await getWayforpayRegularPaymentStatus(anchor);
        wayforpayStatus = after.status ?? "Removed";
        console.log("WayForPay STATUS (after):", {
          status: after.status ?? null,
          mode: after.mode ?? null,
          nextPaymentDate: after.nextPaymentDate ?? null,
        });
      } catch {
        wayforpayStatus = "Removed";
      }
    }

    await row.update({
      autoRenewEnabled: false,
      cancelledAt: now,
      nextChargeAt: null,
      wayforpayStatus,
    });

    console.log("DB updated:", {
      auto_renew_enabled: false,
      cancelled_at: now.toISOString(),
      wayforpay_status: wayforpayStatus,
    });
    console.log("");
  }

  const remaining = await SubscriptionAuto.count({
    where: {
      userId,
      cancelledAt: null,
      autoRenewEnabled: true,
    },
  });
  console.log("Done.", { remaining_active_auto_renew_rows: remaining });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
