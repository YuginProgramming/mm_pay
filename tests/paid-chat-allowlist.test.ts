/**
 * S2-9: `buildPaidChatAllowlistsStepB` — legacy payment_hook vs subscription_auto + grant.
 *
 * Запуск: npx vitest run tests/paid-chat-allowlist.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { findContactByEmailForBot } from "../database/contact-lookup";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPlan } from "../database/SubscriptionPlan";
import { TelegramUser } from "../database/TelegramUser";
import { hasActiveMultimaskingAccess } from "../payment/multimasking-access-status";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "../payment/subscription-plan-codes";
import { computeKwigaRankSnapshot } from "../telegram/profile/kwiga-rank-db";
import {
  buildPaidChatAllowlistsStepB,
  isTelegramIdOnPaidChatAllowlistStepB,
} from "../telegram/paid-chat-janitor/paid-chat-allowlist";

vi.mock("../database/ContactProductAccess", () => ({
  ContactProductAccess: {
    findAll: vi.fn(),
  },
}));

vi.mock("../database/SubscriptionAuto", () => ({
  SubscriptionAuto: {
    findAll: vi.fn(),
  },
}));

vi.mock("../database/SubscriptionPlan", () => ({
  SubscriptionPlan: {
    findByPk: vi.fn(),
  },
}));

vi.mock("../database/TelegramUser", () => ({
  TelegramUser: {
    findOne: vi.fn(),
    findAll: vi.fn(),
  },
}));

vi.mock("../database/Contact", () => ({
  Contact: {
    findByPk: vi.fn(),
  },
}));

vi.mock("../database/contact-lookup", () => ({
  findContactByEmailForBot: vi.fn(),
}));

vi.mock("../payment/multimasking-access-status", () => ({
  hasActiveMultimaskingAccess: vi.fn(),
}));

vi.mock("../telegram/profile/kwiga-rank-db", () => ({
  computeKwigaRankSnapshot: vi.fn(),
}));

const legacyContactId = 501;
const autoContactId = 502;
const legacyTelegramId = "7000501";
const autoTelegramId = "7000502";
const legacyEmail = "legacy@example.com";
const autoEmail = "auto@example.com";
const legacyGrantEnd = new Date("2030-04-15T00:00:00.000Z");
const autoGrantEnd = new Date("2030-05-20T12:00:00.000Z");
const monthlyPlanId = 42;

function legacyPaymentRow() {
  return {
    contactId: legacyContactId,
    endAt: legacyGrantEnd,
  } as unknown as ContactProductAccess;
}

function mastersSnapshot(contactId: number) {
  return {
    rank: "masters" as const,
    accessRowCount: 1,
    contact: { id: contactId },
    candidateRank: "masters" as const,
    candidateAccessRowCount: 1,
  };
}

function proSnapshot(contactId: number) {
  return {
    rank: "pro" as const,
    accessRowCount: 2,
    contact: { id: contactId },
    candidateRank: "pro" as const,
    candidateAccessRowCount: 2,
  };
}

describe("buildPaidChatAllowlistsStepB — S2-9", () => {
  const mockPaymentRows = vi.mocked(ContactProductAccess.findAll);
  const mockAutos = vi.mocked(SubscriptionAuto.findAll);
  const mockPlan = vi.mocked(SubscriptionPlan.findByPk);
  const mockUserFindOne = vi.mocked(TelegramUser.findOne);
  const mockUserFindAll = vi.mocked(TelegramUser.findAll);
  const mockContact = vi.mocked(Contact.findByPk);
  const mockContactLookup = vi.mocked(findContactByEmailForBot);
  const mockAccess = vi.mocked(hasActiveMultimaskingAccess);
  const mockSnapshot = vi.mocked(computeKwigaRankSnapshot);

  beforeEach(() => {
    vi.clearAllMocks();
    mockAutos.mockResolvedValue([]);
    mockPlan.mockResolvedValue({
      code: MONTHLY_SUBSCRIPTION_PLAN_CODE,
    } as SubscriptionPlan);
    mockAccess.mockResolvedValue({
      hasAccess: false,
      source: null,
      grantEndAt: null,
      autoRenew: null,
      userSubscriptionPlanCode: null,
      userSubscriptionEndAt: null,
      inGracePeriod: false,
    });
  });

  it("legacy only: активний payment_hook → контакт у masters allowlist", async () => {
    mockPaymentRows.mockResolvedValue([legacyPaymentRow()]);
    mockContact.mockImplementation(async (id) => {
      if (id === legacyContactId) {
        return { id: legacyContactId, email: legacyEmail } as Contact;
      }
      return null;
    });
    mockUserFindAll.mockResolvedValue([
      { telegramId: legacyTelegramId, email: legacyEmail } as TelegramUser,
    ]);
    mockSnapshot.mockResolvedValue(mastersSnapshot(legacyContactId));

    const lists = await buildPaidChatAllowlistsStepB();

    expect(lists.masters).toEqual([
      {
        telegramId: legacyTelegramId,
        contactId: legacyContactId,
        rank: "masters",
        grantEndAt: legacyGrantEnd,
      },
    ]);
    expect(lists.catPro).toEqual([]);
    expect(isTelegramIdOnPaidChatAllowlistStepB(legacyTelegramId, "masters", lists)).toBe(
      true,
    );
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("subscription_auto Active + grant (без активного payment_hook) → контакт у allowlist", async () => {
    mockPaymentRows.mockResolvedValue([]);
    mockAutos.mockResolvedValue([
      {
        userId: autoTelegramId,
        planId: monthlyPlanId,
        wayforpayStatus: "Active",
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);
    mockUserFindOne.mockResolvedValue({
      telegramId: autoTelegramId,
      email: autoEmail,
    } as TelegramUser);
    mockContactLookup.mockResolvedValue({
      id: autoContactId,
      email: autoEmail,
    } as Awaited<ReturnType<typeof findContactByEmailForBot>>);
    mockAccess.mockResolvedValue({
      hasAccess: true,
      source: "subscription_auto",
      grantEndAt: autoGrantEnd,
      autoRenew: {
        planCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
        wayforpayStatus: "Active",
        wayforpayMode: "monthly",
        nextChargeAt: new Date("2030-04-20T09:00:00.000Z"),
        anchorOrderReference: "WFP-AUTO-ANCHOR",
      },
      userSubscriptionPlanCode: MONTHLY_SUBSCRIPTION_PLAN_CODE,
      userSubscriptionEndAt: autoGrantEnd,
      inGracePeriod: false,
    });
    mockContact.mockImplementation(async (id) => {
      if (id === autoContactId) {
        return { id: autoContactId, email: autoEmail } as Contact;
      }
      return null;
    });
    mockUserFindAll.mockResolvedValue([
      { telegramId: autoTelegramId, email: autoEmail } as TelegramUser,
    ]);
    mockSnapshot.mockResolvedValue(proSnapshot(autoContactId));

    const lists = await buildPaidChatAllowlistsStepB();

    expect(mockAccess).toHaveBeenCalledWith(autoContactId, autoTelegramId);
    expect(lists.masters).toEqual([
      {
        telegramId: autoTelegramId,
        contactId: autoContactId,
        rank: "pro",
        grantEndAt: autoGrantEnd,
      },
    ]);
    expect(lists.catPro).toEqual([
      {
        telegramId: autoTelegramId,
        contactId: autoContactId,
        rank: "pro",
        grantEndAt: autoGrantEnd,
      },
    ]);
    expect(isTelegramIdOnPaidChatAllowlistStepB(autoTelegramId, "catPro", lists)).toBe(true);
  });
});
