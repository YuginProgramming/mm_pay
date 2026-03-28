import "dotenv/config";
import type { CreationAttributes, Transaction } from "sequelize";
import { Contact } from "./Contact";
import type { ContactAttributes } from "./Contact";
import type {
  ContactOfferRecord,
  ContactOrderRecord,
  ContactPaymentRecord,
  ContactTagRecord,
} from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { KwigaProduct } from "./KwigaProduct";
import type { KwigaProductAttributes } from "./KwigaProduct";
import { sequelize } from "./db";

/**
 * Pull contacts from Kwiga, then for each contact GET /contacts/:id/products
 * and upsert kwiga_products + replace contact_product_access rows (source kwiga_sync only).
 *
 * Usage:
 *   npx ts-node database/sync-from-kwiga.ts
 *   npx ts-node database/sync-from-kwiga.ts --contacts-only
 *   npx ts-node database/sync-from-kwiga.ts --max-pages=5 --start-page=1
 *
 * Env:
 *   SYNC_MAX_PAGES   — stop after N list pages (omit = all pages)
 *   SYNC_CONTACTS_ONLY=true — only upsert contacts, no product calls
 *   SYNC_MS_DELAY    — optional delay ms after each contact’s product request (rate limit)
 *   SYNC_PER_PAGE    — list page size (default 15)
 */

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const TOKEN = process.env.KWIGA_TOKEN;
const CABINET_HASH = process.env.KWIGA_CABINET_HASH;

if (!TOKEN || !CABINET_HASH) {
  console.error("Missing KWIGA_TOKEN or KWIGA_CABINET_HASH in .env");
  process.exit(1);
}

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Token: TOKEN,
  "Cabinet-Hash": CABINET_HASH,
} as const;

const PER_PAGE = Math.min(
  250,
  Math.max(1, parseInt(process.env.SYNC_PER_PAGE ?? "15", 10) || 15),
);
const MS_DELAY = parseInt(process.env.SYNC_MS_DELAY ?? "0", 10) || 0;

type ApiContactTag = { id: number; name: string };
type ApiContactOffer = { id: number; unique_offer_code: string; title: string };
type ApiContactPayment = {
  id: number;
  status?: number;
  status_title?: string;
  price_info?: { amount?: number; currency?: { code?: string } };
};
type ApiContactOrder = {
  id: number;
  paid_status?: string;
  paid_status_title?: string;
  cost_info?: { amount?: number; currency?: { code?: string } };
  payments?: ApiContactPayment[];
};
type ApiContact = {
  id: number;
  created_at?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: ApiContactTag[];
  offers?: ApiContactOffer[];
  orders?: ApiContactOrder[];
};

type ApiContactsMeta = {
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
};
type ApiContactsResponse = { data: ApiContact[]; meta?: ApiContactsMeta };

type ApiSubState = { id?: number; name?: string; title?: string };
type ApiAggregatedSubscription = {
  is_active?: boolean;
  is_paid?: boolean;
  start_at?: string | null;
  end_at?: string | null;
  state?: ApiSubState;
  count_available_days?: number | null;
  count_left_days?: number | null;
};
type ApiSubscription = {
  id: number;
  is_active?: boolean;
  start_at?: string | null;
  end_at?: string | null;
  paid_at?: string | null;
  order_id?: number | null;
  offer_id?: number | null;
};
type ApiProduct = {
  id: number;
  productable_id: number;
  productable_type: string;
  title: string;
  is_published?: boolean;
  aggregated_subscription?: ApiAggregatedSubscription;
  subscriptions?: ApiSubscription[];
};
type ApiProductsResponse = { data: ApiProduct[] };

function mapApiContactToRow(contact: ApiContact) {
  const tags: ContactTagRecord[] = (contact.tags ?? []).map((t) => ({ id: t.id, name: t.name }));
  const offers: ContactOfferRecord[] = (contact.offers ?? []).map((o) => ({
    id: o.id,
    code: o.unique_offer_code,
    title: o.title,
  }));
  const orders: ContactOrderRecord[] = (contact.orders ?? []).map((order) => {
    const payments: ContactPaymentRecord[] = (order.payments ?? []).map((p) => ({
      id: p.id,
      status: p.status ?? null,
      status_title: p.status_title ?? null,
      amount: p.price_info?.amount ?? null,
      currency: p.price_info?.currency?.code ?? null,
    }));
    return {
      id: order.id,
      paid_status: order.paid_status ?? null,
      paid_status_title: order.paid_status_title ?? null,
      amount: order.cost_info?.amount ?? null,
      currency: order.cost_info?.currency?.code ?? null,
      payments,
    };
  });

  return {
    externalId: contact.id,
    email: contact.email,
    firstName: contact.first_name ?? null,
    lastName: contact.last_name ?? null,
    phone: contact.phone ?? null,
    createdAtFromApi: contact.created_at ? new Date(contact.created_at) : null,
    tags,
    offers,
    orders,
  };
}

async function fetchContactsPage(
  page: number,
): Promise<{ contacts: ApiContact[]; meta?: ApiContactsMeta }> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("with_orders", "1");
  url.searchParams.set("with_certificates", "1");
  url.searchParams.set("with_offers", "1");

  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`GET /contacts ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as ApiContactsResponse;
  return { contacts: body.data ?? [], meta: body.meta };
}

async function fetchContactProducts(kwigaContactId: number): Promise<ApiProduct[]> {
  const url = `${BASE_URL}/contacts/${kwigaContactId}/products`;
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`GET /contacts/${kwigaContactId}/products ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as ApiProductsResponse;
  return body.data ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function upsertKwigaProduct(p: ApiProduct, transaction: Transaction): Promise<number> {
  await KwigaProduct.upsert(
    {
      externalProductId: p.id,
      productableType: p.productable_type ?? null,
      productableId: p.productable_id ?? null,
      title: p.title,
      isPublished: p.is_published ?? null,
    },
    {
      transaction,
      conflictFields: ["external_product_id"] as unknown as (keyof KwigaProductAttributes)[],
    },
  );
  const row = await KwigaProduct.findOne({
    where: { externalProductId: p.id },
    attributes: ["id"],
    transaction,
  });
  if (!row) throw new Error(`KwigaProduct missing after upsert external_product_id=${p.id}`);
  return row.id;
}

async function syncProductsAndAccess(contactDbId: number, products: ApiProduct[]): Promise<void> {
  const now = new Date();

  await sequelize.transaction(async (t) => {
    await ContactProductAccess.destroy({
      where: { contactId: contactDbId, source: "kwiga_sync" },
      transaction: t,
    });

    const accessRows: CreationAttributes<ContactProductAccess>[] = [];

    for (const p of products) {
      const kwigaProductPk = await upsertKwigaProduct(p, t);
      const agg = p.aggregated_subscription;
      const subs = p.subscriptions ?? [];

      if (subs.length === 0) continue;

      for (const sub of subs) {
        accessRows.push({
          contactId: contactDbId,
          kwigaProductId: kwigaProductPk,
          externalProductId: p.id,
          externalSubscriptionId: String(sub.id),
          titleSnapshot: p.title,
          isActive: sub.is_active ?? agg?.is_active ?? true,
          isPaid: agg?.is_paid ?? false,
          startAt: sub.start_at ? new Date(sub.start_at) : agg?.start_at ? new Date(agg.start_at) : null,
          endAt: sub.end_at ? new Date(sub.end_at) : agg?.end_at ? new Date(agg.end_at) : null,
          paidAt: sub.paid_at ? new Date(sub.paid_at) : null,
          subscriptionStateTitle: agg?.state?.title ?? agg?.state?.name ?? null,
          countAvailableDays: agg?.count_available_days ?? null,
          countLeftDays: agg?.count_left_days ?? null,
          orderId: sub.order_id != null ? String(sub.order_id) : null,
          offerId: sub.offer_id != null ? String(sub.offer_id) : null,
          source: "kwiga_sync",
          revokedAt: null,
          revokedReason: null,
          lastSyncedAt: now,
        });
      }
    }

    if (accessRows.length > 0) {
      await ContactProductAccess.bulkCreate(accessRows, { transaction: t, validate: true });
    }
  });
}

function parseCli() {
  const argv = process.argv.slice(2);
  let contactsOnly = process.env.SYNC_CONTACTS_ONLY === "true";
  let maxPages: number | undefined =
    process.env.SYNC_MAX_PAGES != null && process.env.SYNC_MAX_PAGES !== ""
      ? parseInt(process.env.SYNC_MAX_PAGES, 10)
      : undefined;
  let startPage = 1;

  for (const a of argv) {
    if (a === "--contacts-only") contactsOnly = true;
    else if (a.startsWith("--max-pages=")) maxPages = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--start-page=")) startPage = parseInt(a.split("=")[1], 10) || 1;
  }

  if (maxPages !== undefined && (Number.isNaN(maxPages) || maxPages < 1)) maxPages = undefined;
  return { contactsOnly, maxPages, startPage };
}

async function run(): Promise<void> {
  const { contactsOnly, maxPages, startPage } = parseCli();
  await sequelize.authenticate();
  console.log(
    `Sync from Kwiga (per_page=${PER_PAGE}, contactsOnly=${contactsOnly}, maxPages=${maxPages ?? "∞"}, startPage=${startPage})`,
  );

  let page = startPage;
  let totalContacts = 0;
  let totalProductSyncs = 0;
  let productErrors = 0;

  while (true) {
    if (maxPages !== undefined && page - startPage >= maxPages) break;

    const { contacts, meta } = await fetchContactsPage(page);
    if (contacts.length === 0) break;

    for (const apiContact of contacts) {
      const row = mapApiContactToRow(apiContact);
      await Contact.upsert(row, {
        conflictFields: ["external_id"] as unknown as (keyof ContactAttributes)[],
      });

      const contact = await Contact.findOne({
        where: { externalId: apiContact.id },
        attributes: ["id"],
      });
      if (!contact) {
        console.error("Contact row missing after upsert, external_id=", apiContact.id);
        continue;
      }
      totalContacts += 1;

      if (!contactsOnly) {
        try {
          const products = await fetchContactProducts(apiContact.id);
          await syncProductsAndAccess(contact.id, products);
          totalProductSyncs += 1;
        } catch (e) {
          productErrors += 1;
          console.error(`Products sync failed contact Kwiga id=${apiContact.id}:`, e);
        }
        if (MS_DELAY > 0) await sleep(MS_DELAY);
      }
    }

    console.log(`Page ${page}: processed ${contacts.length} contacts (total contacts this run: ${totalContacts})`);

    const lastPage = meta?.last_page;
    if (typeof lastPage === "number" && lastPage > 0) {
      if (page >= lastPage) break;
    } else if (contacts.length < PER_PAGE) {
      break;
    }
    page += 1;
  }

  console.log(
    `Done. Contacts touched: ${totalContacts}. Product API syncs: ${totalProductSyncs}. Product errors: ${productErrors}.`,
  );
}

void run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
