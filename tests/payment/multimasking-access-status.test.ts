/**
 * Universal grace after end_at (payment_hook, user_subscriptions, subscription_auto).
 *
 * Запуск: npx vitest run tests/payment/multimasking-access-status.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import {
  getMultimaskingAccessGraceDays,
  hasActiveMultimaskingAccess,
} from "../../payment/multimasking-access-status";
import { getSubscriptionStatusForUserId } from "../../payment/subscription-status.service";
import { getActiveMultimaskingPaymentSummaryForContact } from "../../telegram/paid-chat-janitor/paid-chat-allowlist";

vi.mock("../../telegram/paid-chat-janitor/paid-chat-allowlist", () => ({
  getActiveMultimaskingPaymentSummaryForContact: vi.fn(),
}));

vi.mock("../../payment/subscription-status.service", () => ({
  getSubscriptionStatusForUserId: vi.fn(),
}));

vi.mock("../../database/ContactProductAccess", () => ({
  ContactProductAccess: {
    findOne: vi.fn(),
  },
}));

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: {
    findAll: vi.fn(),
  },
}));

describe("getMultimaskingAccessGraceDays", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.MULTIMASKING_ACCESS_GRACE_DAYS;
    delete process.env.SUBSCRIPTION_AUTO_GRACE_DAYS;
  });

  afterEach(() => {
    process.env = env;
  });

  it("defaults to 5 days", () => {
    expect(getMultimaskingAccessGraceDays()).toBe(5);
  });

  it("prefers MULTIMASKING_ACCESS_GRACE_DAYS over SUBSCRIPTION_AUTO_GRACE_DAYS", () => {
    process.env.SUBSCRIPTION_AUTO_GRACE_DAYS = "3";
    process.env.MULTIMASKING_ACCESS_GRACE_DAYS = "7";
    expect(getMultimaskingAccessGraceDays()).toBe(7);
  });
});

describe("hasActiveMultimaskingAccess — universal grace", () => {
  const mockGrantSummary = vi.mocked(getActiveMultimaskingPaymentSummaryForContact);
  const mockUserSub = vi.mocked(getSubscriptionStatusForUserId);
  const mockGrantFindOne = vi.mocked(ContactProductAccess.findOne);
  const mockAutos = vi.mocked(SubscriptionAuto.findAll);

  const contactId = 9001;
  const userId = "123456789";
  const grantEndAt = new Date("2026-06-01T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mockAutos.mockResolvedValue([]);
    mockGrantSummary.mockResolvedValue({ active: false });
    mockUserSub.mockResolvedValue({
      status: "inactive",
      planCode: null,
      startAtIso: null,
      endAtIso: null,
      daysLeft: 0,
      canRenew: false,
      autoRenew: false,
      wayforpayStatus: null,
      nextChargeAt: null,
    });
    mockGrantFindOne.mockResolvedValue(null);
  });

  it("legacy payment_hook expired 3 days ago stays in grace", async () => {
    const now = new Date("2026-06-04T12:00:00.000Z");
    mockGrantFindOne.mockResolvedValue({ endAt: grantEndAt } as ContactProductAccess);

    const access = await hasActiveMultimaskingAccess(contactId, userId, now);

    expect(access.hasAccess).toBe(true);
    expect(access.inGracePeriod).toBe(true);
    expect(access.source).toBe("payment_hook");
    expect(access.grantEndAt?.toISOString()).toBe(grantEndAt.toISOString());
  });

  it("legacy payment_hook expired 6 days ago is outside grace", async () => {
    const now = new Date("2026-06-07T12:00:00.000Z");
    mockGrantFindOne.mockResolvedValue({ endAt: grantEndAt } as ContactProductAccess);

    const access = await hasActiveMultimaskingAccess(contactId, userId, now);

    expect(access.hasAccess).toBe(false);
    expect(access.inGracePeriod).toBe(false);
  });

  it("lapsed user_subscription expired 2 days ago stays in grace", async () => {
    const subEndAt = new Date("2026-06-08T00:00:00.000Z");
    const now = new Date("2026-06-10T12:00:00.000Z");
    mockUserSub.mockResolvedValue({
      status: "lapsed",
      planCode: "monthly_1m",
      startAtIso: "2026-05-08T00:00:00.000Z",
      endAtIso: subEndAt.toISOString(),
      daysLeft: 0,
      canRenew: true,
      autoRenew: false,
      wayforpayStatus: null,
      nextChargeAt: null,
    });

    const access = await hasActiveMultimaskingAccess(contactId, userId, now);

    expect(access.hasAccess).toBe(true);
    expect(access.inGracePeriod).toBe(true);
    expect(access.source).toBe("user_subscription");
    expect(access.userSubscriptionPlanCode).toBe("monthly_1m");
  });

  it("active grant does not set inGracePeriod", async () => {
    const now = new Date("2026-05-15T12:00:00.000Z");
    mockGrantSummary.mockResolvedValue({ active: true, grantEndAt });

    const access = await hasActiveMultimaskingAccess(contactId, userId, now);

    expect(access.hasAccess).toBe(true);
    expect(access.inGracePeriod).toBe(false);
    expect(access.source).toBe("payment_hook");
    expect(mockGrantFindOne).not.toHaveBeenCalled();
  });

  it("uses latest end_at when grant and user_sub both expired within grace", async () => {
    const olderGrantEnd = new Date("2026-06-01T00:00:00.000Z");
    const newerSubEnd = new Date("2026-06-08T00:00:00.000Z");
    const now = new Date("2026-06-10T12:00:00.000Z");

    mockGrantFindOne.mockResolvedValue({ endAt: olderGrantEnd } as ContactProductAccess);
    mockUserSub.mockResolvedValue({
      status: "lapsed",
      planCode: "monthly_1m",
      startAtIso: "2026-05-08T00:00:00.000Z",
      endAtIso: newerSubEnd.toISOString(),
      daysLeft: 0,
      canRenew: true,
      autoRenew: false,
      wayforpayStatus: null,
      nextChargeAt: null,
    });

    const access = await hasActiveMultimaskingAccess(contactId, userId, now);

    expect(access.hasAccess).toBe(true);
    expect(access.inGracePeriod).toBe(true);
    expect(access.source).toBe("user_subscription");
  });
});
