/**
 * Перевіряє `gateMultimaskingCheckoutForTelegramId` (HTTP checkout / той самий ланцюжок, що бот):
 * 1) email у telegram_users
 * 2) згода з правилами (consent)
 * 3) ранг KWIGA masters / pro
 * 4) відсутність активного payment_hook MULTIMASKING (не подвійна оплата за поточний період)
 *
 * Запуск: npm test -- tests/payment/multimasking-checkout-gate.test.ts
 * або:    npx vitest run tests/payment/multimasking-checkout-gate.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramUser } from "../../database/TelegramUser";
import { hasAcceptedCurrentRules } from "../../telegram/handlers/rules";
import { getActiveMultimaskingPaymentSummaryForContact } from "../../telegram/paid-chat-janitor/paid-chat-allowlist";
import { computeKwigaRankSnapshot } from "../../telegram/profile/kwiga-rank-db";
import { gateMultimaskingCheckoutForTelegramId } from "../../payment/multimasking-checkout-eligibility";

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

vi.mock("../../telegram/paid-chat-janitor/paid-chat-allowlist", () => ({
  getActiveMultimaskingPaymentSummaryForContact: vi.fn(),
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
  const mockPaymentSummary = vi.mocked(getActiveMultimaskingPaymentSummaryForContact);

  beforeEach(() => {
    vi.clearAllMocks();
    findOne.mockResolvedValue(baseUser());
    mockConsent.mockResolvedValue(true);
    mockSnapshot.mockResolvedValue(mastersSnapshot());
    mockPaymentSummary.mockResolvedValue({ active: false });
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
    expect(mockPaymentSummary).not.toHaveBeenCalled();
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
    expect(mockPaymentSummary).not.toHaveBeenCalled();
  });

  it("3) rank: masters дозволяє перейти до перевірки оплати", async () => {
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: true });
    expect(mockPaymentSummary).toHaveBeenCalledWith(contactId);
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
    mockPaymentSummary.mockResolvedValue({
      active: true,
      grantEndAt: end,
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: end.toISOString(),
    });
  });

  it("4) paid status: активний доступ без дати кінця в записі → grantEndAtIso null", async () => {
    mockPaymentSummary.mockResolvedValue({
      active: true,
      grantEndAt: null,
    });
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({
      ok: false,
      reason: "already_active_access",
      grantEndAtIso: null,
    });
  });

  it("успіх: email + consent + контакт + masters/pro + немає активної оплати → ok", async () => {
    const g = await gateMultimaskingCheckoutForTelegramId(telegramId);
    expect(g).toEqual({ ok: true });
  });
});
