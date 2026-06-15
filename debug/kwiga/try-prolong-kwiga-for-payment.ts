/**
 * Manual / staging: prolong Kwiga access for one email (S1 — no webhook).
 *
 *   npx ts-node debug/kwiga/try-prolong-kwiga-for-payment.ts --email=user@example.com
 *   npx ts-node debug/kwiga/try-prolong-kwiga-for-payment.ts --email=user@example.com --apply
 *   npx ts-node debug/kwiga/try-prolong-kwiga-for-payment.ts --email=user@example.com --apply --days=30
 */
import "dotenv/config";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { getPaidChatAccessDays } from "../../database/app-settings-queries";
import { sequelize } from "../../database/db";
import { normalizeEmail } from "../../database/normalize-email";
import { searchKwigaContactByEmail } from "../../kwiga/kwiga-api-client";
import { prolongKwigaCourseAccessForPayment } from "../../payment/grant-kwiga-course-access";

function parseArgs(): {
  email: string;
  apply: boolean;
  days: number | null;
  orderReference: string;
} {
  const argv = process.argv.slice(2);
  let email: string | null = null;
  let apply = false;
  let days: number | null = null;
  let orderReference = `debug-prolong-${Date.now()}`;

  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--email=")) {
      email = normalizeEmail(arg.slice("--email=".length).trim()) || null;
    } else if (arg.startsWith("--days=")) {
      const n = parseInt(arg.slice("--days=".length), 10);
      if (Number.isFinite(n) && n > 0) days = n;
    } else if (arg.startsWith("--order-reference=")) {
      orderReference = arg.slice("--order-reference=".length).trim() || orderReference;
    }
  }

  if (!email) {
    throw new Error("Usage: --email=user@example.com [--apply] [--days=30]");
  }

  return { email, apply, days, orderReference };
}

async function main(): Promise<void> {
  const args = parseArgs();
  await sequelize.authenticate();

  const localContact = await findContactByEmailForBot(args.email);
  if (!localContact) {
    console.error("No local contacts row for:", args.email);
    process.exit(1);
  }

  const kwigaContact = await searchKwigaContactByEmail(args.email);
  if (!kwigaContact) {
    console.error("No Kwiga contact for:", args.email);
    process.exit(1);
  }

  const accessDays = args.days ?? (await getPaidChatAccessDays());
  const targetEndAt = new Date();
  targetEndAt.setUTCDate(targetEndAt.getUTCDate() + accessDays);

  console.log("--- try-prolong-kwiga-for-payment ---");
  console.log({
    email: args.email,
    apply: args.apply,
    accessDays,
    targetEndAt: targetEndAt.toISOString(),
    orderReference: args.orderReference,
    kwigaContactId: kwigaContact.id,
    localContactId: localContact.id,
  });

  const result = await prolongKwigaCourseAccessForPayment({
    email: args.email,
    kwigaContactId: kwigaContact.id,
    localContactId: localContact.id,
    targetEndAt,
    orderReference: args.orderReference,
    fallbackDays: accessDays,
    apply: args.apply,
  });

  console.log("\nResult:", {
    status: result.status,
    grantsApplied: result.grantsApplied,
  });
  console.table(result.actions);

  if (!args.apply) {
    console.log("\nDry run. Re-run with --apply to POST purchases and sync local DB.");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
