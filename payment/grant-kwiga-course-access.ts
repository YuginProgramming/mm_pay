import {
  KwigaPurchaseGrant,
  type KwigaPurchaseGrantStatus,
} from "../database/KwigaPurchaseGrant";
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

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "name" in err &&
    String((err as { name: string }).name) === "SequelizeUniqueConstraintError"
  );
}

function resultStatusToGrantStatus(
  status: ProlongKwigaResultStatus,
): KwigaPurchaseGrantStatus {
  switch (status) {
    case "skipped_all_valid":
      return "skipped_valid";
    case "ok":
      return "completed";
    case "partial":
      return "partial";
    case "no_products":
    case "failed":
      return "failed";
  }
}

function grantStatusToResultStatus(
  status: KwigaPurchaseGrantStatus,
): ProlongKwigaResultStatus {
  switch (status) {
    case "skipped_valid":
      return "skipped_all_valid";
    case "completed":
      return "ok";
    case "partial":
      return "partial";
    case "pending":
    case "failed":
      return "failed";
  }
}

function actionsFromStoredJson(value: object | null): ProlongKwigaProductAction[] {
  if (!value || !Array.isArray(value)) {
    return [];
  }
  return value as ProlongKwigaProductAction[];
}

function countGrantsApplied(actions: ProlongKwigaProductAction[]): number {
  return actions.filter((a) => a.kind === "grant_offer").length;
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

function lastErrorFromActions(actions: ProlongKwigaProductAction[]): string | null {
  const errAction = [...actions].reverse().find((a) => a.kind === "error");
  return errAction?.error ?? null;
}

function resultFromGrantRow(row: KwigaPurchaseGrant): ProlongKwigaResult {
  const actions = actionsFromStoredJson(row.actionsJson);
  return {
    status: grantStatusToResultStatus(row.status),
    actions,
    grantsApplied: countGrantsApplied(actions),
    idempotentSkip: true,
  };
}

async function findIdempotentSkipResult(
  orderReference: string,
): Promise<ProlongKwigaResult | null> {
  const row = await KwigaPurchaseGrant.findOne({
    where: { wayforpayOrderReference: orderReference },
  });
  if (!row) {
    return null;
  }
  if (row.status === "completed" || row.status === "skipped_valid") {
    return resultFromGrantRow(row);
  }
  if (row.status === "pending") {
    return {
      status: "failed",
      actions: actionsFromStoredJson(row.actionsJson),
      grantsApplied: 0,
      idempotentSkip: true,
    };
  }
  return null;
}

async function acquireGrantSlot(
  orderReference: string,
  contactId: number,
): Promise<"proceed" | "skip"> {
  const existing = await KwigaPurchaseGrant.findOne({
    where: { wayforpayOrderReference: orderReference },
  });

  if (existing?.status === "completed" || existing?.status === "skipped_valid") {
    return "skip";
  }
  if (existing?.status === "pending") {
    return "skip";
  }

  if (existing) {
    await existing.update({ status: "pending", lastError: null });
    return "proceed";
  }

  try {
    await KwigaPurchaseGrant.create({
      wayforpayOrderReference: orderReference,
      contactId,
      status: "pending",
    });
    return "proceed";
  } catch (err) {
    if (!isUniqueConstraintError(err)) {
      throw err;
    }
    const raced = await KwigaPurchaseGrant.findOne({
      where: { wayforpayOrderReference: orderReference },
    });
    if (
      raced?.status === "completed" ||
      raced?.status === "skipped_valid" ||
      raced?.status === "pending"
    ) {
      return "skip";
    }
    if (raced) {
      await raced.update({ status: "pending", lastError: null });
    }
    return "proceed";
  }
}

async function persistGrantResult(
  orderReference: string,
  result: ProlongKwigaResult,
): Promise<void> {
  const status = resultStatusToGrantStatus(result.status);
  await KwigaPurchaseGrant.update(
    {
      status,
      actionsJson: result.actions,
      lastError: lastErrorFromActions(result.actions),
    },
    { where: { wayforpayOrderReference: orderReference } },
  );
}

async function executeProlongLogic(input: ProlongKwigaInput): Promise<ProlongKwigaResult> {
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

/**
 * Prolong Kwiga course access for a payer (TA §6.2).
 * Idempotent per `orderReference` via `kwiga_purchase_grants` when `apply=true`.
 */
export async function prolongKwigaCourseAccessForPayment(
  input: ProlongKwigaInput,
): Promise<ProlongKwigaResult> {
  requireKwigaCredentials();

  const apply = input.apply !== false;
  const recordIdempotency = apply && input.localContactId != null;

  if (recordIdempotency) {
    const cached = await findIdempotentSkipResult(input.orderReference);
    if (cached) {
      return cached;
    }

    const slot = await acquireGrantSlot(input.orderReference, input.localContactId!);
    if (slot === "skip") {
      const raced = await findIdempotentSkipResult(input.orderReference);
      if (raced) {
        return raced;
      }
      return {
        status: "failed",
        actions: [],
        grantsApplied: 0,
        idempotentSkip: true,
      };
    }
  }

  const result = await executeProlongLogic(input);

  if (recordIdempotency) {
    await persistGrantResult(input.orderReference, result);
  }

  return result;
}
