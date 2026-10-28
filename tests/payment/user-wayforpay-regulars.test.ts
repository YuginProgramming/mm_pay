import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: { findAll: vi.fn() },
}));

vi.mock("../../database/SubscriptionPaymentOrder", () => ({
  SubscriptionPaymentOrder: { findAll: vi.fn() },
}));

vi.mock("../../payment/payment.config", () => ({
  getWayforpayMerchantPassword: vi.fn(),
}));

vi.mock("../../payment/wayforpay-regular-api", () => ({
  getWayforpayRegularPaymentStatus: vi.fn(),
  removeWayforpayRegularPayment: vi.fn(),
}));

import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPaymentOrder } from "../../database/SubscriptionPaymentOrder";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";
import {
  removeLiveWayforpayRegularsForUser,
} from "../../payment/user-wayforpay-regulars";
import {
  getWayforpayRegularPaymentStatus,
  removeWayforpayRegularPayment,
} from "../../payment/wayforpay-regular-api";

describe("removeLiveWayforpayRegularsForUser", () => {
  const autoFindAll = vi.mocked(SubscriptionAuto.findAll);
  const orderFindAll = vi.mocked(SubscriptionPaymentOrder.findAll);
  const password = vi.mocked(getWayforpayMerchantPassword);
  const status = vi.mocked(getWayforpayRegularPaymentStatus);
  const remove = vi.mocked(removeWayforpayRegularPayment);

  beforeEach(() => {
    vi.clearAllMocks();
    password.mockReturnValue("secret");
    autoFindAll.mockResolvedValue([
      {
        anchorOrderReference: "keep-me",
        latestOrderReference: "keep-me_WFPREG-1",
      },
    ] as never);
    orderFindAll.mockResolvedValue([
      { orderReference: "keep-me" },
      { orderReference: "extra-live" },
      { orderReference: "already-dead" },
    ] as never);
  });

  it("skips when merchant password is missing", async () => {
    password.mockReturnValue(null);
    const out = await removeLiveWayforpayRegularsForUser("u1");
    expect(out.scanned).toEqual([]);
    expect(status).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("REMOVE live extras and keeps the requested parent", async () => {
    status.mockImplementation(async (ref: string) => {
      if (ref === "already-dead") {
        throw new Error(
          '[wayforpay] regularApi STATUS failed: {"reasonCode":4107,"status":"Removed"}',
        );
      }
      return {
        reasonCode: 4100,
        reason: "Ok",
        status: "Active",
        orderReference: ref,
      };
    });
    remove.mockResolvedValue({ reasonCode: 4100, reason: "Ok" });

    const out = await removeLiveWayforpayRegularsForUser("u1", {
      keepOrderReference: "keep-me",
    });

    expect(out.live.sort()).toEqual(["extra-live", "keep-me"].sort());
    expect(out.removed).toEqual(["extra-live"]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("extra-live");
    expect(out.kept).toBe("keep-me");
  });

  it("treats 4107 on REMOVE as already gone", async () => {
    status.mockResolvedValue({
      reasonCode: 4100,
      reason: "Ok",
      status: "Active",
    });
    remove.mockRejectedValue(
      new Error('[wayforpay] regularApi REMOVE failed: {"reasonCode":4107,"status":"Removed"}'),
    );

    const out = await removeLiveWayforpayRegularsForUser("u1");
    expect(out.removed.sort()).toEqual(["already-dead", "extra-live", "keep-me"].sort());
    expect(out.errors).toEqual([]);
  });
});
