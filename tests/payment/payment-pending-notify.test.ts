import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyPendingProcessingIfFirstTime,
  sendDuePendingReminderAlerts,
  sendDuePendingTimeoutAlerts,
} from "../../payment/payment-pending-notify";
import { WayforpayPendingNotice } from "../../database/WayforpayPendingNotice";
import { sendTelegramBotMessage } from "../../payment/telegram-notify";

vi.mock("../../database/WayforpayPendingNotice", () => ({
  WayforpayPendingNotice: {
    findByPk: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findAll: vi.fn(),
  },
}));

vi.mock("../../payment/telegram-notify", () => ({
  sendTelegramBotMessage: vi.fn(),
}));

describe("payment pending notify", () => {
  const findByPk = vi.mocked(WayforpayPendingNotice.findByPk);
  const create = vi.mocked(WayforpayPendingNotice.create);
  const update = vi.mocked(WayforpayPendingNotice.update);
  const findAll = vi.mocked(WayforpayPendingNotice.findAll);
  const notify = vi.mocked(sendTelegramBotMessage);

  beforeEach(() => {
    vi.clearAllMocks();
    findByPk.mockResolvedValue(null);
    create.mockResolvedValue({} as never);
    update.mockResolvedValue([1] as never);
    findAll.mockResolvedValue([] as never);
  });

  it("sends first pending message only once per order", async () => {
    await notifyPendingProcessingIfFirstTime({
      orderReference: "ord-1",
      chatId: "12345",
      transactionStatus: "Pending",
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Статус оплати: Оплата обробляється."),
    );
  });

  it("does not send duplicate first pending message", async () => {
    findByPk.mockResolvedValue({
      chatId: "12345",
      save: vi.fn(),
    } as never);
    update.mockResolvedValueOnce([0] as never);
    update.mockResolvedValueOnce([0] as never);

    await notifyPendingProcessingIfFirstTime({
      orderReference: "ord-1",
      chatId: "12345",
      transactionStatus: "Pending",
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("sends reminder and timeout messages for due pending orders", async () => {
    findAll.mockResolvedValue([
      { orderReference: "ord-r1", firstPendingAt: new Date("2026-01-01T00:00:00.000Z") },
      { orderReference: "ord-t1", firstPendingAt: new Date("2026-01-01T00:00:00.000Z") },
    ] as never);
    findByPk.mockResolvedValue({
      orderReference: "ord-r1",
      chatId: "321",
      terminalStatusAt: null,
    } as never);
    update.mockResolvedValue([1] as never);

    await sendDuePendingReminderAlerts(new Date("2026-01-01T00:05:00.000Z"));
    await sendDuePendingTimeoutAlerts(new Date("2026-01-01T00:20:00.000Z"));

    expect(notify).toHaveBeenCalled();
  });
});
