import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import { Contact } from "../../database/Contact";
import { normalizeEmail } from "../../database/normalize-email";
import { assertKwigaEnv, syncKwigaContactProductsToDb } from "../../database/sync-from-kwiga";
import { TelegramUser } from "../../database/TelegramUser";
import { UserSubscription } from "../../database/UserSubscription";
import { sequelize } from "../../database/db";
import { searchKwigaContactByEmail } from "../../kwiga/kwiga-api-client";
import { DEFAULT_KWIGA_PROLONG_FALLBACK_DAYS } from "../../kwiga/kwiga-config";
import type { ProlongKwigaProductAction } from "../../kwiga/kwiga-types";
import { withKwigaRetry } from "../../kwiga/kwiga-retry";
import { prolongKwigaCourseAccessForPayment } from "../../payment/grant-kwiga-course-access";

const DEFAULT_FALLBACK_DAYS = DEFAULT_KWIGA_PROLONG_FALLBACK_DAYS;

type CliArgs = {
  apply: boolean;
  limit: number;
  userId: string | null;
  email: string | null;
  includeLapsed: boolean;
  syncLocal: boolean;
  fallbackDays: number;
};

type ActionKind =
  | "skip_valid"
  | "grant_offer"
  | "skip_no_offer"
  | "skip_no_email"
  | "skip_no_contact"
  | "skip_no_products"
  | "error";

type ProductAction = {
  kind: ActionKind;
  productId?: number;
  productTitle?: string;
  offerId?: number;
  targetEndAt?: string;
  currentEndAt?: string | null;
  note?: string;
  error?: string;
};

type UserReport = {
  userSubscriptionId: number;
  userId: string;
  status: string;
  localEndAt: string;
  email: string | null;
  kwigaContactId: number | null;
  actions: ProductAction[];
};

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let apply = false;
  let limit = 500;
  let userId: string | null = null;
  let email: string | null = null;
  let includeLapsed = false;
  let syncLocal = false;
  let fallbackDays = DEFAULT_FALLBACK_DAYS;

  for (const arg of args) {
    if (arg === "--apply") apply = true;
    else if (arg === "--include-lapsed") includeLapsed = true;
    else if (arg === "--sync-local") syncLocal = true;
    else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (arg.startsWith("--user-id=")) {
      userId = arg.slice("--user-id=".length).trim() || null;
    } else if (arg.startsWith("--email=")) {
      email = normalizeEmail(arg.slice("--email=".length).trim()) || null;
    } else if (arg.startsWith("--fallback-days=")) {
      const n = parseInt(arg.slice("--fallback-days=".length), 10);
      if (Number.isFinite(n) && n > 0) fallbackDays = n;
    }
  }

  return { apply, limit, userId, email, includeLapsed, syncLocal, fallbackDays };
}

function countActionsByKind(
  actions: ProlongKwigaProductAction[],
  kind: ProlongKwigaProductAction["kind"],
): number {
  return actions.filter((a) => a.kind === kind).length;
}

async function resolveEmailByUserId(userId: string): Promise<string | null> {
  const byTelegram = await TelegramUser.findOne({
    where: { telegramId: userId },
    attributes: ["email"],
  });
  const email1 = normalizeEmail(byTelegram?.email ?? "");
  if (email1) return email1;

  if (/^\d+$/.test(userId)) {
    const byPk = await TelegramUser.findByPk(Number(userId), { attributes: ["email"] });
    const email2 = normalizeEmail(byPk?.email ?? "");
    if (email2) return email2;
  }
  return null;
}

function reportPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), "debug", `kwiga-access-sync-report-${ts}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertKwigaEnv();
  await sequelize.authenticate();

  const where: Record<string, unknown> = {};
  if (args.includeLapsed) {
    where.status = { [Op.in]: ["active", "lapsed"] };
  } else {
    where.status = "active";
  }
  if (args.userId) where.userId = args.userId;

  const rows = await UserSubscription.findAll({
    where,
    order: [["endAt", "ASC"]],
    limit: args.limit,
  });

  const processed: UserReport[] = [];
  const contactIdsToSync = new Set<number>();

  let scanned = 0;
  let noEmail = 0;
  let noContact = 0;
  let noProducts = 0;
  let skippedValid = 0;
  let granted = 0;
  let noOffer = 0;
  let failures = 0;
  let fallbackUsed = 0;
  let filteredOut = 0;

  for (const row of rows) {
    scanned += 1;
    const one: UserReport = {
      userSubscriptionId: row.id,
      userId: row.userId,
      status: row.status,
      localEndAt: row.endAt.toISOString(),
      email: null,
      kwigaContactId: null,
      actions: [],
    };

    try {
      const email = await resolveEmailByUserId(row.userId);
      if (!email) {
        noEmail += 1;
        one.actions.push({ kind: "skip_no_email", note: "No resolved email" });
        processed.push(one);
        continue;
      }
      if (args.email && email !== args.email) {
        filteredOut += 1;
        continue;
      }
      one.email = email;

      const contact = await withKwigaRetry(() => searchKwigaContactByEmail(email));
      if (!contact) {
        noContact += 1;
        one.actions.push({ kind: "skip_no_contact", note: "No Kwiga contact by email" });
        processed.push(one);
        continue;
      }
      one.kwigaContactId = contact.id;

      const local = await Contact.findOne({
        where: { externalId: contact.id },
        attributes: ["id"],
      });

      const prolong = await prolongKwigaCourseAccessForPayment({
        email,
        kwigaContactId: contact.id,
        localContactId: local?.id ?? null,
        targetEndAt: row.endAt,
        orderReference: `user_subscription:${row.id}`,
        fallbackDays: args.fallbackDays,
        apply: args.apply,
        skipLocalSync: true,
      });

      one.actions.push(...(prolong.actions as ProductAction[]));

      if (prolong.status === "no_products") {
        noProducts += 1;
      }
      skippedValid += countActionsByKind(prolong.actions, "skip_valid");
      noOffer += countActionsByKind(prolong.actions, "skip_no_offer");
      fallbackUsed += countActionsByKind(prolong.actions, "grant_offer");
      granted += prolong.grantsApplied;

      if (prolong.grantsApplied > 0) {
        contactIdsToSync.add(contact.id);
      }
    } catch (err) {
      failures += 1;
      one.actions.push({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    processed.push(one);
  }

  if (args.apply && args.syncLocal && contactIdsToSync.size > 0) {
    for (const kwigaContactId of contactIdsToSync) {
      const local = await Contact.findOne({
        where: { externalId: kwigaContactId },
        attributes: ["id"],
      });
      if (!local) continue;
      await withKwigaRetry(() => syncKwigaContactProductsToDb(kwigaContactId, local.id));
    }
  }

  const output = {
    mode: args.apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    filters: {
      limit: args.limit,
      userId: args.userId,
      email: args.email,
      includeLapsed: args.includeLapsed,
      syncLocal: args.syncLocal,
      fallbackDays: args.fallbackDays,
    },
    counters: {
      scanned,
      noEmail,
      noContact,
      noProducts,
      skippedValid,
      granted,
      noOffer,
      failures,
      fallbackUsed,
      filteredOut,
    },
    users: processed,
  };

  const outPath = reportPath();
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log("--- KWIGA access sync from user_subscriptions ---");
  console.log(output.counters);
  console.log(`Report: ${outPath}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
