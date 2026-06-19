/**
 * S2-7: Approved webhook fixture → payment_hook + mocked Kwiga POST (integration).
 * Run: npm test -- tests/payment/grant-multimasking-kwiga-webhook.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KwigaProduct } from "../../kwiga/kwiga-types";
import { MULTIMASKING_PRODUCT_NAME } from "../../payment/multimasking-product";
import type { PaymentMetadata, WayForPayWebhookPayload } from "../../payment/payment.types";
import { processApprovedMultimaskingPayment } from "../../payment/grant-multimasking-access";

vi.mock("../../database/ContactProductAccess", () => ({
  ContactProductAccess: {
    findOne: vi.fn(),
    create: vi.fn(),
    findAll: vi.fn(),
  },
}));

vi.mock("../../database/TelegramUser", () => ({
  TelegramUser: {
    findOne: vi.fn(),
  },
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

const mockGrantFindOne = vi.fn();
const mockGrantCreate = vi.fn();
const mockGrantUpdate = vi.fn();

vi.mock("../../database/KwigaPurchaseGrant", () => ({
  KwigaPurchaseGrant: {
    findOne: (...args: unknown[]) => mockGrantFindOne(...args),
    create: (...args: unknown[]) => mockGrantCreate(...args),
    update: (...args: unknown[]) => mockGrantUpdate(...args),
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
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { getPaidChatAccessDays } from "../../database/app-settings-queries";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../../telegram/profile/kwiga-rank-db";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";
import { fetchKwigaContactProducts, postKwigaPurchase } from "../../kwiga/kwiga-api-client";
import { syncKwigaContactProductsToDb } from "../../database/sync-from-kwiga";

const fixturePath = path.join(
  __dirname,
  "fixtures",
  "approved-multimasking-webhook.json",
);
const webhookFixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as WayForPayWebhookPayload;

const metadata: PaymentMetadata = {
  chatId: "999001337",
  courseName: MULTIMASKING_PRODUCT_NAME,
};

const mockAccessFindOne = vi.mocked(ContactProductAccess.findOne);
const mockAccessCreate = vi.mocked(ContactProductAccess.create);
const mockTelegramFindOne = vi.mocked(TelegramUser.findOne);
const mockFindContact = vi.mocked(findContactByEmailForBot);
const mockAccessDays = vi.mocked(getPaidChatAccessDays);
const mockRankSnapshot = vi.mocked(computeKwigaRankSnapshot);
const mockPersistRank = vi.mocked(persistKwigaRankSnapshot);
const mockTelegramSend = vi.mocked(sendTelegramBotMessage);
const mockFetchProducts = vi.mocked(fetchKwigaContactProducts);
const mockPostPurchase = vi.mocked(postKwigaPurchase);
const mockSyncLocal = vi.mocked(syncKwigaContactProductsToDb);

function kwigaProduct(id: number, endAt: string, offerId: number): KwigaProduct {
  return {
    id,
    title: `Course ${id}`,
    subscriptions: [{ id: id * 10, offer_id: offerId, end_at: endAt, is_active: true }],
  };
}

function mastersSnapshot() {
  return {
    rank: "masters" as const,
    accessRowCount: 2,
    contact: { id: 7 },
    candidateRank: "masters" as const,
    candidateAccessRowCount: 2,
  };
}

describe("processApprovedMultimaskingPayment — webhook + Kwiga integration (S2-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAccessFindOne.mockResolvedValue(null);
    mockAccessCreate.mockResolvedValue({} as never);
    mockTelegramFindOne.mockResolvedValue({
      telegramId: metadata.chatId,
      email: "user@example.com",
    } as never);
    mockFindContact.mockResolvedValue({
      id: 7,
      externalId: 42,
      email: "user@example.com",
    } as never);
    mockAccessDays.mockResolvedValue(30);
    mockRankSnapshot.mockResolvedValue(mastersSnapshot());
    mockPersistRank.mockResolvedValue(undefined);
    mockTelegramSend.mockResolvedValue(undefined);
    mockFetchProducts.mockResolvedValue([
      kwigaProduct(1, "2026-01-01T00:00:00.000Z", 548416),
    ]);
    mockPostPurchase.mockResolvedValue(undefined);
    mockSyncLocal.mockResolvedValue(undefined);
    mockGrantFindOne.mockResolvedValue(null);
    mockGrantCreate.mockResolvedValue({});
    mockGrantUpdate.mockResolvedValue([1]);
  });

  it("creates payment_hook then posts to Kwiga once", async () => {
    const callOrder: string[] = [];
    mockAccessCreate.mockImplementation(async () => {
      callOrder.push("payment_hook");
      return {} as never;
    });
    mockPostPurchase.mockImplementation(async () => {
      callOrder.push("kwiga_post");
    });
    mockRankSnapshot.mockImplementation(async () => {
      callOrder.push("rank_snapshot");
      return mastersSnapshot();
    });

    const result = await processApprovedMultimaskingPayment(webhookFixture, metadata);

    expect(result.granted).toBe(true);
    expect(mockAccessCreate).toHaveBeenCalledTimes(1);
    expect(mockAccessCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 7,
        source: "payment_hook",
        wayforpayOrderReference: webhookFixture.orderReference,
      }),
    );
    expect(mockPostPurchase).toHaveBeenCalledTimes(1);
    expect(mockPostPurchase).toHaveBeenCalledWith({
      email: "user@example.com",
      offerId: 548416,
      comment: `Bot group payment prolongation; orderReference=${webhookFixture.orderReference}`,
    });
    expect(mockRankSnapshot).toHaveBeenCalledTimes(2);
    expect(callOrder.indexOf("payment_hook")).toBeLessThan(callOrder.indexOf("kwiga_post"));
    expect(callOrder.indexOf("kwiga_post")).toBeLessThan(
      callOrder.lastIndexOf("rank_snapshot"),
    );
    expect(mockGrantCreate).toHaveBeenCalledWith({
      wayforpayOrderReference: webhookFixture.orderReference,
      contactId: 7,
      status: "pending",
    });
  });

  it("duplicate webhook skips payment_hook and Kwiga POST", async () => {
    mockAccessFindOne.mockResolvedValue({ id: 99 } as never);

    const result = await processApprovedMultimaskingPayment(webhookFixture, metadata);

    expect(result).toEqual({ granted: false });
    expect(mockAccessCreate).not.toHaveBeenCalled();
    expect(mockPostPurchase).not.toHaveBeenCalled();
    expect(mockRankSnapshot).not.toHaveBeenCalled();
  });

  it("keeps group grant when Kwiga POST fails", async () => {
    mockPostPurchase.mockRejectedValue(new Error("Kwiga 503"));

    const result = await processApprovedMultimaskingPayment(webhookFixture, metadata);

    expect(result.granted).toBe(true);
    expect(mockAccessCreate).toHaveBeenCalledTimes(1);
    expect(mockPostPurchase).toHaveBeenCalledTimes(1);
    expect(mockRankSnapshot).toHaveBeenCalledTimes(2);
    expect(mockTelegramSend).toHaveBeenCalled();
  });
});
