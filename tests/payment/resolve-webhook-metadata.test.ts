/**
 * Recurring `*_WFPREG-*` webhooks omit products[] and pending rows.
 * Run: npm test -- tests/payment/resolve-webhook-metadata.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIMASKING_PRODUCT_NAME } from "../../payment/multimasking-product";

vi.mock("../../payment/pending-orders", () => ({
  peekPendingOrder: vi.fn(),
  putPendingOrder: vi.fn(),
  takePendingOrder: vi.fn(),
}));

vi.mock("../../payment/client", () => ({
  createInvoice: vi.fn(),
}));

vi.mock("../../payment/payment.config", () => ({
  default: {
    merchantAccount: "test",
    merchantSecret: "test",
    merchantDomainName: "test",
    serviceUrl: "http://localhost/wayforpay/webhook",
    currency: "UAH",
  },
  getWayforpayMerchantPassword: vi.fn(() => "secret"),
}));

vi.mock("../../database/SubscriptionPaymentOrder", () => ({
  SubscriptionPaymentOrder: { findOne: vi.fn() },
}));

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: { findOne: vi.fn() },
}));

import { peekPendingOrder } from "../../payment/pending-orders";
import { SubscriptionPaymentOrder } from "../../database/SubscriptionPaymentOrder";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { resolveWebhookMetadata } from "../../payment/payment.service";
import type { WayForPayWebhookPayload } from "../../payment/payment.types";

const mockPeek = vi.mocked(peekPendingOrder);
const mockOrderFind = vi.mocked(SubscriptionPaymentOrder.findOne);
const mockAutoFind = vi.mocked(SubscriptionAuto.findOne);

const PARENT = "724974d3-81ea-4e5e-b6ed-fae803189185";
const WFPREG = `${PARENT}_WFPREG-528105-1`;

function payload(orderReference: string): WayForPayWebhookPayload {
  return {
    merchantAccount: "m",
    merchantSignature: "s",
    orderReference,
    amount: 500,
    currency: "UAH",
    authCode: "980408",
    cardPan: "51****6520",
    transactionStatus: "Approved",
    reasonCode: 1100,
  };
}

describe("resolveWebhookMetadata (WFPREG)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPeek.mockResolvedValue(null);
    mockOrderFind.mockResolvedValue(null);
    mockAutoFind.mockResolvedValue(null);
  });

  it("resolves chatId from subscription_payment_orders parent UUID", async () => {
    mockOrderFind.mockResolvedValue({ userId: "769960607" } as never);

    const meta = await resolveWebhookMetadata(payload(WFPREG));

    expect(meta).toEqual({
      courseName: MULTIMASKING_PRODUCT_NAME,
      chatId: "769960607",
      flowType: "legacy_course",
    });
    expect(mockPeek).toHaveBeenCalledWith(WFPREG);
    expect(mockPeek).toHaveBeenCalledWith(PARENT);
    expect(mockOrderFind).toHaveBeenCalledWith({
      where: { orderReference: PARENT },
      attributes: ["userId"],
    });
  });

  it("falls back to subscription_auto when ledger order is missing", async () => {
    mockAutoFind.mockResolvedValue({ userId: "458674178" } as never);

    const meta = await resolveWebhookMetadata(payload(WFPREG));

    expect(meta?.chatId).toBe("458674178");
    expect(mockAutoFind).toHaveBeenCalled();
  });

  it("returns null when nothing matches", async () => {
    const meta = await resolveWebhookMetadata(payload(WFPREG));
    expect(meta).toBeNull();
  });
});
