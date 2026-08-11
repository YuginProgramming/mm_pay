/**
 * cancelSubscriptionAutoForUser — WayForPay REMOVE + DB cancel.
 *
 * Запуск: npx vitest run tests/payment/cancel-subscription-auto.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { cancelSubscriptionAutoForUser } from "../../payment/cancel-subscription-auto.service";
import {
  getWayforpayRegularPaymentStatus,
  removeWayforpayRegularPayment,
} from "../../payment/wayforpay-regular-api";

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: {
    findAll: vi.fn(),
  },
}));

vi.mock("../../payment/wayforpay-regular-api", () => ({
  removeWayforpayRegularPayment: vi.fn(),
  getWayforpayRegularPaymentStatus: vi.fn(),
}));

describe("cancelSubscriptionAutoForUser", () => {
  const findAll = vi.mocked(SubscriptionAuto.findAll);
  const remove = vi.mocked(removeWayforpayRegularPayment);
  const status = vi.mocked(getWayforpayRegularPaymentStatus);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns none when no active auto-renew rows", async () => {
    findAll.mockResolvedValue([]);
    const result = await cancelSubscriptionAutoForUser("123");
    expect(result).toEqual({ ok: true, kind: "none" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("REMOVE + marks cancelled when anchor exists", async () => {
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
    remove.mockResolvedValue({ reasonCode: 4100, reason: "Ok" });
    status.mockResolvedValue({
      reasonCode: 4100,
      reason: "Ok",
      status: "Removed",
    });

    const result = await cancelSubscriptionAutoForUser("123");

    expect(remove).toHaveBeenCalledWith("ord-1");
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

  it("updates DB only when no anchor", async () => {
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

    expect(remove).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "cancelled") {
      expect(result.cancelled[0].removedAtWayforpay).toBe(false);
    }
  });

  it("returns error when REMOVE fails", async () => {
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
    remove.mockRejectedValue(new Error("regularApi REMOVE failed"));

    const result = await cancelSubscriptionAutoForUser("123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.message).toContain("REMOVE");
    }
    expect(update).not.toHaveBeenCalled();
  });
});
