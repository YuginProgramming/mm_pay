/**
 * Renewal reminders: legacy D-7 skips recurring; subscription_auto gets charge_d3.
 *
 * Запуск: npx vitest run tests/payment/subscription-renewal-reminder.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionRenewalReminderLog } from "../../database/SubscriptionRenewalReminderLog";
import { UserSubscription } from "../../database/UserSubscription";
import { hasActiveMultimaskingRecurringAuto } from "../../payment/multimasking-access-status";
import {
  buildSubscriptionAutoChargeReminderTextUa,
  sendDueSubscriptionRenewalReminders,
} from "../../payment/subscription-renewal-reminder";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";
import { subscriptionFlags } from "../../payment/subscription-flags";

vi.mock("../../database/SubscriptionRenewalReminderLog", () => ({
  SubscriptionRenewalReminderLog: {
    create: vi.fn(),
  },
}));

vi.mock("../../database/UserSubscription", () => ({
  UserSubscription: {
    findAll: vi.fn(),
  },
}));

vi.mock("../../database/SubscriptionAuto", () => ({
  SubscriptionAuto: {
    findAll: vi.fn(),
  },
}));

vi.mock("../../payment/multimasking-access-status", () => ({
  hasActiveMultimaskingRecurringAuto: vi.fn(),
}));

vi.mock("../../payment/telegram-notify", () => ({
  sendTelegramBotMessage: vi.fn(),
}));

describe("sendDueSubscriptionRenewalReminders", () => {
  const findLegacy = vi.mocked(UserSubscription.findAll);
  const findAuto = vi.mocked(SubscriptionAuto.findAll);
  const createLog = vi.mocked(SubscriptionRenewalReminderLog.create);
  const mockRecurring = vi.mocked(hasActiveMultimaskingRecurringAuto);
  const notify = vi.mocked(sendTelegramBotMessage);

  const now = new Date("2026-06-03T12:00:00.000Z");
  const endAt = new Date("2026-06-10T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionFlags.subscriptionRenewalJobsEnabled = true;
    createLog.mockResolvedValue({} as never);
    mockRecurring.mockResolvedValue(false);
    findAuto.mockResolvedValue([]);
    findLegacy.mockResolvedValue([]);
  });

  it("skips legacy reminder when user has active subscription_auto recurring", async () => {
    findLegacy.mockResolvedValue([
      {
        id: 1,
        userId: "269694206",
        endAt,
        status: "active",
      } as UserSubscription,
    ]);
    mockRecurring.mockResolvedValue(true);

    await sendDueSubscriptionRenewalReminders(now);

    expect(mockRecurring).toHaveBeenCalledWith("269694206");
    expect(createLog).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends D-7 reminder for legacy user_subscriptions without recurring auto", async () => {
    findLegacy.mockResolvedValue([
      {
        id: 2,
        userId: "111222333",
        endAt,
        status: "active",
      } as UserSubscription,
    ]);

    await sendDueSubscriptionRenewalReminders(now);

    expect(mockRecurring).toHaveBeenCalledWith("111222333");
    expect(createLog).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "111222333",
      expect.stringContaining("залишилось 7 дн."),
    );
  });

  it("sends charge_d3 for active subscription_auto three days before nextChargeAt", async () => {
    const nextChargeAt = new Date("2026-06-06T09:00:00.000Z");
    findAuto.mockResolvedValue([
      {
        id: 42,
        userId: "555",
        nextChargeAt,
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(now);

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "555",
        subscriptionId: 42,
        alertType: "charge_d3",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      "555",
      expect.stringContaining("/unsubscribe"),
    );
    expect(notify).toHaveBeenCalledWith(
      "555",
      buildSubscriptionAutoChargeReminderTextUa(nextChargeAt),
    );
  });

  it("does not send charge reminder on D-1 or D-7", async () => {
    findAuto.mockResolvedValue([
      {
        id: 43,
        userId: "556",
        nextChargeAt: new Date("2026-06-04T09:00:00.000Z"),
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
      {
        id: 44,
        userId: "557",
        nextChargeAt: new Date("2026-06-10T09:00:00.000Z"),
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(now);

    expect(createLog).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
