/**
 * Renewal reminders: legacy D-7 skips recurring; subscription_auto gets charge_d1 (Kyiv).
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
  formatChargeReminderPriceUah,
  isKyivCalendarDayBefore,
  isKyivWorkingHours,
  kyivCalendarDateKey,
  sendDueSubscriptionRenewalReminders,
} from "../../payment/subscription-renewal-reminder";
import {
  MANAGE_SUBSCRIPTION_BUTTON_TEXT,
  sendTelegramBotMessage,
  UNSUBSCRIBE_MANAGE_CALLBACK,
} from "../../payment/telegram-notify";
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

vi.mock("../../payment/telegram-notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../payment/telegram-notify")>();
  return {
    ...actual,
    sendTelegramBotMessage: vi.fn(),
  };
});

describe("Kyiv charge-reminder helpers", () => {
  it("treats 10:00 Kyiv as working hours and 03:19 / 18:00 as outside", () => {
    expect(isKyivWorkingHours(new Date("2026-06-03T07:00:00.000Z"))).toBe(true);
    expect(isKyivWorkingHours(new Date("2026-06-03T00:19:00.000Z"))).toBe(false);
    expect(isKyivWorkingHours(new Date("2026-06-03T15:00:00.000Z"))).toBe(false);
  });

  it("detects Kyiv calendar D-1 vs nextChargeAt", () => {
    const now = new Date("2026-06-03T07:00:00.000Z");
    const nextDay = new Date("2026-06-04T00:00:00.000Z");
    const sameDay = new Date("2026-06-03T12:00:00.000Z");
    const inThreeDays = new Date("2026-06-06T09:00:00.000Z");
    expect(isKyivCalendarDayBefore(now, nextDay)).toBe(true);
    expect(isKyivCalendarDayBefore(now, sameDay)).toBe(false);
    expect(isKyivCalendarDayBefore(now, inThreeDays)).toBe(false);
  });
});

describe("charge reminder copy", () => {
  it("uses monthly 500 грн, italic footer, and no old /unsubscribe sentence", () => {
    const text = buildSubscriptionAutoChargeReminderTextUa(500);
    expect(text).toContain("Невелике нагадування від Multimasking");
    expect(text).toContain("списано 500 грн");
    expect(text).toContain("списання на 500 грн за підписку");
    expect(text).toContain("<i>");
    expect(text).toContain("</i>");
    expect(text).not.toContain("/unsubscribe");
  });

  it("interpolates yearly plan price", () => {
    expect(buildSubscriptionAutoChargeReminderTextUa("4800.00")).toContain("4800 грн");
    expect(formatChargeReminderPriceUah("4800.00")).toBe("4800");
  });
});

describe("sendDueSubscriptionRenewalReminders", () => {
  const findLegacy = vi.mocked(UserSubscription.findAll);
  const findAuto = vi.mocked(SubscriptionAuto.findAll);
  const createLog = vi.mocked(SubscriptionRenewalReminderLog.create);
  const mockRecurring = vi.mocked(hasActiveMultimaskingRecurringAuto);
  const notify = vi.mocked(sendTelegramBotMessage);

  const now = new Date("2026-06-03T12:00:00.000Z");
  const endAt = new Date("2026-06-10T00:00:00.000Z");
  const d1Working = new Date("2026-06-03T07:00:00.000Z");
  const d1Night = new Date("2026-06-03T00:19:00.000Z");
  const nextChargeAtD1 = new Date("2026-06-04T00:00:00.000Z");

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

  it("sends charge_d1 on Kyiv D-1 during working hours", async () => {
    findAuto.mockResolvedValue([
      {
        id: 42,
        userId: "555",
        nextChargeAt: nextChargeAtD1,
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(d1Working);

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "555",
        subscriptionId: 42,
        alertType: "charge_d1",
        dedupeKey: `auto:42:charge_d1:${kyivCalendarDateKey(nextChargeAtD1)}`,
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      "555",
      buildSubscriptionAutoChargeReminderTextUa(500),
      undefined,
      {
        parseMode: "HTML",
        callbackButtons: [
          {
            text: MANAGE_SUBSCRIPTION_BUTTON_TEXT,
            callbackData: UNSUBSCRIBE_MANAGE_CALLBACK,
          },
        ],
      },
    );
  });

  it("uses plan price in charge_d1 copy when present", async () => {
    findAuto.mockResolvedValue([
      {
        id: 42,
        userId: "555",
        nextChargeAt: nextChargeAtD1,
        autoRenewEnabled: true,
        cancelledAt: null,
        plan: { price: "4800.00" },
      } as unknown as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(d1Working);

    expect(notify).toHaveBeenCalledWith(
      "555",
      buildSubscriptionAutoChargeReminderTextUa("4800.00"),
      undefined,
      expect.objectContaining({ parseMode: "HTML" }),
    );
  });

  it("does not send charge reminder on D-1 outside Kyiv working hours", async () => {
    findAuto.mockResolvedValue([
      {
        id: 43,
        userId: "556",
        nextChargeAt: nextChargeAtD1,
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(d1Night);

    expect(createLog).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not send charge reminder on D-3 or charge day", async () => {
    findAuto.mockResolvedValue([
      {
        id: 44,
        userId: "557",
        nextChargeAt: new Date("2026-06-06T09:00:00.000Z"),
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
      {
        id: 45,
        userId: "558",
        nextChargeAt: new Date("2026-06-03T12:00:00.000Z"),
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);

    await sendDueSubscriptionRenewalReminders(d1Working);

    expect(createLog).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends charge_d1 again when nextChargeAt moves to a new Kyiv day", async () => {
    const firstCharge = new Date("2026-06-04T00:00:00.000Z");
    const secondCharge = new Date("2026-07-04T00:00:00.000Z");
    const secondD1Working = new Date("2026-07-03T07:00:00.000Z");

    findAuto.mockResolvedValue([
      {
        id: 42,
        userId: "555",
        nextChargeAt: firstCharge,
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);
    await sendDueSubscriptionRenewalReminders(d1Working);

    findAuto.mockResolvedValue([
      {
        id: 42,
        userId: "555",
        nextChargeAt: secondCharge,
        autoRenewEnabled: true,
        cancelledAt: null,
      } as SubscriptionAuto,
    ]);
    await sendDueSubscriptionRenewalReminders(secondD1Working);

    expect(createLog).toHaveBeenCalledTimes(2);
    expect(createLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        alertType: "charge_d1",
        dedupeKey: `auto:42:charge_d1:${kyivCalendarDateKey(firstCharge)}`,
      }),
    );
    expect(createLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        alertType: "charge_d1",
        dedupeKey: `auto:42:charge_d1:${kyivCalendarDateKey(secondCharge)}`,
      }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
