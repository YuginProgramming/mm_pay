/**
 * prolongKwigaCourseAccessForPayment — skip/grant decisions (mocked Kwiga API).
 * Run: npm test -- tests/payment/kwiga-grant-on-payment.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KwigaProduct } from "../../kwiga/kwiga-types";
import {
  currentKwigaProductOfferId,
  effectiveKwigaProductEndAt,
} from "../../kwiga/kwiga-product";
import { prolongKwigaCourseAccessForPayment } from "../../payment/grant-kwiga-course-access";

vi.mock("../../kwiga/kwiga-api-client", () => ({
  fetchKwigaContactProducts: vi.fn(),
  postKwigaPurchase: vi.fn(),
}));

vi.mock("../../database/sync-from-kwiga", () => ({
  syncKwigaContactProductsToDb: vi.fn(),
}));

const mockGrantFindOne = vi.fn();
const mockGrantCreate = vi.fn();
const mockGrantUpdate = vi.fn();

vi.mock("../../database/KwigaPurchaseGrant", () => ({
  KwigaPurchaseGrant: {
    findOne: (...args: unknown[]) => mockGrantFindOne(...args),
    create: (...args: unknown[]) => mockGrantCreate(...args),
    update: (...args: unknown[]) => mockGrantUpdate(...args),
  },
}));

vi.mock("../../kwiga/kwiga-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../kwiga/kwiga-config")>();
  return {
    ...actual,
    requireKwigaCredentials: vi.fn(() => ({
      token: "test-token",
      cabinetHash: "test-cabinet",
    })),
    KWIGA_PURCHASE_DELAY_MS: 0,
    KWIGA_RETRY_MAX_ATTEMPTS: 1,
    KWIGA_RETRY_BASE_DELAY_MS: 1,
  };
});

import { fetchKwigaContactProducts, postKwigaPurchase } from "../../kwiga/kwiga-api-client";
import { syncKwigaContactProductsToDb } from "../../database/sync-from-kwiga";

const mockFetchProducts = vi.mocked(fetchKwigaContactProducts);
const mockPostPurchase = vi.mocked(postKwigaPurchase);
const mockSync = vi.mocked(syncKwigaContactProductsToDb);

function product(
  id: number,
  endAt: string | null,
  offerId: number | null,
): KwigaProduct {
  return {
    id,
    title: `Course ${id}`,
    subscriptions:
      offerId != null
        ? [{ id: id * 10, offer_id: offerId, end_at: endAt, is_active: true }]
        : [],
  };
}

describe("kwiga product helpers", () => {
  it("effectiveKwigaProductEndAt picks latest subscription end", () => {
    const p = product(1, "2026-01-01T00:00:00.000Z", 100);
    expect(effectiveKwigaProductEndAt(p)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("currentKwigaProductOfferId returns first positive offer_id", () => {
    expect(currentKwigaProductOfferId(product(1, null, 548416))).toBe(548416);
    expect(currentKwigaProductOfferId(product(2, null, null))).toBeNull();
  });
});

describe("prolongKwigaCourseAccessForPayment", () => {
  const targetEndAt = new Date("2026-08-01T00:00:00.000Z");
  const baseInput = {
    email: "user@example.com",
    kwigaContactId: 42,
    localContactId: 7,
    targetEndAt,
    orderReference: "order-test-1",
    fallbackDays: 30,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    mockGrantFindOne.mockResolvedValue(null);
    mockGrantCreate.mockResolvedValue({});
    mockGrantUpdate.mockResolvedValue([1]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skip_valid when Kwiga end_at already covers target", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-12-01T00:00:00.000Z", 100),
    ]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: false,
    });

    expect(result.status).toBe("skipped_all_valid");
    expect(result.grantsApplied).toBe(0);
    expect(result.actions[0]?.kind).toBe("skip_valid");
    expect(mockPostPurchase).not.toHaveBeenCalled();
  });

  it("grant_offer when access expired and apply=true posts once per product", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-01-01T00:00:00.000Z", 100),
      product(2, "2026-02-01T00:00:00.000Z", 200),
    ]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.status).toBe("ok");
    expect(result.grantsApplied).toBe(2);
    expect(mockPostPurchase).toHaveBeenCalledTimes(2);
    expect(mockPostPurchase).toHaveBeenCalledWith({
      email: "user@example.com",
      offerId: 100,
      comment: "Bot group payment prolongation; orderReference=order-test-1",
    });
    expect(mockSync).toHaveBeenCalledWith(42, 7);
  });

  it("dry-run plans grant without POST or sync", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-01-01T00:00:00.000Z", 100),
    ]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: false,
    });

    expect(result.actions[0]?.kind).toBe("grant_offer");
    expect(result.grantsApplied).toBe(0);
    expect(mockPostPurchase).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("skip_no_offer when product has no offer_id", async () => {
    mockFetchProducts.mockResolvedValue([product(1, "2026-01-01T00:00:00.000Z", null)]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.status).toBe("failed");
    expect(result.actions[0]?.kind).toBe("skip_no_offer");
    expect(mockPostPurchase).not.toHaveBeenCalled();
  });

  it("no_products when contact has empty product list", async () => {
    mockFetchProducts.mockResolvedValue([]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.status).toBe("no_products");
    expect(mockPostPurchase).not.toHaveBeenCalled();
  });

  it("dedupes same offer within one run", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-01-01T00:00:00.000Z", 100),
      {
        id: 2,
        title: "Course 2 duplicate offer",
        subscriptions: [{ id: 20, offer_id: 100, end_at: "2026-01-02T00:00:00.000Z" }],
      },
    ]);

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.grantsApplied).toBe(1);
    expect(mockPostPurchase).toHaveBeenCalledTimes(1);
    expect(result.actions.some((a) => a.note?.includes("Deduped"))).toBe(true);
  });

  it("dry-run does not write idempotency rows", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-01-01T00:00:00.000Z", 100),
    ]);

    await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: false,
    });

    expect(mockGrantFindOne).not.toHaveBeenCalled();
    expect(mockGrantCreate).not.toHaveBeenCalled();
    expect(mockGrantUpdate).not.toHaveBeenCalled();
  });

  it("apply=true persists pending then final status", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-01-01T00:00:00.000Z", 100),
    ]);

    await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(mockGrantCreate).toHaveBeenCalledWith({
      wayforpayOrderReference: "order-test-1",
      contactId: 7,
      status: "pending",
    });
    expect(mockGrantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        actionsJson: expect.arrayContaining([
          expect.objectContaining({ kind: "grant_offer" }),
        ]),
      }),
      { where: { wayforpayOrderReference: "order-test-1" } },
    );
  });

  it("skips Kwiga POST when grant already completed for orderReference", async () => {
    mockGrantFindOne.mockResolvedValue({
      status: "completed",
      actionsJson: [
        {
          kind: "grant_offer",
          productId: 1,
          offerId: 100,
        },
      ],
    });

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.idempotentSkip).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.grantsApplied).toBe(1);
    expect(mockFetchProducts).not.toHaveBeenCalled();
    expect(mockPostPurchase).not.toHaveBeenCalled();
    expect(mockGrantCreate).not.toHaveBeenCalled();
  });

  it("skips Kwiga POST when grant already skipped_valid", async () => {
    mockGrantFindOne.mockResolvedValue({
      status: "skipped_valid",
      actionsJson: [{ kind: "skip_valid", productId: 1 }],
    });

    const result = await prolongKwigaCourseAccessForPayment({
      ...baseInput,
      apply: true,
    });

    expect(result.idempotentSkip).toBe(true);
    expect(result.status).toBe("skipped_all_valid");
    expect(mockFetchProducts).not.toHaveBeenCalled();
    expect(mockPostPurchase).not.toHaveBeenCalled();
  });
});
