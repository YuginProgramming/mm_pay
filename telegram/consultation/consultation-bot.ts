import "dotenv/config";
import { Telegraf } from "telegraf";
import { registerDisplayNameHandlers } from "./display-name-handlers";
import { DEFAULT_CONSULTATION_LANDING_URL } from "./content";
import { registerMenuHandlers } from "./menu-handlers";
import { registerIntakeHandlers } from "./intake-handlers";
import { registerRelayHandlers } from "./relay-handlers";
import { consultationDebug } from "./debug-log";
import { registerConsultationTraceHandlers } from "./trace-handlers";

const token = process.env.CONSULTATION_BOT_TOKEN;

if (!token) {
  throw new Error(
    "CONSULTATION_BOT_TOKEN is not set. Add it to the environment (e.g. .env).",
  );
}

const landingUrl =
  process.env.CONSULTATION_LANDING_URL?.trim() || DEFAULT_CONSULTATION_LANDING_URL;
const accountBotUrl = "https://t.me/multimasking_account_bot";
const managerChatIdRaw = process.env.CONSULTATION_MANAGER_CHAT_ID?.trim() || "";

export const consultationBot = new Telegraf(token);
consultationBot.catch((err, ctx) => {
  const fromId = ctx?.from?.id ?? null;
  const chatId = ctx?.chat?.id ?? null;
  consultationDebug("error.update_handler", {
    fromId,
    chatId,
    updateType: ctx?.updateType ?? "unknown",
    error: err instanceof Error ? err.message : String(err),
  });
  console.error("[consultation] unhandled bot error:", err);
});

const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
] as const;

registerMenuHandlers(consultationBot, { accountBotUrl, landingUrl });
registerDisplayNameHandlers(consultationBot);
registerIntakeHandlers(consultationBot);
registerRelayHandlers(consultationBot);
registerConsultationTraceHandlers(consultationBot, token, {
  enableAddTopicCommand: true,
  consolePrefix: "[consultation-main-trace]",
});

function parseManagerChatIdStrict(raw: string): number {
  if (!raw) {
    throw new Error(
      "CONSULTATION_MANAGER_CHAT_ID is not set. Configure manager forum supergroup chat ID in .env.",
    );
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `CONSULTATION_MANAGER_CHAT_ID is invalid: "${raw}". Expected numeric Telegram chat ID.`,
    );
  }
  return n;
}

async function assertManagerGroupReady(managerChatId: number): Promise<void> {
  const chat = await consultationBot.telegram.getChat(managerChatId);
  const chatType = (chat as { type?: string }).type ?? "unknown";
  if (chatType !== "supergroup") {
    throw new Error(
      `CONSULTATION_MANAGER_CHAT_ID=${managerChatId} must point to a supergroup, got "${chatType}".`,
    );
  }
  const isForum = (chat as { is_forum?: boolean }).is_forum;
  if (isForum !== true) {
    throw new Error(
      `Manager supergroup ${managerChatId} is not configured as a forum (topics enabled).`,
    );
  }
}

export async function launchConsultationBot(): Promise<void> {
  const managerChatId = parseManagerChatIdStrict(managerChatIdRaw);
  await assertManagerGroupReady(managerChatId);
  consultationDebug("startup.init", {
    hasLandingUrl: Boolean(landingUrl),
    managerChatId,
    allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES],
  });
  await consultationBot.telegram.setMyCommands([
    { command: "start", description: "Головне меню" },
    { command: "cancel", description: "Скинути й вийти" },
  ]);

  await consultationBot.launch({ allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] });
  console.log("Consultation Telegram bot started (polling)");
  consultationDebug("startup.ready", { mode: "polling" });

  process.once("SIGINT", () => consultationBot.stop("SIGINT"));
  process.once("SIGTERM", () => consultationBot.stop("SIGTERM"));
}
