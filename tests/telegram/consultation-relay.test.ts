import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerRelayHandlers } from "../../telegram/consultation/relay-handlers";
import { ConsultationCase } from "../../database/ConsultationCase";

vi.mock("../../database/ConsultationCase", () => ({
  ConsultationCase: {
    findOne: vi.fn(),
  },
}));

type MessageHandler = (ctx: any) => Promise<void>;

function setupBotAndHandler(): MessageHandler {
  let messageHandler: MessageHandler | null = null;
  const bot = {
    on: vi.fn((event: string, handler: MessageHandler) => {
      if (event === "message") messageHandler = handler;
    }),
  };
  registerRelayHandlers(bot as any);
  if (!messageHandler) {
    throw new Error("message handler was not registered");
  }
  return messageHandler;
}

function managerCtx(input: {
  text: string;
  threadId?: number;
  managerChatId?: number;
  fromId?: number;
}) {
  const managerChatId = input.managerChatId ?? -1003907688133;
  return {
    message: {
      from: { id: input.fromId ?? 501, is_bot: false },
      chat: { id: managerChatId, type: "supergroup" },
      message_thread_id: input.threadId,
      text: input.text,
      message_id: 42,
    },
    botInfo: { id: 999999 },
    telegram: {
      sendMessage: vi.fn(),
      copyMessage: vi.fn(),
    },
    reply: vi.fn(),
  };
}

function clientCtx(input: { text: string; userId?: number; chatId?: number }) {
  const chatId = input.chatId ?? input.userId ?? 6956239629;
  return {
    message: {
      from: { id: input.userId ?? 6956239629, is_bot: false },
      chat: { id: chatId, type: "private" },
      text: input.text,
      message_id: 73,
    },
    botInfo: { id: 999999 },
    telegram: {
      sendMessage: vi.fn(),
      copyMessage: vi.fn(),
    },
    reply: vi.fn(),
  };
}

describe("consultation relay handlers", () => {
  const findOne = vi.mocked(ConsultationCase.findOne);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONSULTATION_MANAGER_CHAT_ID = "-1003907688133";
  });

  it("does not relay manager message when topic is not mapped to a case", async () => {
    findOne.mockResolvedValue(null);
    const handler = setupBotAndHandler();
    const ctx = managerCtx({ text: "Привіт клієнту", threadId: 999 });

    await handler(ctx);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          managerChatId: "-1003907688133",
          messageThreadId: "999",
        },
      }),
    );
    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("relays manager text to client when chat and thread match case", async () => {
    const update = vi.fn();
    findOne.mockResolvedValue({
      consultationId: "manual-6956239629-1778248641197",
      telegramChatId: "6956239629",
      status: "ACTIVE_CONVERSATION",
      update,
    } as any);
    const handler = setupBotAndHandler();
    const ctx = managerCtx({ text: "Привіт", threadId: 93 });

    await handler(ctx);

    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith("6956239629", "[Manager] Привіт");
    expect(update).toHaveBeenCalledWith({ status: "WAITING_CLIENT" });
  });

  it("ignores manager message without thread id", async () => {
    const handler = setupBotAndHandler();
    const ctx = managerCtx({ text: "Без теми", threadId: undefined });

    await handler(ctx);

    expect(findOne).not.toHaveBeenCalled();
    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("relays client text to manager topic when active case exists", async () => {
    const update = vi.fn();
    findOne.mockResolvedValue({
      consultationId: "manual-6956239629-1778248641197",
      telegramChatId: "6956239629",
      managerChatId: "-1003907688133",
      messageThreadId: "93",
      status: "ACTIVE_CONVERSATION",
      update,
    } as any);
    const handler = setupBotAndHandler();
    const ctx = clientCtx({ text: "Підкажіть, будь ласка", userId: 6956239629 });

    await handler(ctx);

    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(
      -1003907688133,
      "[Client] Підкажіть, будь ласка",
      { message_thread_id: 93 },
    );
    expect(update).toHaveBeenCalledWith({ status: "WAITING_MANAGER" });
  });

  it("does not relay client message when there is no active case", async () => {
    findOne.mockResolvedValue(null);
    const handler = setupBotAndHandler();
    const ctx = clientCtx({ text: "Є хтось?" });

    await handler(ctx);

    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
