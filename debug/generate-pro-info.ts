/**
 * Build a numbered list of Chat PRO users (allowlist: rank `pro` + active MULTIMASKING access)
 * and write it to `debug/pro-info.md`.
 *
 *   npx ts-node debug/generate-pro-info.ts
 *   npm run debug:generate-pro-info
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import {
  getSubscriptionStatusForUserId,
  type SubscriptionStatusValue,
  type SubscriptionStatusView,
} from "../payment/subscription-status.service";
import { buildPaidChatAllowlistsStepB } from "../telegram/paid-chat-janitor";

const OUTPUT_PATH = path.resolve(__dirname, "pro-info.md");

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
  status: SubscriptionStatusView;
}): string {
  const { index, telegramId, username, status } = args;
  const lines = [
    `${index}. Telegram id: ${telegramId}`,
    `Username: ${formatUsername(username)}`,
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

async function main(): Promise<void> {
  await sequelize.authenticate();

  const { catPro } = await buildPaidChatAllowlistsStepB();
  const sorted = [...catPro].sort((a, b) => a.telegramId.localeCompare(b.telegramId));

  const blocks: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i]!;
    const user = await TelegramUser.findOne({
      where: { telegramId: entry.telegramId },
      attributes: ["username"],
    });
    const status = await getSubscriptionStatusForUserId(entry.telegramId);
    blocks.push(
      formatUserBlock({
        index: i + 1,
        telegramId: entry.telegramId,
        username: user?.username ?? null,
        status,
      }),
    );
  }

  const generatedAt = new Date().toISOString();
  const content = [
    "# Chat PRO users",
    "",
    `Generated: ${generatedAt}`,
    `Total: ${sorted.length}`,
    "",
    "Source: paid-chat allowlist (`rank: pro`, active MULTIMASKING access).",
    "",
    ...blocks.flatMap((block, i) => (i === 0 ? [block] : ["", block])),
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, content, "utf8");
  console.log(`Wrote ${sorted.length} users to ${OUTPUT_PATH}`);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
