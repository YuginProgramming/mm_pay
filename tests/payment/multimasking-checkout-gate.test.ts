/**
 * Перевіряє `gateMultimaskingCheckoutForTelegramId` (HTTP checkout / той самий ланцюжок, що бот):
 * 1) email у telegram_users
 * 2) згода з правилами (consent)
 * 3) ранг KWIGA masters / pro
 * 4) відсутність активного доступу MULTIMASKING (payment_hook / subscription_auto / user_subscriptions)
 *
 * Запуск: npm test -- tests/payment/multimasking-checkout-gate.test.ts
 * або:    npx vitest run tests/payment/multimasking-checkout-gate.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramUser } from "../../database/TelegramUser";
import { hasAcceptedCurrentRules } from "../../telegram/handlers/rules";
import { computeKwigaRankSnapshot } from "../../telegram/profile/kwiga-rank-db";
import { gateMultimaskingCheckoutForTelegramId } from "../../payment/multimasking-checkout-eligibility";
import { hasActiveMultimaskingAccess } from "../../payment/multimasking-access-status";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "../../payment/subscription-plan-codes";

vi.mock("../../database/TelegramUser", () => ({
  TelegramUser: {
    findOne: vi.fn(),
  },
}));

vi.mock("../../telegram/handlers/rules", () => ({
  hasAcceptedCurrentRules: vi.fn(),
}));

vi.mock("../../telegram/profile/kwiga-rank-db", () => ({
  computeKwigaRankSnapshot: vi.fn(),
}));

vi.mock("../../payment/multimasking-access-status", () => ({
  hasActiveMultimaskingAccess: vi.fn(),
}));

const telegramId = "999001337";
const contactId = 4242;

function baseUser(overrides: Partial<{ email: string | null }> = {}) {
  return {
    telegramId,
    email: "user@example.com",
    ...overrides,
  } as unknown as TelegramUser;
}

function mastersSnapshot(overrides: Partial<{ contact: unknown }> = {}) {
  return {
    rank: "masters" as const,
    accessRowCount: 2,
    contact: { id: contactId },
    candidateRank: "masters" as const,
    candidateAccessRowCount: 2,
    ...overrides,
  };
}

describe("gateMultimaskingCheckoutForTelegramId — обмеження оплати MULTIMASKING", () => {
  const findOne = vi.mocked(TelegramUser.findOne);
  const mockConsent = vi.mocked(hasAcceptedCurrentRules);
  const mockSnapshot = vi.mocked(computeKwigaRankSnapshot);
  const mockAccess = vi.mocked(hasActiveMultimaskingAccess);

  const noAccess = {
    hasAccess: false,
    source: null,
    grantEndAt: null,
    autoRenew: null,
    userSubscriptionPlanCode: null,
    userSubscriptionEndAt: null,
    inGracePeriod: false,
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue(baseUser());
    mockConsent.mockResolvedValue(true);
    mockSnapshot.mockResolvedValue(mastersSnapshot());
    mockAccess.mockResolvedValue({ ...noAccess });
  });

  it("1) email: без користувача в БД → no_user", async () => {
    findOne.mockResolvedValue(null);
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      rank: "no_kwiga_contact",
      reason: "no_user",
    });
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("1) email: порожній email → no_email", async () => {
    findOne.mockResolvedValue(baseUser({ email: "   " }));
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: false, reason: "no_email" });
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it("2) consent: немає згоди з правилами → no_consent", async () => {
    mockConsent.mockResolvedValue(false);
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: false, reason: "no_consent" });
    expect(mockSnapshot).not.toHaveBeenCalled();
  });

  it("3) rank / KWIGA: немає контакта за email → no_contact", async () => {
    mockSnapshot.mockResolvedValue({
      rank: "no_kwiga_contact",
      accessRowCount: 0,
      contact: null,
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      rank: "no_kwiga_contact",
      reason: "no_contact",
    });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("3) rank: prospectives → rank_ineligible", async () => {
    mockSnapshot.mockResolvedValue({
      rank: "prospectives",
      accessRowCount: 0,
      contact: { id: contactId },
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      rank: "prospectives",
      reason: "rank_ineligible",
    });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("3) rank: masters дозволяє перейти до перевірки оплати", async () => {
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: true });
    expect(mockAccess).toHaveBeenCalledWith(contactId, telegramId);
  });

  it("3) rank: pro дозволяє оплату", async () => {
    mockSnapshot.mockResolvedValue({
      rank: "pro",
      accessRowCount: 5,
      contact: { id: contactId },
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: true });
  });

  it("4) paid status: активний payment_hook → already_active_access + grantEndAtIso", async () => {
    const end = new Date("2030-06-15T12:00:00.000Z");
    mockAccess.mockResolvedValue({
      hasAccess: true,
      source: "payment_hook",
      grantEndAt: end,
      autoRenew: null,
      userSubscriptionPlanCode: null,
      userSubscriptionEndAt: null,
      inGracePeriod: false,
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: end.toISOString(),
      accessSource: "payment_hook",
      autoRenew: null,
    });
  });

  it("4) paid status: активний доступ без дати кінця в записі → grantEndAtIso null", async () => {
    mockAccess.mockResolvedValue({
      hasAccess: true,
      source: "payment_hook",
      grantEndAt: null,
      autoRenew: null,
      userSubscriptionPlanCode: null,
      userSubscriptionEndAt: null,
      inGracePeriod: false,
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: null,
      accessSource: "payment_hook",
      autoRenew: null,
    });
  });

  it("успіх: email + consent + контакт + masters/pro + немає активної оплати → ok", async () => {
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: true });
  });

  describe("S2-8 — legacy vs subscription_auto vs прострочений доступ", () => {
    it("legacy active (payment_hook) → checkout заблоковано", async () => {
      const end = new Date("2030-08-01T00:00:00.000Z");
      mockAccess.mockResolvedValue({
        hasAccess: true,
        source: "payment_hook",
        grantEndAt: end,
        autoRenew: null,
        userSubscriptionPlanCode: null,
        userSubscriptionEndAt: null,
        inGracePeriod: false,
      });

      const g = await gateMultimaskingCheckoutForTelegramId(telegramId);

      expect(g).toEqual({
        ok: false,
        reason: "already_active_access",
        grantEndAtIso: end.toISOString(),
        accessSource: "payment_hook",
        autoRenew: null,
      });
    });

    it("subscription_auto Active + grant → checkout заблоковано + autoRenew", async () => {
      const end = new Date("2030-09-01T12:00:00.000Z");
      const nextCharge = new Date("2030-08-01T09:30:00.000Z");
      const autoRenew = {
        planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
        wayforpayStatus: "Active",
        wayforpayMode: "monthly",
        nextChargeAt: nextCharge,
        anchorOrderReference: "WFP-MONTHLY-ANCHOR",
      };
      mockAccess.mockResolvedValue({
        hasAccess: true,
        source: "subscription_auto",
        grantEndAt: end,
        autoRenew,
        userSubscriptionPlanCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
        userSubscriptionEndAt: end,
        inGracePeriod: false,
      });

      const g = await gateMultimaskingCheckoutForTelegramId(telegramId);

      expect(g).toEqual({
        ok: false,
        reason: "already_active_access",
        grantEndAtIso: end.toISOString(),
        accessSource: "subscription_auto",
        autoRenew,
      });
    });

    it("subscription_auto Active у grace (grant прострочений) → checkout заблоковано", async () => {
      const expiredEnd = new Date("2020-03-01T00:00:00.000Z");
      const autoRenew = {
        planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
        wayforpayStatus: "Active",
        wayforpayMode: "monthly",
        nextChargeAt: new Date("2020-03-05T10:00:00.000Z"),
        anchorOrderReference: "WFP-GRACE",
      };
      mockAccess.mockResolvedValue({
        hasAccess: true,
        source: "subscription_auto",
        grantEndAt: expiredEnd,
        autoRenew,
        userSubscriptionPlanCode: null,
        userSubscriptionEndAt: null,
        inGracePeriod: true,
      });

      const g = await gateMultimaskingCheckoutForTelegramId(telegramId);

      expect(g).toEqual({
        ok: false,
        reason: "already_active_access",
        grantEndAtIso: expiredEnd.toISOString(),
        accessSource: "subscription_auto",
        autoRenew,
      });
    });

    it("legacy прострочений (hasAccess=false) → checkout дозволено", async () => {
      mockAccess.mockResolvedValue({ ...noAccess });

      const g = await gateMultimaskingCheckoutForTelegramId(telegramId);

      expect(g).toEqual({ ok: true });
      expect(mockAccess).toHaveBeenCalledWith(contactId, telegramId);
    });
  });
});
