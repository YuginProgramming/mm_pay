/**
 * S1-5: shared renewal helper parity.
 * `extendRecurringMultimaskingAccess` must produce a renewal grant identical to the
 * webhook renewal path: stack on the active `end_at` (+plan days), source payment_hook,
 * and stay silent (no Telegram DM).
 *
 * Run: npm test -- tests/payment/extend-recurring-access.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIMASKING_PRODUCT_NAME } from "../../payment/multimasking-product";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "../../payment/subscription-plan-codes";

vi.mock("../../database/ContactProductAccess", () => ({
  ContactProductAccess: {
    findOne: vi.fn(),
    create: vi.fn(),
    findAll: vi.fn(),
  },
}));

vi.mock("../../database/TelegramUser", () => ({
  TelegramUser: { findOne: vi.fn() },
}));

vi.mock("../../database/SubscriptionPlan", () => ({
  SubscriptionPlan: { findByPk: vi.fn() },
}));

vi.mock("../../database/contact-lookup", () => ({
  findContactByEmailForBot: vi.fn(),
}));

vi.mock("../../database/app-settings-queries", () => ({
  getPaidChatAccessDays: vi.fn(),
}));

vi.mock("../../telegram/profile/kwiga-rank-db", () => ({
  computeKwigaRankSnapshot: vi.fn(),
  persistKwigaRankSnapshot: vi.fn(),
}));

vi.mock("../../payment/telegram-notify", () => ({
  sendTelegramBotMessage: vi.fn(),
}));

vi.mock("../../kwiga/kwiga-api-client", () => ({
  fetchKwigaContactProducts: vi.fn(),
  postKwigaPurchase: vi.fn(),
}));

vi.mock("../../database/sync-from-kwiga", () => ({
  syncKwigaContactProductsToDb: vi.fn(),
}));

vi.mock("../../database/KwigaPurchaseGrant", () => ({
  KwigaPurchaseGrant: {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue([1]),
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

import { ContactProductAccess } from "../../database/ContactProductAccess";
import { TelegramUser } from "../../database/TelegramUser";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { getPaidChatAccessDays } from "../../database/app-settings-queries";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../../telegram/profile/kwiga-rank-db";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";
import { fetchKwigaContactProducts } from "../../kwiga/kwiga-api-client";
import { extendRecurringMultimaskingAccess } from "../../payment/extend-recurring-access";

const mockAccessFindOne = vi.mocked(ContactProductAccess.findOne);
const mockAccessCreate = vi.mocked(ContactProductAccess.create);
const mockAccessFindAll = vi.mocked(ContactProductAccess.findAll);
const mockTelegramFindOne = vi.mocked(TelegramUser.findOne);
const mockPlanFindByPk = vi.mocked(SubscriptionPlan.findByPk);
const mockFindContact = vi.mocked(findContactByEmailForBot);
const mockAccessDays = vi.mocked(getPaidChatAccessDays);
const mockRankSnapshot = vi.mocked(computeKwigaRankSnapshot);
const mockPersistRank = vi.mocked(persistKwigaRankSnapshot);
const mockTelegramSend = vi.mocked(sendTelegramBotMessage);
const mockFetchProducts = vi.mocked(fetchKwigaContactProducts);

const USER_ID = "269694206";
const ORDER_REF = "reg-anchor123-1783229994";
const DAY_MS = 24 * 60 * 60 * 1000;

function mastersSnapshot() {
  return {
    rank: "masters" as const,
    accessRowCount: 2,
    contact: { id: 7 },
    candidateRank: "masters" as const,
    candidateAccessRowCount: 2,
  };
}

describe("extendRecurringMultimaskingAccess — renewal parity (S1-5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessFindOne.mockResolvedValue(null);
    mockAccessCreate.mockResolvedValue({} as never);
    mockAccessFindAll.mockResolvedValue([] as never);
    mockTelegramFindOne.mockResolvedValue({
      telegramId: USER_ID,
      email: "user@example.com",
    } as never);
    mockPlanFindByPk.mockResolvedValue({ code: MONTHLY_SUBSCRIPTION_PLAN_CODE } as never);
    mockFindContact.mockResolvedValue({
      id: 7,
      externalId: 42,
      email: "user@example.com",
    } as never);
    mockAccessDays.mockResolvedValue(30);
    mockRankSnapshot.mockResolvedValue(mastersSnapshot());
    mockPersistRank.mockResolvedValue(undefined);
    mockTelegramSend.mockResolvedValue(undefined);
    mockFetchProducts.mockResolvedValue([]);
  });

  it("stacks on active end_at (+plan days), source payment_hook, silent", async () => {
    const activeEnd = new Date(Date.now() + 10 * DAY_MS);
    mockAccessFindAll.mockResolvedValue([
      { endAt: activeEnd, startAt: new Date(Date.now() - 20 * DAY_MS) },
    ] as never);

    const result = await extendRecurringMultimaskingAccess({
      userId: USER_ID,
      planId: 1,
      orderReference: ORDER_REF,
      amount: 2,
      currency: "UAH",
      source: "reconciler",
    });

    expect(result.granted).toBe(true);
    expect(result.grantEndAt).toBeInstanceOf(Date);

    // stacked: activeEnd + 30 days (allow small tolerance for construction)
    const expectedEnd = new Date(activeEnd);
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 30);
    expect(result.grantEndAt!.getTime()).toBe(expectedEnd.getTime());

    expect(mockAccessCreate).toHaveBeenCalledTimes(1);
    expect(mockAccessCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 7,
        source: "payment_hook",
        wayforpayOrderReference: ORDER_REF,
        endAt: expectedEnd,
      }),
    );

    // silent: no Telegram DM from the shared helper
    expect(mockTelegramSend).not.toHaveBeenCalled();
  });

  it("is idempotent: duplicate orderReference → no second grant", async () => {
    mockAccessFindOne.mockResolvedValue({ id: 99 } as never);

    const result = await extendRecurringMultimaskingAccess({
      userId: USER_ID,
      planId: 1,
      orderReference: ORDER_REF,
      amount: 2,
      currency: "UAH",
      source: "reconciler",
    });

    expect(result.granted).toBe(false);
    expect(mockAccessCreate).not.toHaveBeenCalled();
    expect(mockTelegramSend).not.toHaveBeenCalled();
  });
});
