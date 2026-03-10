import "dotenv/config";
import { Contact } from "./Contact";
import { sequelize } from "./db";
import type {
  ContactAttributes,
  ContactOfferRecord,
  ContactOrderRecord,
  ContactPaymentRecord,
  ContactTagRecord,
} from "./Contact";

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const TOKEN = process.env.KWIGA_TOKEN;
const CABINET_HASH = process.env.KWIGA_CABINET_HASH;

if (!TOKEN || !CABINET_HASH) {
  console.error("Missing KWIGA_TOKEN or KWIGA_CABINET_HASH in .env");
  process.exit(1);
}

// API response types (Kwiga)
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
type ApiContactsResponse = { data: ApiContact[]; meta?: { total?: number } };

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

async function fetchContactsPage(page: number): Promise<ApiContact[]> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "15");
  url.searchParams.set("with_orders", "1");
  url.searchParams.set("with_certificates", "1");
  url.searchParams.set("with_offers", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Token: TOKEN as string,
      "Cabinet-Hash": CABINET_HASH as string,
    },
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as ApiContactsResponse;
  return body.data ?? [];
}

async function updateTable(): Promise<void> {
  await sequelize.authenticate();
  console.log("Connected to DB. Fetching contacts from API...");

  let page = 1;
  let totalUpserted = 0;

  while (true) {
    const contacts = await fetchContactsPage(page);
    if (contacts.length === 0) break;

    for (const apiContact of contacts) {
      const row = mapApiContactToRow(apiContact);
      await Contact.upsert(row, {
        conflictFields: ["external_id"] as unknown as (keyof ContactAttributes)[],
      });
      totalUpserted += 1;
    }

    console.log(`Page ${page}: upserted ${contacts.length} contacts (total so far: ${totalUpserted})`);
    if (contacts.length < 15) break;
    page += 1;
  }

  console.log(`Done. Total contacts upserted: ${totalUpserted}`);
}

async function main() {
  try {
    await updateTable();
  } catch (e) {
    console.error("Update failed:", e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

void main();
