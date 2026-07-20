/**
 * S2: KWIGA recurring exact end-date service.
 * Run: npm test -- tests/payment/kwiga-recurring-end-date.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/TelegramUser", () => ({
  TelegramUser: { findOne: vi.fn() },
}));

vi.mock("../../database/contact-lookup", () => ({
  findContactByEmailForBot: vi.fn(),
}));

vi.mock("../../database/sync-from-kwiga", () => ({
  syncKwigaContactProductsToDb: vi.fn(),
}));

vi.mock("../../kwiga/kwiga-config", () => ({
  requireKwigaCredentials: vi.fn(() => ({
    token: "test-token",
    cabinetHash: "test-cabinet",
  })),
}));

vi.mock("../../kwiga/kwiga-api-client", () => ({
  fetchKwigaContactProducts: vi.fn(),
  putKwigaProductEndDate: vi.fn(),
}));

vi.mock("../../database/normalize-email", () => ({
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

import { TelegramUser } from "../../database/TelegramUser";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { syncKwigaContactProductsToDb } from "../../database/sync-from-kwiga";
import { requireKwigaCredentials } from "../../kwiga/kwiga-config";
import {
  fetchKwigaContactProducts,
  putKwigaProductEndDate,
} from "../../kwiga/kwiga-api-client";
import {
  runKwigaRecurringEndDatesOnce,
  setKwigaExactEndDateForRecurringUser,
} from "../../payment/kwiga-recurring-end-date.service";

const mockTelegramFindOne = vi.mocked(TelegramUser.findOne);
const mockFindContact = vi.mocked(findContactByEmailForBot);
const mockSync = vi.mocked(syncKwigaContactProductsToDb);
const mockRequireCreds = vi.mocked(requireKwigaCredentials);
const mockFetchProducts = vi.mocked(fetchKwigaContactProducts);
const mockPutEnd = vi.mocked(putKwigaProductEndDate);

const TARGET = new Date("2026-08-14T17:23:00.883Z");
const USER_ID = "269694206";

function product(id: number, endAt: string | null) {
  return {
    id,
    title: `Course ${id}`,
    subscriptions: endAt
      ? [{ id: id * 10, offer_id: 1, end_at: endAt, is_active: true }]
      : [],
  };
}

describe("setKwigaExactEndDateForRecurringUser (S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreds.mockReturnValue({
      token: "test-token",
      cabinetHash: "test-cabinet",
    });
    mockTelegramFindOne.mockResolvedValue({
      telegramId: USER_ID,
      email: "user@example.com",
    } as never);
    mockFindContact.mockResolvedValue({
      id: 10,
      externalId: 2314024,
    } as never);
    mockFetchProducts.mockResolvedValue([
      product(98251, "2026-07-01T00:00:00.000Z"),
      product(99850, "2026-07-01T00:00:00.000Z"),
    ] as never);
    mockPutEnd.mockResolvedValue({ id: 1, title: "x" } as never);
    mockSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PUTs all products to target end and syncs local DB", async () => {
    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res).toMatchObject({
      attempted: 2,
      updated: 2,
      skipped: 0,
      errors: [],
    });
    expect(mockPutEnd).toHaveBeenCalledTimes(2);
    expect(mockPutEnd).toHaveBeenNthCalledWith(1, {
      kwigaContactId: 2314024,
      productId: 98251,
      endAt: TARGET,
    });
    expect(mockPutEnd).toHaveBeenNthCalledWith(2, {
      kwigaContactId: 2314024,
      productId: 99850,
      endAt: TARGET,
    });
    expect(mockSync).toHaveBeenCalledWith(2314024, 10);
  });

  it("skips PUT when live end already matches target (rate hygiene)", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, TARGET.toISOString()),
      product(2, "2026-07-01T00:00:00.000Z"),
    ] as never);

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res).toMatchObject({ attempted: 1, updated: 1, skipped: 1 });
    expect(mockPutEnd).toHaveBeenCalledTimes(1);
    expect(mockPutEnd).toHaveBeenCalledWith({
      kwigaContactId: 2314024,
      productId: 2,
      endAt: TARGET,
    });
  });

  it("skips when contact has no externalId", async () => {
    mockFindContact.mockResolvedValue({ id: 10, externalId: null } as never);

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res).toMatchObject({ attempted: 0, updated: 0, skipped: 1 });
    expect(mockFetchProducts).not.toHaveBeenCalled();
    expect(mockPutEnd).not.toHaveBeenCalled();
  });

  it("skips when telegram user has no email", async () => {
    mockTelegramFindOne.mockResolvedValue({
      telegramId: USER_ID,
      email: null,
    } as never);

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res.skipped).toBe(1);
    expect(mockFindContact).not.toHaveBeenCalled();
  });

  it("records GET error without throwing", async () => {
    mockFetchProducts.mockRejectedValue(new Error("WFP down"));

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res.updated).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("GET products");
  });

  it("continues other products if one PUT fails; sync only if any updated", async () => {
    mockPutEnd
      .mockRejectedValueOnce(new Error("422 bad"))
      .mockResolvedValueOnce({ id: 99850, title: "ok" } as never);

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res).toMatchObject({ attempted: 2, updated: 1 });
    expect(res.errors).toHaveLength(1);
    expect(mockSync).toHaveBeenCalled();
  });

  it("does not sync when nothing updated", async () => {
    mockFetchProducts.mockResolvedValue([
      product(1, TARGET.toISOString()),
    ] as never);

    await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(mockSync).not.toHaveBeenCalled();
  });

  it("sync failure is recorded; does not throw", async () => {
    mockSync.mockRejectedValue(new Error("sync boom"));

    const res = await setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 0,
    });

    expect(res.updated).toBe(2);
    expect(res.errors.some((e) => e.includes("sync"))).toBe(true);
  });

  it("pauses between PUTs when delayMs > 0", async () => {
    vi.useFakeTimers();
    const promise = setKwigaExactEndDateForRecurringUser({
      userId: USER_ID,
      targetEndAt: TARGET,
      delayMs: 500,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPutEnd).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    const res = await promise;
    expect(mockPutEnd).toHaveBeenCalledTimes(2);
    expect(res.updated).toBe(2);
  });
});

describe("runKwigaRecurringEndDatesOnce (S2 batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreds.mockReturnValue({
      token: "test-token",
      cabinetHash: "test-cabinet",
    });
    mockTelegramFindOne.mockResolvedValue({
      telegramId: USER_ID,
      email: "user@example.com",
    } as never);
    mockFindContact.mockResolvedValue({
      id: 10,
      externalId: 2314024,
    } as never);
    mockFetchProducts.mockResolvedValue([
      product(1, "2026-07-01T00:00:00.000Z"),
    ] as never);
    mockPutEnd.mockResolvedValue({ id: 1, title: "x" } as never);
    mockSync.mockResolvedValue(undefined);
  });

  it("runs for each extension", async () => {
    const batch = await runKwigaRecurringEndDatesOnce({
      extensions: [
        { userId: USER_ID, targetEndAt: TARGET },
        { userId: "111", targetEndAt: TARGET },
      ],
      delayMs: 0,
    });

    expect(batch.users).toBe(2);
    expect(batch.updated).toBe(2);
    expect(mockPutEnd).toHaveBeenCalledTimes(2);
  });
});
