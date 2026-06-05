import type { SubscriptionAuto } from "../database/SubscriptionAuto";

function isWayforpayActiveStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "active";
}

/**
 * Чи вважати `subscription_auto` активним для gate / profile / allowlist.
 * Після першої Approved-оплати regularApi STATUS інколи ще порожній — тоді орієнтир на ledger рядка.
 */
export function isActiveSubscriptionAutoRecord(
  row: Pick<
    SubscriptionAuto,
    "wayforpayStatus" | "autoRenewEnabled" | "lastChargeStatus" | "cancelledAt"
  >,
): boolean {
  if (row.cancelledAt != null) {
    return false;
  }
  if (isWayforpayActiveStatus(row.wayforpayStatus)) {
    return true;
  }
  const status = (row.wayforpayStatus ?? "").trim().toLowerCase();
  if (status !== "" && status !== "pending") {
    return false;
  }
  return row.autoRenewEnabled && row.lastChargeStatus === "Approved";
}

/** Для UI/API, коли WayForPay STATUS ще не підтягнувся. */
export function displayWayforpayStatus(
  status: string | null | undefined,
  row: Pick<SubscriptionAuto, "autoRenewEnabled" | "lastChargeStatus">,
): string {
  const trimmed = (status ?? "").trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (row.autoRenewEnabled && row.lastChargeStatus === "Approved") {
    return "Active";
  }
  return "—";
}
