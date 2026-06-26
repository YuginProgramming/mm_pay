/**
 * List Chat PRO members verified via Bot API `getChatMember` (excludes owner and admins).
 * Writes `debug/pro-all.md`.
 *
 * Candidate telegram ids: union of paid_chat_member_state, bot users, payment history, allowlist.
 * Telegram does not expose a full member list — only known ids are probed.
 *
 *   npx ts-node debug/generate-pro-all.ts
 *   npx ts-node debug/generate-pro-all.ts --chat-id=-1001234567890
 *   npm run debug:generate-pro-all
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingString, getPosterProGroupId } from "../database/app-settings-queries";
import { sequelize } from "../database/db";
import { PaidChatMemberState } from "../database/PaidChatMemberState";
import { TelegramUser } from "../database/TelegramUser";
import {
  getSubscriptionStatusForUserId,
  type SubscriptionStatusValue,
  type SubscriptionStatusView,
} from "../payment/subscription-status.service";
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
  rawGetChatMemberInfo,
  rawGetChatMemberCount,
} from "../telegram/paid-chat-janitor/telegram-bot-raw";

const OUTPUT_PATH = path.resolve(__dirname, "pro-all.md");

const IN_CHAT_STATUSES = new Set(["member", "restricted"]);

function parseChatIdArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--chat-id="));
  if (!arg) {
    return null;
  }
  const n = Number(arg.slice("--chat-id=".length).trim());
  return Number.isFinite(n) ? n : null;
}

async function resolveCatProChatId(): Promise<number> {
  const fromArg = parseChatIdArg();
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
    console.warn("[generate-pro-all]", w);
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

async function collectCandidateTelegramIds(catProChatId: number): Promise<string[]> {
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

function formatShortDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function planLabel(planCode: string | null): string {
  if (!planCode) {
    return "No active plan";
  }
  if (planCode === "monthly_1m") {
    return "Monthly plan";
  }
  if (planCode === "yearly_12m") {
    return "Yearly plan";
  }
  if (planCode === "subscription_auto") {
    return "Subscription auto plan";
  }
  return `Plan: ${planCode}`;
}

function statusHeadline(status: SubscriptionStatusValue): string {
  switch (status) {
    case "active":
      return "Subscription is current";
    case "inactive":
      return "No subscription on record";
    case "lapsed":
      return "Subscription lapsed";
    case "canceled":
      return "Subscription canceled";
  }
}

function renewLine(status: SubscriptionStatusView): string {
  if (status.status === "inactive") {
    return "No subscription history; cannot renew";
  }
  if (status.canRenew) {
    return "Has subscription history; can renew";
  }
  return "Cannot renew";
}

function formatUsername(username: string | null | undefined): string {
  const trimmed = username?.trim();
  if (!trimmed) {
    return "(no username)";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function formatUserBlock(args: {
  index: number;
  telegramId: string;
  username: string | null | undefined;
  memberStatus: string;
  status: SubscriptionStatusView;
}): string {
  const { index, telegramId, username, memberStatus, status } = args;
  const lines = [
    `${index}. Telegram id: ${telegramId}`,
    `Username: ${formatUsername(username)}`,
    `Chat member status: ${memberStatus}`,
    statusHeadline(status.status),
    planLabel(status.planCode),
  ];

  const started = formatShortDate(status.startAtIso);
  const ends = formatShortDate(status.endAtIso);
  if (started) {
    lines.push(`Started ${started}`);
  }
  if (ends) {
    lines.push(`Ends ${ends}`);
  }

  lines.push(`~${status.daysLeft} days of access left`);
  lines.push(renewLine(status));

  if (status.autoRenew) {
    const nextCharge = formatShortDate(status.nextChargeAt);
    lines.push(`Auto-renew: on${nextCharge ? ` (next charge ${nextCharge})` : ""}`);
  }

  return lines.join("\n");
}

async function maybeDelay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const delayMs = (() => {
    const raw = process.env.PAID_CHAT_JANITOR_MS_DELAY?.trim();
    const n = raw ? Number(raw) : 50;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
  })();

  await sequelize.authenticate();

  const catProChatId = await resolveCatProChatId();
  const memberCount = await rawGetChatMemberCount(token, catProChatId);
  const candidates = await collectCandidateTelegramIds(catProChatId);

  console.log(
    `[generate-pro-all] chat ${catProChatId} · memberCount=${memberCount ?? "?"} · probing ${candidates.length} candidate ids`,
  );

  const members: Array<{
    telegramId: string;
    username: string | null;
    memberStatus: string;
  }> = [];

  let skippedAdmin = 0;
  let skippedBot = 0;
  let skippedNotInChat = 0;

  for (const telegramId of candidates) {
    const uid = parseUserId(telegramId);
    if (uid == null) {
      continue;
    }

    const info = await rawGetChatMemberInfo(token, catProChatId, uid);
    await maybeDelay(delayMs);

    if (!info) {
      skippedNotInChat += 1;
      continue;
    }

    if (isChatAdminStatus(info.status)) {
      skippedAdmin += 1;
      continue;
    }

    if (!IN_CHAT_STATUSES.has(info.status)) {
      skippedNotInChat += 1;
      continue;
    }

    if (info.user.is_bot) {
      skippedBot += 1;
      continue;
    }

    const dbUser = await TelegramUser.findOne({
      where: { telegramId },
      attributes: ["username"],
    });

    members.push({
      telegramId,
      username: info.user.username ?? dbUser?.username ?? null,
      memberStatus: info.status,
    });
  }

  members.sort((a, b) => a.telegramId.localeCompare(b.telegramId));

  const blocks: string[] = [];
  for (let i = 0; i < members.length; i += 1) {
    const member = members[i]!;
    const status = await getSubscriptionStatusForUserId(member.telegramId);
    blocks.push(
      formatUserBlock({
        index: i + 1,
        telegramId: member.telegramId,
        username: member.username,
        memberStatus: member.memberStatus,
        status,
      }),
    );
  }

  const generatedAt = new Date().toISOString();
  const content = [
    "# Chat PRO members (Bot API)",
    "",
    `Generated: ${generatedAt}`,
    `Chat id: ${catProChatId}`,
    `Telegram member count: ${memberCount ?? "unknown"}`,
    `Listed (non-admin, non-bot, verified via getChatMember): ${members.length}`,
    `Candidates probed: ${candidates.length}`,
    `Skipped: admin/owner ${skippedAdmin}, not in chat ${skippedNotInChat}, bot ${skippedBot}`,
    "",
    "Source: Bot API getChatMember for known telegram ids (owner and administrators excluded).",
    "Note: Telegram Bot API cannot list all members; ids not in the database may be missing.",
    "",
    ...blocks.flatMap((block, i) => (i === 0 ? [block] : ["", block])),
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  console.log(`Wrote ${members.length} members to ${OUTPUT_PATH}`);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
