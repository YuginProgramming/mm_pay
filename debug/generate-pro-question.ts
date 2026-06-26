/**
 * Members in Chat PRO (Bot API) who are NOT on the paid-chat allowlist (rank pro + active access).
 * Writes `pro-question.md` at repo root.
 *
 *   npx ts-node debug/generate-pro-question.ts
 *   npm run debug:generate-pro-question
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sequelize } from "../database/db";
import { getSubscriptionStatusForUserId } from "../payment/subscription-status.service";
import { buildPaidChatAllowlistsStepB } from "../telegram/paid-chat-janitor";
import { rawGetChatMemberCount } from "../telegram/paid-chat-janitor/telegram-bot-raw";
import {
  discoverChatProMembers,
  resolveCatProChatId,
} from "./chat-pro-member-export-lib";

const OUTPUT_PATH = path.resolve(__dirname, "..", "pro-question.md");

function formatShortDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatUsername(username: string | null | undefined): string {
  const trimmed = username?.trim();
  if (!trimmed) {
    return "(no username)";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function subscriptionStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Subscription is current";
    case "inactive":
      return "No subscription on record";
    case "lapsed":
      return "Subscription lapsed";
    case "canceled":
      return "Subscription canceled";
    default:
      return status;
  }
}

function formatEntryBlock(args: {
  index: number;
  telegramId: string;
  username: string | null;
  email: string | null;
  subscriptionStatus: string;
  endAtIso: string | null;
  planCode: string | null;
}): string {
  const lines = [
    `${args.index}. Telegram id: ${args.telegramId}`,
    `Username: ${formatUsername(args.username)}`,
    `Email: ${args.email ?? "—"}`,
    `Subscription status: ${subscriptionStatusLabel(args.subscriptionStatus)}`,
    `Plan: ${args.planCode ?? "—"}`,
    `Ends at: ${formatShortDate(args.endAtIso)}`,
  ];
  return lines.join("\n");
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
  const { catPro } = await buildPaidChatAllowlistsStepB();
  const allowlistIds = new Set(catPro.map((e) => e.telegramId));

  const { members, candidatesProbed } = await discoverChatProMembers({
    token,
    catProChatId,
    delayMs,
  });

  const inGroupNonAdmin = members.filter((m) => !m.isBot && !m.isAdminOrOwner);
  const unrecognized = inGroupNonAdmin
    .filter((m) => !allowlistIds.has(m.telegramId))
    .sort((a, b) => a.telegramId.localeCompare(b.telegramId));

  const blocks: string[] = [];
  for (let i = 0; i < unrecognized.length; i += 1) {
    const member = unrecognized[i]!;
    const sub = await getSubscriptionStatusForUserId(member.telegramId);
    blocks.push(
      formatEntryBlock({
        index: i + 1,
        telegramId: member.telegramId,
        username: member.username,
        email: member.email,
        subscriptionStatus: sub.status,
        endAtIso: sub.endAtIso,
        planCode: sub.planCode,
      }),
    );
  }

  const generatedAt = new Date().toISOString();
  const darkGap =
    memberCount != null
      ? Math.max(0, memberCount - members.filter((m) => !m.isBot).length)
      : null;

  const content = [
    "# Chat PRO — in group, not on allowlist",
    "",
    `Generated: ${generatedAt}`,
    `Chat id: ${catProChatId}`,
    `Telegram member count: ${memberCount ?? "unknown"}`,
    `Allowlist (eligible pro): ${allowlistIds.size}`,
    `In group (non-admin, verified): ${inGroupNonAdmin.length}`,
    `Unrecognized (in group, not allowlisted): ${unrecognized.length}`,
    `Candidates probed: ${candidatesProbed}`,
    darkGap != null && darkGap > 0
      ? `Not listed here (no id in DB to verify): ~${darkGap}`
      : null,
    "",
    "Unrecognized = in Chat PRO via getChatMember but not on paid-chat allowlist (rank pro + active MULTIMASKING).",
    "",
    ...blocks.flatMap((block, i) => (i === 0 ? [block] : ["", block])),
    "",
  ]
    .filter((line) => line != null)
    .join("\n");

  fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  console.log(`Wrote ${unrecognized.length} unrecognized members to ${OUTPUT_PATH}`);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
