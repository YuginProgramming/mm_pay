import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markPendingOrderTerminal,
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
    expect(notify).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("не оплачуйте повторно"),
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

  it("sends reminder and timeout messages for due pending orders with expected copy", async () => {
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

    expect(notify).toHaveBeenCalledWith(
      "321",
      expect.stringContaining("Статус оплати: Все ще очікуємо підтвердження."),
    );
    expect(notify).toHaveBeenCalledWith(
      "321",
      expect.stringContaining("Зазвичай підтвердження надходить протягом 5-10 хвилин."),
    );
    expect(notify).toHaveBeenCalledWith(
      "321",
      expect.stringContaining("Статус оплати: Підтвердження затримується."),
    );
    expect(notify).toHaveBeenCalledWith(
      "321",
      expect.stringContaining("зверніться до підтримки"),
    );
  });

  it("suppresses reminder and timeout when order already terminal", async () => {
    findAll.mockResolvedValue([
      { orderReference: "ord-terminal", firstPendingAt: new Date("2026-01-01T00:00:00.000Z") },
    ] as never);
    findByPk.mockResolvedValue({
      orderReference: "ord-terminal",
      chatId: "321",
      terminalStatusAt: new Date("2026-01-01T00:01:00.000Z"),
    } as never);

    await sendDuePendingReminderAlerts(new Date("2026-01-01T00:05:00.000Z"));
    await sendDuePendingTimeoutAlerts(new Date("2026-01-01T00:20:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });

  it("does not send duplicate reminder/timeout stage messages", async () => {
    findAll.mockResolvedValue([
      { orderReference: "ord-dup", firstPendingAt: new Date("2026-01-01T00:00:00.000Z") },
    ] as never);
    findByPk.mockResolvedValue({
      orderReference: "ord-dup",
      chatId: "321",
      terminalStatusAt: null,
    } as never);
    update.mockResolvedValue([0] as never);

    await sendDuePendingReminderAlerts(new Date("2026-01-01T00:05:00.000Z"));
    await sendDuePendingTimeoutAlerts(new Date("2026-01-01T00:20:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });

  it("marks terminal state exactly once", async () => {
    findByPk.mockResolvedValue({
      orderReference: "ord-terminal",
      chatId: "321",
      save: vi.fn(),
    } as never);
    update.mockResolvedValue([1] as never);

    await markPendingOrderTerminal({
      orderReference: "ord-terminal",
      transactionStatus: "Approved",
    });

    expect(update).toHaveBeenCalled();
  });

  it("pending -> approved flow suppresses reminder and timeout after terminal mark", async () => {
    findByPk.mockResolvedValue({
      orderReference: "ord-chain",
      chatId: "777",
      terminalStatusAt: null,
      save: vi.fn(),
    } as never);

    await notifyPendingProcessingIfFirstTime({
      orderReference: "ord-chain",
      chatId: "777",
      transactionStatus: "Pending",
    });
    expect(notify).toHaveBeenCalledTimes(1);

    await markPendingOrderTerminal({
      orderReference: "ord-chain",
      transactionStatus: "Approved",
    });

    vi.clearAllMocks();
    findAll.mockResolvedValue([
      { orderReference: "ord-chain", firstPendingAt: new Date("2026-01-01T00:00:00.000Z") },
    ] as never);
    findByPk.mockResolvedValue({
      orderReference: "ord-chain",
      chatId: "777",
      terminalStatusAt: new Date("2026-01-01T00:01:00.000Z"),
    } as never);

    await sendDuePendingReminderAlerts(new Date("2026-01-01T00:05:00.000Z"));
    await sendDuePendingTimeoutAlerts(new Date("2026-01-01T00:20:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });
});
