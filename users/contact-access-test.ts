import "dotenv/config";

/**
 * Find a contact by email and print product / subscription access from Kwiga API.
 *
 * Usage:
 *   npx ts-node users/contact-access-test.ts
 *   npx ts-node users/contact-access-test.ts other@email.com
 */

const DEFAULT_EMAIL = "kozlovskaraisa1@gmail.com";

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const TOKEN = process.env.KWIGA_TOKEN;
const CABINET_HASH = process.env.KWIGA_CABINET_HASH;

const targetEmail = (process.argv[2]?.trim() || DEFAULT_EMAIL).toLowerCase();

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

type ApiContact = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  created_at?: string;
};

type ContactsListResponse = { data: ApiContact[]; meta?: { total?: number } };

type SubscriptionState = { id?: number; name?: string; title?: string };

type AggregatedSubscription = {
  is_active?: boolean;
  is_paid?: boolean;
  start_at?: string | null;
  end_at?: string | null;
  offer_end_at?: string | null;
  order_end_at?: string | null;
  count_available_days?: number | null;
  count_left_days?: number | null;
  state?: SubscriptionState;
};

type SubscriptionRow = {
  id: number;
  is_active?: boolean;
  start_at?: string | null;
  end_at?: string | null;
  paid_at?: string | null;
  order_id?: number;
  offer_id?: number;
};

type ContactProduct = {
  id: number;
  productable_id: number;
  productable_type: string;
  title: string;
  image_url?: string;
  is_published?: boolean;
  aggregated_subscription?: AggregatedSubscription;
  subscriptions?: SubscriptionRow[];
};

type ContactProductsResponse = { data: ContactProduct[] };

async function searchContactByEmail(email: string): Promise<ApiContact | null> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("filters[search]", email);

  const res = await fetch(url, { method: "GET", headers });
  console.log("GET /contacts (search):", res.status, res.statusText);
  if (!res.ok) {
    console.error(await res.text());
    return null;
  }
  const body = (await res.json()) as ContactsListResponse;
  const list = body.data ?? [];
  const exact = list.find((c) => c.email.toLowerCase() === email.toLowerCase());
  if (exact) return exact;
  if (list.length === 1) return list[0];
  console.warn(
    `No exact email match; API returned ${list.length} row(s). First few emails:`,
    list.slice(0, 5).map((c) => c.email),
  );
  return null;
}

async function fetchContactProducts(contactId: number): Promise<ContactProduct[]> {
  const url = `${BASE_URL}/contacts/${contactId}/products`;
  const res = await fetch(url, { method: "GET", headers });
  console.log("GET /contacts/:id/products:", res.status, res.statusText);
  if (!res.ok) {
    console.error(await res.text());
    return [];
  }
  const body = (await res.json()) as ContactProductsResponse;
  return body.data ?? [];
}

async function fetchCourseUserSnapshot(
  courseId: number,
  contactId: number,
): Promise<unknown | null> {
  const url = new URL(`${BASE_URL}/courses/${courseId}/users`);
  url.searchParams.set("contact_id", String(contactId));
  url.searchParams.set("per_page", "5");

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    console.warn(`GET /courses/${courseId}/users?contact_id=… failed:`, res.status);
    return null;
  }
  const body = (await res.json()) as { data?: unknown[] };
  const rows = body.data ?? [];
  return rows[0] ?? null;
}

function summarizeProduct(p: ContactProduct) {
  const agg = p.aggregated_subscription;
  const subs = p.subscriptions ?? [];
  return {
    product_id: p.id,
    title: p.title,
    kind: p.productable_type,
    productable_id: p.productable_id,
    is_published: p.is_published,
    access_summary: agg
      ? {
          is_active: agg.is_active,
          is_paid: agg.is_paid,
          start_at: agg.start_at,
          end_at: agg.end_at,
          state: agg.state?.title ?? agg.state?.name,
          count_available_days: agg.count_available_days,
          count_left_days: agg.count_left_days,
        }
      : null,
    subscriptions_count: subs.length,
    subscriptions: subs.map((s) => ({
      id: s.id,
      is_active: s.is_active,
      start_at: s.start_at,
      end_at: s.end_at,
      paid_at: s.paid_at,
      order_id: s.order_id,
      offer_id: s.offer_id,
    })),
  };
}

async function main() {
  console.log("Looking up:", targetEmail);
  const contact = await searchContactByEmail(targetEmail);
  if (!contact) {
    console.error("Contact not found for that email.");
    process.exit(1);
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
  console.log("\n--- Contact ---");
  console.log(
    JSON.stringify(
      {
        id: contact.id,
        email: contact.email,
        name,
        phone: contact.phone ?? null,
        created_at: contact.created_at ?? null,
      },
      null,
      2,
    ),
  );

  const products = await fetchContactProducts(contact.id);
  console.log("\n--- Product / subscription access (GET /contacts/:id/products) ---");
  console.log(JSON.stringify(products.map(summarizeProduct), null, 2));

  const courseProducts = products.filter((p) => p.productable_type === "course");
  if (courseProducts.length > 0) {
    console.log("\n--- Course progress snapshot (GET /courses/:course/users?contact_id=…) ---");
    for (const p of courseProducts) {
      const snap = await fetchCourseUserSnapshot(p.productable_id, contact.id);
      console.log(
        `\nCourse productable_id=${p.productable_id} (${p.title}):\n`,
        JSON.stringify(snap, null, 2),
      );
    }
  }
}

void main();
