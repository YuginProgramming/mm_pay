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

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const DEFAULT_FALLBACK_DAYS = 30;
const PURCHASE_DELAY_MS = Math.max(
  0,
  parseInt(process.env.KWIGA_PURCHASE_DELAY_MS ?? "2500", 10) || 2500,
);
const RETRY_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.KWIGA_RETRY_MAX_ATTEMPTS ?? "4", 10) || 4,
);
const RETRY_BASE_DELAY_MS = Math.max(
  100,
  parseInt(process.env.KWIGA_RETRY_BASE_DELAY_MS ?? "2000", 10) || 2000,
);

type KwigaContact = { id: number; email: string };
type KwigaSubscription = {
  id: number;
  offer_id?: number | null;
  order_id?: number | null;
  end_at?: string | null;
  is_active?: boolean;
};
type KwigaProduct = {
  id: number;
  title: string;
  aggregated_subscription?: { end_at?: string | null; is_active?: boolean };
  subscriptions?: KwigaSubscription[];
};

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

function kwigaHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Token: process.env.KWIGA_TOKEN!,
    "Cabinet-Hash": process.env.KWIGA_CABINET_HASH!,
  };
}

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

function plusDaysIso(days: number): string {
  const now = new Date();
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function effectiveEndAt(product: KwigaProduct): Date | null {
  const subs = product.subscriptions ?? [];
  let best: Date | null = null;
  for (const s of subs) {
    const dt = parseIso(s.end_at ?? null);
    if (!dt) continue;
    if (!best || dt > best) best = dt;
  }
  if (best) return best;
  return parseIso(product.aggregated_subscription?.end_at ?? null);
}

function currentOfferId(product: KwigaProduct): number | null {
  const subs = product.subscriptions ?? [];
  for (const s of subs) {
    if (typeof s.offer_id === "number" && s.offer_id > 0) return s.offer_id;
  }
  return null;
}

function isRetriableErrorMessage(msg: string): boolean {
  return (
    /429|5\d\d/.test(msg) ||
    /rate limit exceeded/i.test(msg) ||
    /POST \/contacts\/purchases 422/.test(msg)
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = RETRY_MAX_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const retriable = isRetriableErrorMessage(msg);
      if (!retriable || i === attempts - 1) break;
      const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

async function searchKwigaContactByEmail(email: string): Promise<KwigaContact | null> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("filters[search]", email);

  const res = await fetch(url, { method: "GET", headers: kwigaHeaders() });
  if (!res.ok) {
    throw new Error(`GET /contacts ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: KwigaContact[] };
  const list = body.data ?? [];
  return list.find((c) => c.email.toLowerCase() === email) ?? list[0] ?? null;
}

async function fetchKwigaProducts(kwigaContactId: number): Promise<KwigaProduct[]> {
  const res = await fetch(`${BASE_URL}/contacts/${kwigaContactId}/products`, {
    method: "GET",
    headers: kwigaHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `GET /contacts/${kwigaContactId}/products ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { data?: KwigaProduct[] };
  return body.data ?? [];
}

async function postPurchase(email: string, offerId: number): Promise<void> {
  const payload = {
    email,
    offer_id: offerId,
    is_paid: true,
    send_activation_email: false,
    send_product_access_email: false,
    send_payment_success_email: false,
    comment: "Batch update from user_subscriptions",
  };
  const res = await fetch(`${BASE_URL}/contacts/purchases`, {
    method: "POST",
    headers: kwigaHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`POST /contacts/purchases ${res.status}: ${await res.text()}`);
  }
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
  const purchaseDedupe = new Set<string>();

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

      const contact = await withRetry(() => searchKwigaContactByEmail(email));
      if (!contact) {
        noContact += 1;
        one.actions.push({ kind: "skip_no_contact", note: "No Kwiga contact by email" });
        processed.push(one);
        continue;
      }
      one.kwigaContactId = contact.id;

      const products = await withRetry(() => fetchKwigaProducts(contact.id));
      if (products.length === 0) {
        noProducts += 1;
        one.actions.push({ kind: "skip_no_products", note: "Contact has no products" });
        processed.push(one);
        continue;
      }

      for (const p of products) {
        const currentEnd = effectiveEndAt(p);
        const targetEnd = row.endAt;
        const isValid = currentEnd !== null && currentEnd >= targetEnd;

        if (isValid) {
          skippedValid += 1;
          one.actions.push({
            kind: "skip_valid",
            productId: p.id,
            productTitle: p.title,
            targetEndAt: targetEnd.toISOString(),
            currentEndAt: iso(currentEnd),
          });
          continue;
        }

        const offerId = currentOfferId(p);
        if (!offerId) {
          noOffer += 1;
          one.actions.push({
            kind: "skip_no_offer",
            productId: p.id,
            productTitle: p.title,
            targetEndAt: targetEnd.toISOString(),
            currentEndAt: iso(currentEnd),
            note: "No offer_id found in product subscriptions",
          });
          continue;
        }

        const exactNotSupported = true;
        const fallbackTarget = plusDaysIso(args.fallbackDays);
        const dedupeKey = `${email}:${offerId}:${targetEnd.toISOString().slice(0, 10)}`;
        if (purchaseDedupe.has(dedupeKey)) {
          one.actions.push({
            kind: "skip_valid",
            productId: p.id,
            productTitle: p.title,
            offerId,
            targetEndAt: targetEnd.toISOString(),
            currentEndAt: iso(currentEnd),
            note: "Deduped same email/offer/day within this run",
          });
          continue;
        }

        const action: ProductAction = {
          kind: "grant_offer",
          productId: p.id,
          productTitle: p.title,
          offerId,
          targetEndAt: targetEnd.toISOString(),
          currentEndAt: iso(currentEnd),
          note: exactNotSupported
            ? `Exact target date cannot be set via API; offer-based grant used (fallback intent: ${fallbackTarget}).`
            : undefined,
        };
        one.actions.push(action);
        fallbackUsed += 1;

        if (args.apply) {
          await withRetry(() => postPurchase(email, offerId));
          granted += 1;
          purchaseDedupe.add(dedupeKey);
          contactIdsToSync.add(contact.id);
          if (PURCHASE_DELAY_MS > 0) {
            await sleep(PURCHASE_DELAY_MS);
          }
        }
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
      await withRetry(() => syncKwigaContactProductsToDb(kwigaContactId, local.id));
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
