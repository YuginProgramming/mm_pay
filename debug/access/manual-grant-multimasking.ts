/**
 * Manual full-access compensation without WayForPay.
 *
 * Dry-run:
 *   npx ts-node debug/access/manual-grant-multimasking.ts --telegram-id=297098152
 *
 * Apply:
 *   npx ts-node debug/access/manual-grant-multimasking.ts \
 *     --telegram-id=297098152 \
 *     --days=30 \
 *     --reason="Компенсація через помилку автосписання" \
 *     --close-local-auto --apply --yes
 */
import "dotenv/config";
import { Op } from "sequelize";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { sequelize } from "../../database/db";
import { TelegramUser } from "../../database/TelegramUser";
import { applyManualAccessGrant } from "../../access/manual-access-grant.service";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "../../payment/multimasking-product";

type CliOptions = {
  email: string | null;
  telegramId: string | null;
  days: number;
  reason: string;
  operationId: string | null;
  closeLocalAuto: boolean;
  apply: boolean;
  yes: boolean;
};

function parseOptions(): CliOptions {
  let email: string | null = null;
  let telegramId: string | null = null;
  let days = 30;
  let reason = "";
  let operationId: string | null = null;
  let closeLocalAuto = false;
  let apply = false;
  let yes = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim().toLowerCase();
    } else if (arg.startsWith("--telegram-id=")) {
      telegramId = arg.slice("--telegram-id=".length).trim();
    } else if (arg.startsWith("--days=")) {
      days = Number.parseInt(arg.slice("--days=".length), 10);
    } else if (arg.startsWith("--reason=")) {
      reason = arg.slice("--reason=".length).trim();
    } else if (arg.startsWith("--operation-id=")) {
      operationId = arg.slice("--operation-id=".length).trim();
    } else if (arg === "--close-local-auto") {
      closeLocalAuto = true;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx ts-node debug/access/manual-grant-multimasking.ts " +
          "[--email=<email> | --telegram-id=<id>] [--days=30] " +
          '--reason="..." [--close-local-auto] [--apply --yes]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if ((email == null) === (telegramId == null)) {
    throw new Error("Provide exactly one of --email or --telegram-id");
  }
  if (telegramId != null && !/^\d+$/.test(telegramId)) {
    throw new Error(`Invalid Telegram ID: ${telegramId}`);
  }
  if (email != null && !email.includes("@")) {
    throw new Error(`Invalid email: ${email}`);
  }
  if (!Number.isInteger(days) || days < 1 || days > 3660) {
    throw new Error("--days must be an integer from 1 to 3660");
  }
  if (apply && !reason) {
    throw new Error("--reason is required with --apply");
  }
  if (apply && !yes) {
    throw new Error("--apply requires --yes");
  }

  return {
    email,
    telegramId,
    days,
    reason,
    operationId,
    closeLocalAuto,
    apply,
    yes,
  };
}

function addDaysUtc(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function resolveTelegramUser(options: CliOptions): Promise<TelegramUser> {
  if (options.telegramId != null) {
    const user = await TelegramUser.findOne({
      where: { telegramId: options.telegramId },
    });
    if (!user) {
      throw new Error(`Telegram user not found: ${options.telegramId}`);
    }
    return user;
  }

  const users = await TelegramUser.findAll({
    where: { email: { [Op.iLike]: options.email! } },
  });
  if (users.length === 0) {
    throw new Error(`Telegram user not found for email: ${options.email}`);
  }
  if (users.length > 1) {
    throw new Error(
      `Email belongs to multiple Telegram users: ${users
        .map((user) => user.telegramId)
        .join(", ")}`,
    );
  }
  return users[0];
}

async function main(): Promise<void> {
  const options = parseOptions();
  await sequelize.authenticate();

  const telegramUser = await resolveTelegramUser(options);
  const userId = String(telegramUser.telegramId);
  const email = telegramUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error(`Telegram user has no email: ${userId}`);
  }

  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    throw new Error(`Local contact not found for email: ${email}`);
  }
  if (contact.externalId == null) {
    throw new Error(`Local contact has no KWIGA external ID: ${contact.id}`);
  }

  const now = new Date();
  const endAt = addDaysUtc(now, options.days);
  const operationKey =
    options.operationId ||
    `manual-multimasking:${userId}:${endAt.toISOString().slice(0, 10)}`;

  const currentRows = await ContactProductAccess.findAll({
    where: {
      contactId: contact.id,
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      source: { [Op.in]: ["payment_hook", "manual_override"] },
      revokedAt: null,
      isActive: true,
    },
    order: [["endAt", "DESC"]],
  });
  const currentEndAt =
    currentRows.find((row) => row.endAt != null)?.endAt ?? null;

  console.log("=== manual multimasking access ===");
  console.log({
    mode: options.apply ? "APPLY" : "DRY_RUN",
    user_id: userId,
    email,
    local_contact_id: contact.id,
    kwiga_contact_id: contact.externalId,
    current_end_at: currentEndAt?.toISOString() ?? null,
    target_start_at: now.toISOString(),
    target_end_at: endAt.toISOString(),
    days: options.days,
    close_local_auto: options.closeLocalAuto,
    operation_key: operationKey,
    reason: options.reason || "(required only with --apply)",
    wayforpay: "not used",
  });

  if (!options.apply) {
    console.log(
      "\nDry-run only. Re-run with --apply --yes and a non-empty --reason to apply.",
    );
    return;
  }

  const result = await applyManualAccessGrant({
    operationKey,
    userId,
    contactId: contact.id,
    email,
    startAt: now,
    endAt,
    days: options.days,
    reason: options.reason,
    operator: process.env.MANUAL_ACCESS_OPERATOR?.trim() || process.env.USER || "unknown",
    closeLocalAuto: options.closeLocalAuto,
  });

  console.log("\n=== applied ===");
  console.log({
    status: result.status,
    manual_grant_id: result.manualGrantId,
    target_end_at: result.targetEndAt.toISOString(),
    kwiga_attempted: result.kwiga.attempted,
    kwiga_updated: result.kwiga.updated,
    kwiga_skipped: result.kwiga.skipped,
    local_auto_closed: result.localAutoClosed,
    telegram_unban_errors: result.telegramUnbanErrors,
  });
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
