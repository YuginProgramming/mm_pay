import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingString, getPosterProGroupId } from "../database/app-settings-queries";
import { PaidChatMemberState } from "../database/PaidChatMemberState";
import { TelegramUser } from "../database/TelegramUser";
import {
  buildPaidChatAllowlistsStepB,
  findTelegramIdsWithAnyBotPaymentHistory,
} from "../telegram/paid-chat-janitor";
import {
  parseTelegramBotChatsJson,
  resolvePaidChatRows,
} from "../telegram/paid-chat-janitor/chats-config";
import { resolvePaidChatIdsFromAppSettings } from "../telegram/paid-chat-janitor/paid-chat-resolve-ids";
import {
  isChatAdminStatus,
  rawGetChatAdministrators,
  rawGetChatMemberInfo,
  type ChatMemberInfo,
} from "../telegram/paid-chat-janitor/telegram-bot-raw";

const IN_CHAT_STATUSES = new Set(["member", "restricted", "administrator", "creator"]);

export type ExportedChatProMember = {
  telegramId: string;
  username: string | null;
  displayName: string | null;
  memberStatus: string;
  isAdminOrOwner: boolean;
  isBot: boolean;
  email: string | null;
};

export function parseChatIdArg(argv: string[] = process.argv): number | null {
  const arg = argv.find((a) => a.startsWith("--chat-id="));
  if (!arg) {
    return null;
  }
  const n = Number(arg.slice("--chat-id=".length).trim());
  return Number.isFinite(n) ? n : null;
}

export async function resolveCatProChatId(argv: string[] = process.argv): Promise<number> {
  const fromArg = parseChatIdArg(argv);
  if (fromArg != null) {
    return fromArg;
  }

  const { catProChatId } = await resolvePaidChatIdsFromAppSettings();
  if (catProChatId != null) {
    return catProChatId;
  }

  const proGroupId = await getPosterProGroupId();
  if (proGroupId?.trim()) {
    const n = Number(proGroupId.trim());
    if (Number.isFinite(n)) {
      return n;
    }
  }

  const raw = await getAppSettingString(APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON);
  const rows = parseTelegramBotChatsJson(raw ?? "[]");
  const { catPro, warnings } = resolvePaidChatRows(rows);
  for (const w of warnings) {
    console.warn("[chat-pro-export]", w);
  }
  if (catPro?.chatId != null) {
    return catPro.chatId;
  }

  throw new Error(
    "Chat PRO chat id not found. Set telegram_bot_chats_json, poster_pro_group_id, or pass --chat-id=…",
  );
}

function parseUserId(telegramId: string): number | null {
  const n = Number.parseInt(telegramId, 10);
  return Number.isFinite(n) ? n : null;
}

export async function collectCandidateTelegramIds(catProChatId: number): Promise<string[]> {
  const ids = new Set<string>();

  const memberStateRows = await PaidChatMemberState.findAll({
    where: { chatId: String(catProChatId) },
    attributes: ["userId"],
  });
  for (const row of memberStateRows) {
    ids.add(row.userId);
  }

  for (const id of await findTelegramIdsWithAnyBotPaymentHistory()) {
    ids.add(id);
  }

  const { catPro } = await buildPaidChatAllowlistsStepB();
  for (const entry of catPro) {
    ids.add(entry.telegramId);
  }

  const botUsers = await TelegramUser.findAll({
    where: { isBot: false },
    attributes: ["telegramId"],
  });
  for (const user of botUsers) {
    ids.add(user.telegramId);
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}

function displayNameFromMember(info: ChatMemberInfo): string | null {
  const parts = [info.user.first_name, info.user.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function discoverChatProMembers(args: {
  token: string;
  catProChatId: number;
  delayMs: number;
}): Promise<{
  members: ExportedChatProMember[];
  candidatesProbed: number;
  skippedNotInChat: number;
}> {
  const { token, catProChatId, delayMs } = args;
  const candidates = await collectCandidateTelegramIds(catProChatId);

  for (const adminId of await rawGetChatAdministrators(token, catProChatId)) {
    candidates.push(String(adminId));
  }

  const uniqueCandidates = [...new Set(candidates)].sort((a, b) => a.localeCompare(b));
  const members: ExportedChatProMember[] = [];
  let skippedNotInChat = 0;

  for (const telegramId of uniqueCandidates) {
    const uid = parseUserId(telegramId);
    if (uid == null) {
      continue;
    }

    const info = await rawGetChatMemberInfo(token, catProChatId, uid);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    if (!info) {
      skippedNotInChat += 1;
      continue;
    }

    if (!IN_CHAT_STATUSES.has(info.status)) {
      skippedNotInChat += 1;
      continue;
    }

    const dbUser = await TelegramUser.findOne({
      where: { telegramId },
      attributes: ["username", "email"],
    });

    members.push({
      telegramId,
      username: info.user.username ?? dbUser?.username ?? null,
      displayName: displayNameFromMember(info),
      memberStatus: info.status,
      isAdminOrOwner: isChatAdminStatus(info.status),
      isBot: Boolean(info.user.is_bot),
      email: dbUser?.email?.trim() || null,
    });
  }

  members.sort((a, b) => a.telegramId.localeCompare(b.telegramId));
  return {
    members,
    candidatesProbed: uniqueCandidates.length,
    skippedNotInChat,
  };
}

export function csvField(value: string | number | boolean | null | undefined): string {
  if (value == null) {
    return "";
  }
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
