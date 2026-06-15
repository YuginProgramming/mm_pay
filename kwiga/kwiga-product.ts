import type { KwigaProduct } from "./kwiga-types";

export function parseKwigaIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toKwigaIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function plusDaysIso(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Latest subscription end on a Kwiga product (or aggregated fallback). */
export function effectiveKwigaProductEndAt(product: KwigaProduct): Date | null {
  const subs = product.subscriptions ?? [];
  let best: Date | null = null;
  for (const s of subs) {
    const dt = parseKwigaIso(s.end_at ?? null);
    if (!dt) continue;
    if (!best || dt > best) best = dt;
  }
  if (best) return best;
  return parseKwigaIso(product.aggregated_subscription?.end_at ?? null);
}

/** First positive offer_id on product subscriptions (batch-script convention). */
export function currentKwigaProductOfferId(product: KwigaProduct): number | null {
  const subs = product.subscriptions ?? [];
  for (const s of subs) {
    if (typeof s.offer_id === "number" && s.offer_id > 0) return s.offer_id;
  }
  return null;
}
