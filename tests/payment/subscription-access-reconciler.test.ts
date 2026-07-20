/**
 * S2-8: cron/poll reconciler — detection, dual-guard idempotency, dry-run, resilience.
 * Run: npm test -- tests/payment/subscription-access-reconciler.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: { findAll: vi.fn() },
}));

vi.mock("../../database/SubscriptionPlan", () => ({
  SubscriptionPlan: { findByPk: vi.fn() },
}));

vi.mock("../../database/ContactProductAccess", () => ({
  ContactProductAccess: { findOne: vi.fn() },
}));

vi.mock("../../payment/payment.config", () => ({
  getWayforpayMerchantPassword: vi.fn(),
}));

vi.mock("../../payment/wayforpay-regular-api", () => ({
  getWayforpayRegularPaymentStatus: vi.fn(),
}));

vi.mock("../../payment/extend-recurring-access", () => ({
  extendRecurringMultimaskingAccess: vi.fn(),
}));

import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";
import { getWayforpayRegularPaymentStatus } from "../../payment/wayforpay-regular-api";
import { extendRecurringMultimaskingAccess } from "../../payment/extend-recurring-access";
import { runSubscriptionAccessReconcileOnce } from "../../payment/subscription-access-reconciler.service";

const mockFindAll = vi.mocked(SubscriptionAuto.findAll);
const mockPlanFindByPk = vi.mocked(SubscriptionPlan.findByPk);
const mockAccessFindOne = vi.mocked(ContactProductAccess.findOne);
const mockPassword = vi.mocked(getWayforpayMerchantPassword);
const mockStatus = vi.mocked(getWayforpayRegularPaymentStatus);
const mockExtend = vi.mocked(extendRecurringMultimaskingAccess);

const NOW_S = Math.floor(Date.now() / 1000);
const ANCHOR = "anchor123";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    userId: "269694206",
    planId: 1,
    anchorOrderReference: ANCHOR,
    lastChargeAt: new Date((NOW_S - 40 * 86400) * 1000),
    lastReconciledPayedAt: null,
    nextChargeAt: null,
    wayforpayStatus: "Active",
    wayforpayMode: "monthly",
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function approvedStatus(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: 4100,
    reason: "Ok",
    status: "Active",
    mode: "monthly",
    amount: 2,
    currency: "UAH",
    lastPayedStatus: "Approved",
    lastPayedDate: NOW_S - 3600,
    nextPaymentDate: NOW_S + 27 * 86400,
    ...overrides,
  };
}

describe("runSubscriptionAccessReconcileOnce (S2-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPassword.mockReturnValue("secret");
    mockPlanFindByPk.mockResolvedValue({ code: "monthly_1m" } as never);
    mockAccessFindOne.mockResolvedValue(null);
    mockStatus.mockResolvedValue(approvedStatus() as never);
    mockExtend.mockResolvedValue({ granted: true, grantEndAt: new Date() });
  });

  it("dry-run: detects missed charge, writes nothing", async () => {
    const row = makeRow();
    mockFindAll.mockResolvedValue([row] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: false });

    expect(res).toMatchObject({
      checked: 1,
      extended: 1,
      skipped: 0,
      errors: [],
      extensions: [],
    });
    expect(mockExtend).not.toHaveBeenCalled();
    expect(row.update).not.toHaveBeenCalled();
  });

  it("apply: extends via helper with synthetic ref and updates high-water mark", async () => {
    const row = makeRow();
    mockFindAll.mockResolvedValue([row] as never);
    const grantEndAt = new Date("2026-08-14T17:23:00.883Z");
    mockExtend.mockResolvedValue({ granted: true, grantEndAt });

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({ checked: 1, extended: 1, skipped: 0 });
    expect(res.extensions).toEqual([{ userId: "269694206", targetEndAt: grantEndAt }]);
    expect(mockExtend).toHaveBeenCalledWith({
      userId: "269694206",
      planId: 1,
      orderReference: `reg-${ANCHOR}-${NOW_S - 3600}`,
      amount: 2,
      currency: "UAH",
      source: "reconciler",
    });
    expect(row.update).toHaveBeenCalledWith(
      expect.objectContaining({
        lastReconciledPayedAt: new Date((NOW_S - 3600) * 1000),
      }),
    );
  });

  it("skips when WayForPay status is not Active", async () => {
    mockStatus.mockResolvedValue(approvedStatus({ status: "Suspended" }) as never);
    mockFindAll.mockResolvedValue([makeRow()] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({ checked: 1, extended: 0, skipped: 1 });
    expect(mockExtend).not.toHaveBeenCalled();
  });

  it("skips when last payment is not Approved", async () => {
    mockStatus.mockResolvedValue(
      approvedStatus({ lastPayedStatus: "Declined" }) as never,
    );
    mockFindAll.mockResolvedValue([makeRow()] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({ extended: 0, skipped: 1 });
    expect(mockExtend).not.toHaveBeenCalled();
  });

  it("skips when charge is not newer than high-water mark", async () => {
    const row = makeRow({ lastChargeAt: new Date(Date.now()) });
    mockStatus.mockResolvedValue(
      approvedStatus({ lastPayedDate: NOW_S - 2 * 86400 }) as never,
    );
    mockFindAll.mockResolvedValue([row] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({ extended: 0, skipped: 1 });
    expect(mockExtend).not.toHaveBeenCalled();
  });

  it("idempotent: synthetic order reference already granted → skip", async () => {
    mockAccessFindOne.mockResolvedValue({ id: 555 } as never);
    mockFindAll.mockResolvedValue([makeRow()] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({ extended: 0, skipped: 1 });
    expect(mockExtend).not.toHaveBeenCalled();
  });

  it("resilient: STATUS error is captured, loop continues", async () => {
    mockStatus
      .mockRejectedValueOnce(new Error("WFP 500"))
      .mockResolvedValueOnce(approvedStatus() as never);
    mockFindAll.mockResolvedValue([
      makeRow({ id: 1 }),
      makeRow({ id: 2 }),
    ] as never);

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res.checked).toBe(2);
    expect(res.extended).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("auto#1");
  });

  it("no-op when WFP_MERCHANT_PASSWORD is unset", async () => {
    mockPassword.mockReturnValue("");

    const res = await runSubscriptionAccessReconcileOnce({ apply: true });

    expect(res).toMatchObject({
      checked: 0,
      extended: 0,
      skipped: 0,
      extensions: [],
    });
    expect(mockFindAll).not.toHaveBeenCalled();
  });
});
