import { syncKwigaContactProductsToDb } from "../database/sync-from-kwiga";
import { fetchKwigaContactProducts, postKwigaPurchase } from "../kwiga/kwiga-api-client";
import {
  DEFAULT_KWIGA_PROLONG_FALLBACK_DAYS,
  KWIGA_PURCHASE_DELAY_MS,
  requireKwigaCredentials,
} from "../kwiga/kwiga-config";
import {
  currentKwigaProductOfferId,
  effectiveKwigaProductEndAt,
  plusDaysIso,
  toKwigaIso,
} from "../kwiga/kwiga-product";
import { withKwigaRetry } from "../kwiga/kwiga-retry";
import type {
  ProlongKwigaInput,
  ProlongKwigaProductAction,
  ProlongKwigaResult,
  ProlongKwigaResultStatus,
} from "../kwiga/kwiga-types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPurchaseComment(orderReference: string): string {
  return `Bot group payment prolongation; orderReference=${orderReference}`;
}

function resolveStatus(
  actions: ProlongKwigaProductAction[],
  grantsApplied: number,
): ProlongKwigaResultStatus {
  if (actions.some((a) => a.kind === "skip_no_products")) {
    return "no_products";
  }
  if (actions.some((a) => a.kind === "error")) {
    return grantsApplied > 0 ? "partial" : "failed";
  }
  if (grantsApplied > 0) {
    const hasSkipNoOffer = actions.some((a) => a.kind === "skip_no_offer");
    return hasSkipNoOffer ? "partial" : "ok";
  }
  const onlySkipValid = actions.every((a) => a.kind === "skip_valid");
  if (onlySkipValid && actions.length > 0) {
    return "skipped_all_valid";
  }
  if (actions.some((a) => a.kind === "skip_no_offer")) {
    return "failed";
  }
  return "ok";
}

/**
 * Prolong Kwiga course access for a payer (TA §6.2).
 * Model: debug/kwiga/sync-kwiga-access-from-user-subscription.ts product loop.
 * Not wired to webhook until S2 — call explicitly or from debug CLI.
 */
export async function prolongKwigaCourseAccessForPayment(
  input: ProlongKwigaInput,
): Promise<ProlongKwigaResult> {
  requireKwigaCredentials();

  const apply = input.apply !== false;
  const fallbackDays = input.fallbackDays ?? DEFAULT_KWIGA_PROLONG_FALLBACK_DAYS;
  const targetEnd = input.targetEndAt;
  const targetEndIso = targetEnd.toISOString();
  const fallbackTargetIso = plusDaysIso(fallbackDays);
  const purchaseDedupe = new Set<string>();

  const actions: ProlongKwigaProductAction[] = [];
  let grantsApplied = 0;

  try {
    const products = await withKwigaRetry(() =>
      fetchKwigaContactProducts(input.kwigaContactId),
    );

    if (products.length === 0) {
      actions.push({
        kind: "skip_no_products",
        note: "Contact has no products",
      });
      return { status: "no_products", actions, grantsApplied };
    }

    for (const product of products) {
      const currentEnd = effectiveKwigaProductEndAt(product);
      const isValid = currentEnd !== null && currentEnd >= targetEnd;

      if (isValid) {
        actions.push({
          kind: "skip_valid",
          productId: product.id,
          productTitle: product.title,
          targetEndAt: targetEndIso,
          currentEndAt: toKwigaIso(currentEnd),
        });
        continue;
      }

      const offerId = currentKwigaProductOfferId(product);
      if (!offerId) {
        actions.push({
          kind: "skip_no_offer",
          productId: product.id,
          productTitle: product.title,
          targetEndAt: targetEndIso,
          currentEndAt: toKwigaIso(currentEnd),
          note: "No offer_id found in product subscriptions",
        });
        continue;
      }

      const dedupeKey = `${input.email}:${offerId}:${targetEndIso.slice(0, 10)}`;
      if (purchaseDedupe.has(dedupeKey)) {
        actions.push({
          kind: "skip_valid",
          productId: product.id,
          productTitle: product.title,
          offerId,
          targetEndAt: targetEndIso,
          currentEndAt: toKwigaIso(currentEnd),
          note: "Deduped same email/offer/day within this run",
        });
        continue;
      }

      actions.push({
        kind: "grant_offer",
        productId: product.id,
        productTitle: product.title,
        offerId,
        targetEndAt: targetEndIso,
        currentEndAt: toKwigaIso(currentEnd),
        note: `Exact target date cannot be set via API; offer-based grant used (fallback intent: ${fallbackTargetIso}).`,
      });

      if (!apply) {
        continue;
      }

      await withKwigaRetry(() =>
        postKwigaPurchase({
          email: input.email,
          offerId,
          comment: buildPurchaseComment(input.orderReference),
        }),
      );
      grantsApplied += 1;
      purchaseDedupe.add(dedupeKey);

      if (KWIGA_PURCHASE_DELAY_MS > 0) {
        await sleep(KWIGA_PURCHASE_DELAY_MS);
      }
    }

    if (
      apply &&
      grantsApplied > 0 &&
      !input.skipLocalSync &&
      input.localContactId != null
    ) {
      await withKwigaRetry(() =>
        syncKwigaContactProductsToDb(input.kwigaContactId, input.localContactId!),
      );
    }
  } catch (err) {
    actions.push({
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    status: resolveStatus(actions, grantsApplied),
    actions,
    grantsApplied,
  };
}
