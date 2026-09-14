/**
 * WayForPay recurring charges append `_WFPREG-…` to the merchant orderReference.
 * Ledger rows (`subscription_payment_orders`, `subscription_auto`) keep the parent UUID.
 */
const WFPREG_INFIX = "_WFPREG-";

export function parentWayforpayOrderReference(orderReference: string): string {
  const raw = orderReference.trim();
  const cut = raw.indexOf(WFPREG_INFIX);
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** Unique keys to look up pending/ledger rows for a webhook orderReference. */
export function wayforpayOrderReferenceLookupKeys(orderReference: string): string[] {
  const raw = orderReference.trim();
  if (!raw) {
    return [];
  }
  const parent = parentWayforpayOrderReference(raw);
  return parent === raw ? [raw] : [raw, parent];
}
