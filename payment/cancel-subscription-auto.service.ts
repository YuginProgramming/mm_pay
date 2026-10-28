import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { removeLiveWayforpayRegularsForUser } from "./user-wayforpay-regulars";

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
 * Cancel WayForPay recurring (regularApi REMOVE all live rules) and mark subscription_auto cancelled.
 * Does not revoke paid-period access (grant end stays until janitor/sweep).
 */
export async function cancelSubscriptionAutoForUser(
  userId: string,
): Promise<CancelSubscriptionAutoResult> {
  const rows = await findActiveAutoRenewRows(userId);
  if (rows.length === 0) {
    try {
      await removeLiveWayforpayRegularsForUser(userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, kind: "error", message: message.slice(0, 300), cancelled: [] };
    }
    return { ok: true, kind: "none" };
  }

  try {
    await removeLiveWayforpayRegularsForUser(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "error",
      message: message.slice(0, 300),
      cancelled: [],
    };
  }

  const cancelled: CancelSubscriptionAutoRowResult[] = [];
  const now = new Date();

  for (const row of rows) {
    const anchor = row.anchorOrderReference?.trim() ?? "";
    await row.update({
      autoRenewEnabled: false,
      cancelledAt: now,
      nextChargeAt: null,
      wayforpayStatus: "Removed",
    });
    cancelled.push({
      id: row.id,
      anchorOrderReference: anchor || null,
      removedAtWayforpay: Boolean(anchor),
      wayforpayStatus: "Removed",
    });
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
