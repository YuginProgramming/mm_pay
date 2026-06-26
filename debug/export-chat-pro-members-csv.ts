/**
 * Export Chat PRO group members to `debug/chat-pro-members.csv` for one-time intruder workflows.
 *
 * Discovers members via Bot API getChatMember on known telegram ids + getChatAdministrators.
 * Telegram cannot list every member; ids never seen by the bot may be missing (see console summary).
 *
 *   npx ts-node debug/export-chat-pro-members-csv.ts
 *   npx ts-node debug/export-chat-pro-members-csv.ts --chat-id=-1001234567890
 *   npm run debug:export-chat-pro-members-csv
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sequelize } from "../database/db";
import { getSubscriptionStatusForUserId } from "../payment/subscription-status.service";
import { rawGetChatMemberCount } from "../telegram/paid-chat-janitor/telegram-bot-raw";
import {
  csvField,
  discoverChatProMembers,
  resolveCatProChatId,
} from "./chat-pro-member-export-lib";

const OUTPUT_PATH = path.resolve(__dirname, "chat-pro-members.csv");

const CSV_HEADER = [
  "telegram_id",
  "username",
  "display_name",
  "member_status",
  "is_admin_or_owner",
  "is_bot",
  "email",
  "subscription_status",
  "plan_code",
  "days_left",
  "auto_renew",
  "verified_in_group",
].join(",");

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
  const { members, candidatesProbed, skippedNotInChat } = await discoverChatProMembers({
    token,
    catProChatId,
    delayMs,
  });

  const nonBotMembers = members.filter((m) => !m.isBot);
  const adminCount = nonBotMembers.filter((m) => m.isAdminOrOwner).length;
  const regularCount = nonBotMembers.filter((m) => !m.isAdminOrOwner).length;

  const rows: string[] = [CSV_HEADER];

  for (const member of members) {
    const sub = member.isBot
      ? null
      : await getSubscriptionStatusForUserId(member.telegramId);

    rows.push(
      [
        csvField(member.telegramId),
        csvField(member.username),
        csvField(member.displayName),
        csvField(member.memberStatus),
        csvField(member.isAdminOrOwner ? "yes" : "no"),
        csvField(member.isBot ? "yes" : "no"),
        csvField(member.email),
        csvField(sub?.status ?? ""),
        csvField(sub?.planCode ?? ""),
        csvField(sub?.daysLeft ?? ""),
        csvField(sub?.autoRenew ? "yes" : "no"),
        csvField("yes"),
      ].join(","),
    );
  }

  const generatedAt = new Date().toISOString();
  const preamble = [
    `# generated_at=${generatedAt}`,
    `# chat_id=${catProChatId}`,
    `# telegram_member_count=${memberCount ?? "unknown"}`,
    `# exported_rows=${members.length}`,
    `# non_bot_members=${nonBotMembers.length}`,
    `# admins_or_owner=${adminCount}`,
    `# regular_members=${regularCount}`,
    `# candidates_probed=${candidatesProbed}`,
    `# skipped_not_in_chat=${skippedNotInChat}`,
    `# gap_note=Bot API cannot enumerate all members; add missing ids manually then re-import for kick script`,
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, `${preamble}${rows.join("\n")}\n`, "utf8");

  const gap =
    memberCount != null ? Math.max(0, memberCount - nonBotMembers.length) : null;

  console.log(`Wrote ${members.length} rows to ${OUTPUT_PATH}`);
  console.log(
    `Chat ${catProChatId} · Telegram count ${memberCount ?? "?"} · ` +
      `exported ${nonBotMembers.length} non-bot (${regularCount} regular + ${adminCount} admin/owner)` +
      (gap != null && gap > 0
        ? ` · possible missing ids: ~${gap} (not in DB / not probed)`
        : ""),
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
