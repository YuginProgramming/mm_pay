/**
 * cancelSubscriptionAutoForUser — sweep all live WFP regulars + DB cancel.
 *
 * Запуск: npx vitest run tests/payment/cancel-subscription-auto.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { cancelSubscriptionAutoForUser } from "../../payment/cancel-subscription-auto.service";
import { removeLiveWayforpayRegularsForUser } from "../../payment/user-wayforpay-regulars";

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: {
    findAll: vi.fn(),
  },
}));

vi.mock("../../payment/user-wayforpay-regulars", () => ({
  removeLiveWayforpayRegularsForUser: vi.fn(),
}));

describe("cancelSubscriptionAutoForUser", () => {
  const findAll = vi.mocked(SubscriptionAuto.findAll);
  const sweep = vi.mocked(removeLiveWayforpayRegularsForUser);

  beforeEach(() => {
    vi.clearAllMocks();
    sweep.mockResolvedValue({
      scanned: [],
      live: [],
      kept: null,
      removed: [],
      errors: [],
    });
  });

  it("returns none when no active auto-renew rows", async () => {
    findAll.mockResolvedValue([]);
    const result = await cancelSubscriptionAutoForUser("123");
    expect(result).toEqual({ ok: true, kind: "none" });
    expect(sweep).toHaveBeenCalledWith("123");
  });

  it("sweeps all live regulars then marks cancelled", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    findAll.mockResolvedValue([
      {
        id: 10,
        userId: "123",
        anchorOrderReference: "ord-1",
        wayforpayStatus: "Active",
        update,
      } as unknown as SubscriptionAuto,
    ]);

    const result = await cancelSubscriptionAutoForUser("123");

    expect(sweep).toHaveBeenCalledWith("123");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRenewEnabled: false,
        nextChargeAt: null,
        wayforpayStatus: "Removed",
        cancelledAt: expect.any(Date),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "cancelled") {
      expect(result.cancelled).toHaveLength(1);
      expect(result.cancelled[0].removedAtWayforpay).toBe(true);
    }
  });

  it("updates DB when no anchor (sweep still runs)", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    findAll.mockResolvedValue([
      {
        id: 11,
        userId: "123",
        anchorOrderReference: null,
        wayforpayStatus: "Active",
        update,
      } as unknown as SubscriptionAuto,
    ]);

    const result = await cancelSubscriptionAutoForUser("123");

    expect(sweep).toHaveBeenCalledWith("123");
    expect(update).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "cancelled") {
      expect(result.cancelled[0].removedAtWayforpay).toBe(false);
    }
  });

  it("returns error when sweep throws", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    findAll.mockResolvedValue([
      {
        id: 12,
        userId: "123",
        anchorOrderReference: "ord-fail",
        wayforpayStatus: "Active",
        update,
      } as unknown as SubscriptionAuto,
    ]);
    sweep.mockRejectedValue(new Error("regularApi REMOVE failed"));

    const result = await cancelSubscriptionAutoForUser("123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.message).toContain("REMOVE");
    }
    expect(update).not.toHaveBeenCalled();
  });
});
