/**
 * Extend contact access to a target end date — Kwiga-first workflow.
 *
 * Kwiga Public API has no endpoint to change subscription end_at (only read/delete).
 * Flow:
 *   1) Script reads Kwiga and prints CRM order links to edit access manually.
 *   2) You change access end dates in Kwiga CRM (per order).
 *   3) Re-run with --apply: verifies dates in Kwiga API, then syncs local DB from Kwiga.
 *
 *   npx ts-node debug/extend-contact-access-end-date.ts
 *   npx ts-node debug/extend-contact-access-end-date.ts natalizinoveva923@gmail.com
 *   npx ts-node debug/extend-contact-access-end-date.ts natalizinoveva923@gmail.com --apply
 *   npx ts-node debug/extend-contact-access-end-date.ts --until=2026-06-19 --apply
 *
 * Escape hatch (local DB only, Kwiga unchanged): --force-local --apply
 */
import "dotenv/config";
import { Contact } from "../../database/Contact";
import type { ContactAttributes } from "../../database/Contact";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { sequelize } from "../../database/db";
import { normalizeEmail } from "../../database/normalize-email";
import {
  assertKwigaEnv,
  syncKwigaContactProductsToDb,
} from "../../database/sync-from-kwiga";
import { TelegramUser } from "../../database/TelegramUser";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../../telegram/profile/kwiga-rank-db";

const DEFAULT_EMAIL = "natalizinoveva923@gmail.com";
/** 19.06.2026 — end of that UTC day */
const DEFAULT_UNTIL = "2026-06-19T23:59:59.999Z";

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";

function kwigaHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Token: process.env.KWIGA_TOKEN!,
    "Cabinet-Hash": process.env.KWIGA_CABINET_HASH!,
  };
}

type ApiContact = { id: number; email: string; first_name?: string; last_name?: string };

type KwigaOrder = {
  id: number;
  crm_url?: string;
  products?: { id: number; title: string }[];
};

type KwigaSubscription = {
  id: number;
  order_id?: number;
  end_at?: string | null;
  is_active?: boolean;
};

type KwigaProduct = {
  id: number;
  title: string;
  aggregated_subscription?: { end_at?: string | null; is_active?: boolean };
  subscriptions?: KwigaSubscription[];
};

function parseArgs(): {
  email: string;
  until: Date;
  apply: boolean;
  forceLocal: boolean;
} {
  const argv = process.argv.slice(2);
  let email = DEFAULT_EMAIL;
  let untilRaw = DEFAULT_UNTIL;
  let apply = false;
  let forceLocal = false;

  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--force-local") forceLocal = true;
    else if (a.startsWith("--until=")) untilRaw = a.slice("--until=".length).trim();
    else if (!a.startsWith("-")) email = a;
  }

  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(`Invalid email: ${email}`);

  const until = new Date(untilRaw.includes("T") ? untilRaw : `${untilRaw}T23:59:59.999Z`);
  if (Number.isNaN(until.getTime())) throw new Error(`Invalid --until date: ${untilRaw}`);

  return { email: normalized, until, apply, forceLocal };
}

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "(no expiry)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString();
}

function effectiveEndAt(sub: KwigaSubscription, product: KwigaProduct): Date | null {
  const raw = sub.end_at ?? product.aggregated_subscription?.end_at ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function searchKwigaContactByEmail(email: string): Promise<ApiContact | null> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("filters[search]", email);

  const res = await fetch(url, { method: "GET", headers: kwigaHeaders() });
  if (!res.ok) throw new Error(`GET /contacts ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { data?: ApiContact[] };
  const list = body.data ?? [];
  const exact = list.find((c) => c.email.toLowerCase() === email);
  if (exact) return exact;
  if (list.length === 1) return list[0];
  return null;
}

async function fetchKwigaContactOrders(kwigaContactId: number): Promise<KwigaOrder[]> {
  const url = `${BASE_URL}/contacts/${kwigaContactId}?with_orders=1`;
  const res = await fetch(url, { method: "GET", headers: kwigaHeaders() });
  if (!res.ok) throw new Error(`GET /contacts/:id ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { data?: { orders?: KwigaOrder[] } };
  return body.data?.orders ?? [];
}

async function fetchKwigaProducts(kwigaContactId: number): Promise<KwigaProduct[]> {
  const url = `${BASE_URL}/contacts/${kwigaContactId}/products`;
  const res = await fetch(url, { method: "GET", headers: kwigaHeaders() });
  if (!res.ok) {
    throw new Error(`GET /contacts/:id/products ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: KwigaProduct[] };
  return body.data ?? [];
}

function buildOrderCrmMap(orders: KwigaOrder[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const o of orders) {
    if (o.crm_url) map.set(o.id, o.crm_url);
  }
  return map;
}

type SubscriptionRow = {
  subscription_id: number;
  product_id: number;
  product_title: string;
  order_id: number | null;
  end_at: string;
  ok_for_target: boolean;
  crm_url: string | null;
};

function collectSubscriptionRows(
  products: KwigaProduct[],
  until: Date,
  orderCrm: Map<number, string>,
): SubscriptionRow[] {
  const rows: SubscriptionRow[] = [];
  for (const p of products) {
    for (const sub of p.subscriptions ?? []) {
      const end = effectiveEndAt(sub, p);
      const endIso = end ? end.toISOString() : "(no expiry)";
      const ok = end !== null && end.getTime() >= until.getTime();
      const orderId = sub.order_id ?? null;
      rows.push({
        subscription_id: sub.id,
        product_id: p.id,
        product_title: p.title,
        order_id: orderId,
        end_at: endIso,
        ok_for_target: ok,
        crm_url: orderId != null ? (orderCrm.get(orderId) ?? null) : null,
      });
    }
  }
  return rows;
}

function printKwigaReport(
  email: string,
  kwigaContact: ApiContact,
  until: Date,
  rows: SubscriptionRow[],
): void {
  const targetDay = until.toISOString().slice(0, 10);
  console.log("\n--- Kwiga (source of truth) ---");
  console.log({
    email,
    kwiga_contact_id: kwigaContact.id,
    target_end_date: targetDay,
    subscriptions: rows.length,
  });
  console.table(rows);

  const failing = rows.filter((r) => !r.ok_for_target);
  if (failing.length > 0) {
    console.log(
      `\n${failing.length} subscription(s) still end before ${targetDay}. ` +
        "Kwiga API cannot PATCH end_at — edit each order in CRM:",
    );
    for (const r of failing) {
      console.log(`  • ${r.product_title}`);
      console.log(`    subscription_id=${r.subscription_id}  current end_at=${r.end_at}`);
      if (r.crm_url) console.log(`    ${r.crm_url}`);
      else if (r.order_id) console.log(`    order_id=${r.order_id} (no crm_url in API response)`);
    }
  }
}

function daysLeft(endAt: Date, now: Date): number {
  const ms = endAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function rowSummary(r: ContactProductAccess) {
  return {
    id: r.id,
    source: r.source,
    title: (r.titleSnapshot ?? "").slice(0, 60),
    isActive: r.isActive,
    end_at: r.endAt?.toISOString() ?? null,
    ext_sub: r.externalSubscriptionId,
  };
}

async function applyForceLocalDb(
  email: string,
  until: Date,
  kwigaContactId: number | null,
): Promise<void> {
  const contact = await findContactByEmailForBot(email);
  if (!contact) {
    console.error("No contacts row for:", email);
    process.exit(1);
  }

  const rows = await ContactProductAccess.findAll({
    where: { contactId: contact.id, revokedAt: null },
    order: [["id", "ASC"]],
  });

  console.log("\n--- Local DB (--force-local) ---");
  console.log({
    contactDbId: contact.id,
    kwigaExternalId: contact.externalId,
    rows: rows.length,
  });
  console.table(rows.map(rowSummary));

  const now = new Date();
  const left = daysLeft(until, now);

  await sequelize.transaction(async (t) => {
    for (const row of rows) {
      await row.update(
        {
          endAt: until,
          isActive: true,
          countLeftDays: left,
          subscriptionStateTitle: row.subscriptionStateTitle?.includes("debug")
            ? row.subscriptionStateTitle
            : "Debug extend end_at (force-local)",
        },
        { transaction: t },
      );
    }
  });

  const updated = await ContactProductAccess.findAll({
    where: { contactId: contact.id, revokedAt: null },
    order: [["id", "ASC"]],
  });
  console.log("\n--- Local DB after ---");
  console.table(updated.map(rowSummary));

  if (kwigaContactId != null) {
    console.log(
      "\nWarning: Kwiga still has old dates. contact-access-test and kwiga:sync will disagree until CRM is updated.",
    );
  }

  const tgUser = await TelegramUser.findOne({ where: { email } });
  if (tgUser) {
    const snap = await computeKwigaRankSnapshot(tgUser);
    await persistKwigaRankSnapshot(tgUser, snap);
    console.log("Refreshed telegram_users rank cache:", {
      rank: snap.rank,
      accessRowCount: snap.accessRowCount,
    });
  }
}

async function syncLocalFromKwiga(
  email: string,
  kwigaContactId: number,
): Promise<void> {
  let contact = await findContactByEmailForBot(email);
  if (!contact) {
    await Contact.upsert(
      {
        externalId: kwigaContactId,
        email,
        firstName: null,
        lastName: null,
        phone: null,
        createdAtFromApi: null,
        tags: [],
        offers: [],
        orders: [],
      },
      {
        conflictFields: ["external_id"] as unknown as (keyof ContactAttributes)[],
      },
    );
    contact = await Contact.findOne({ where: { externalId: kwigaContactId } });
  }
  if (!contact) {
    throw new Error(`Failed to resolve local contact for Kwiga id=${kwigaContactId}`);
  }

  console.log("\n--- Sync local DB from Kwiga API ---");
  await syncKwigaContactProductsToDb(kwigaContactId, contact.id);

  const rows = await ContactProductAccess.findAll({
    where: { contactId: contact.id, revokedAt: null },
    order: [["id", "ASC"]],
  });
  console.table(rows.map(rowSummary));

  const tgUser = await TelegramUser.findOne({ where: { email } });
  if (tgUser) {
    const snap = await computeKwigaRankSnapshot(tgUser);
    await persistKwigaRankSnapshot(tgUser, snap);
    console.log("Refreshed telegram_users rank cache:", {
      rank: snap.rank,
      accessRowCount: snap.accessRowCount,
    });
  }
}

async function main(): Promise<void> {
  const { email, until, apply, forceLocal } = parseArgs();
  assertKwigaEnv();
  await sequelize.authenticate();

  const kwigaContact = await searchKwigaContactByEmail(email);
  if (!kwigaContact) {
    console.error("Kwiga contact not found for:", email);
    process.exit(1);
  }

  const [products, orders] = await Promise.all([
    fetchKwigaProducts(kwigaContact.id),
    fetchKwigaContactOrders(kwigaContact.id),
  ]);
  const orderCrm = buildOrderCrmMap(orders);
  const subRows = collectSubscriptionRows(products, until, orderCrm);

  if (subRows.length === 0) {
    console.error("No subscriptions returned from Kwiga for this contact.");
    process.exit(1);
  }

  printKwigaReport(email, kwigaContact, until, subRows);

  if (!apply) {
    console.log(
      "\nDry run. After you extend access in Kwiga CRM (links above), run:\n" +
        `  npx ts-node debug/extend-contact-access-end-date.ts ${email} --apply`,
    );
    return;
  }

  if (forceLocal) {
    await applyForceLocalDb(email, until, kwigaContact.id);
    console.log("\nDone (--force-local). Verify:");
    console.log(`  npx ts-node users/contact-access-test.ts ${email}`);
    return;
  }

  const failing = subRows.filter((r) => !r.ok_for_target);
  if (failing.length > 0) {
    console.error(
      `\n--apply aborted: fix ${failing.length} subscription(s) in Kwiga CRM first, then re-run --apply.`,
    );
    process.exit(1);
  }

  await syncLocalFromKwiga(email, kwigaContact.id);
  console.log("\nDone. Kwiga dates OK; local DB synced from Kwiga.");
  console.log(`  npx ts-node users/contact-access-test.ts ${email}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
