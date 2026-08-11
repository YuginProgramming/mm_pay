import { SubscriptionAuto } from "../database/SubscriptionAuto";
import {
  getWayforpayRegularPaymentStatus,
  removeWayforpayRegularPayment,
} from "./wayforpay-regular-api";

export type CancelSubscriptionAutoRowResult = {
  id: number;
  anchorOrderReference: string | null;
  removedAtWayforpay: boolean;
  wayforpayStatus: string | null;
};

export type CancelSubscriptionAutoResult =
  | { ok: true; kind: "none" }
  | {
      ok: true;
      kind: "cancelled";
      cancelled: CancelSubscriptionAutoRowResult[];
    }
  | {
      ok: false;
      kind: "error";
      message: string;
      cancelled: CancelSubscriptionAutoRowResult[];
    };

async function findActiveAutoRenewRows(
  userId: string,
): Promise<SubscriptionAuto[]> {
  return SubscriptionAuto.findAll({
    where: {
      userId,
      cancelledAt: null,
      autoRenewEnabled: true,
    },
    order: [["id", "ASC"]],
  });
}

/**
 * Cancel WayForPay recurring (regularApi REMOVE) and mark subscription_auto cancelled.
 * Does not revoke paid-period access (grant end stays until janitor/sweep).
 */
export async function cancelSubscriptionAutoForUser(
  userId: string,
): Promise<CancelSubscriptionAutoResult> {
  const rows = await findActiveAutoRenewRows(userId);
  if (rows.length === 0) {
    return { ok: true, kind: "none" };
  }

  const cancelled: CancelSubscriptionAutoRowResult[] = [];

  for (const row of rows) {
    const anchor = row.anchorOrderReference?.trim() ?? "";
    let wayforpayStatus = row.wayforpayStatus;
    let removedAtWayforpay = false;

    try {
      if (anchor) {
        await removeWayforpayRegularPayment(anchor);
        removedAtWayforpay = true;
        try {
          const after = await getWayforpayRegularPaymentStatus(anchor);
          wayforpayStatus = after.status ?? "Removed";
        } catch {
          wayforpayStatus = "Removed";
        }
      }

      const now = new Date();
      await row.update({
        autoRenewEnabled: false,
        cancelledAt: now,
        nextChargeAt: null,
        wayforpayStatus,
      });

      cancelled.push({
        id: row.id,
        anchorOrderReference: anchor || null,
        removedAtWayforpay,
        wayforpayStatus,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        kind: "error",
        message: message.slice(0, 300),
        cancelled,
      };
    }
  }

  return { ok: true, kind: "cancelled", cancelled };
}

/** Preview whether the user has something to cancel (no WayForPay calls). */
export async function hasActiveSubscriptionAutoRenew(
  userId: string,
): Promise<boolean> {
  const rows = await findActiveAutoRenewRows(userId);
  return rows.length > 0;
}
