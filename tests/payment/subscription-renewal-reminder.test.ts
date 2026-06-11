/**
 * S3-3: renewal-reminder не шле D-7/D-3/D-1/D+1 клієнтам з активним subscription_auto.
 *
 * Запуск: npx vitest run tests/payment/subscription-renewal-reminder.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionRenewalReminderLog } from "../../database/SubscriptionRenewalReminderLog";
import { UserSubscription } from "../../database/UserSubscription";
import { hasActiveMultimaskingRecurringAuto } from "../../payment/multimasking-access-status";
import { sendDueSubscriptionRenewalReminders } from "../../payment/subscription-renewal-reminder";
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

vi.mock("../../payment/multimasking-access-status", () => ({
  hasActiveMultimaskingRecurringAuto: vi.fn(),
}));

vi.mock("../../payment/telegram-notify", () => ({
  sendTelegramBotMessage: vi.fn(),
}));

describe("sendDueSubscriptionRenewalReminders — S3-3 recurring guard", () => {
  const findAll = vi.mocked(UserSubscription.findAll);
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
  });

  it("skips reminder when user has active subscription_auto recurring", async () => {
    findAll.mockResolvedValue([
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
    findAll.mockResolvedValue([
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
});
