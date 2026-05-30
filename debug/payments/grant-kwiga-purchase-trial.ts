/**
 * Trial: grant Kwiga access via POST /contacts/purchases (Option B).
 * Default contact: natalizinoveva923@gmail.com
 *
 * Uses each product's existing offer_id from GET /contacts/:id/products
 * (same offers the user bought originally).
 *
 *   npx ts-node debug/grant-kwiga-purchase-trial.ts
 *   npx ts-node debug/grant-kwiga-purchase-trial.ts --apply
 *   npx ts-node debug/grant-kwiga-purchase-trial.ts --offer-id=548416 --apply
 *   npx ts-node debug/grant-kwiga-purchase-trial.ts --apply --sync
 *
 * Requires .env: KWIGA_TOKEN, KWIGA_CABINET_HASH
 */
import "dotenv/config";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { sequelize } from "../../database/db";
import { normalizeEmail } from "../../database/normalize-email";
import { assertKwigaEnv, syncKwigaContactProductsToDb } from "../../database/sync-from-kwiga";

const DEFAULT_EMAIL = "natalizinoveva923@gmail.com";
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

type KwigaSubscription = {
  id: number;
  offer_id?: number;
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

type GrantPlan = {
  product_id: number;
  product_title: string;
  offer_id: number;
  previous_end_at: string | null;
  subscription_id: number | null;
};

function parseArgs(): {
  email: string;
  apply: boolean;
  syncLocal: boolean;
  offerIds: number[] | null;
  allProducts: boolean;
} {
  const argv = process.argv.slice(2);
  let email = DEFAULT_EMAIL;
  let apply = false;
  let syncLocal = false;
  let allProducts = true;
  const offerIds: number[] = [];

  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--sync") syncLocal = true;
    else if (a === "--all") allProducts = true;
    else if (a.startsWith("--offer-id=")) {
      allProducts = false;
      const id = parseInt(a.slice("--offer-id=".length), 10);
      if (!Number.isNaN(id)) offerIds.push(id);
    } else if (!a.startsWith("-")) {
      email = a;
    }
  }

  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(`Invalid email: ${email}`);
  if (normalized !== normalizeEmail(DEFAULT_EMAIL)) {
    console.warn(
      `Warning: this trial script is intended for ${DEFAULT_EMAIL}. You passed ${normalized}.`,
    );
  }

  return {
    email: normalized,
    apply,
    syncLocal,
    offerIds: offerIds.length > 0 ? offerIds : null,
    allProducts,
  };
}

async function searchKwigaContact(email: string): Promise<ApiContact | null> {
  const url = new URL(`${BASE_URL}/contacts`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("filters[search]", email);

  const res = await fetch(url, { method: "GET", headers: kwigaHeaders() });
  if (!res.ok) throw new Error(`GET /contacts ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { data?: ApiContact[] };
  const list = body.data ?? [];
  return list.find((c) => c.email.toLowerCase() === email) ?? list[0] ?? null;
}

async function fetchKwigaProducts(kwigaContactId: number): Promise<KwigaProduct[]> {
  const res = await fetch(`${BASE_URL}/contacts/${kwigaContactId}/products`, {
    method: "GET",
    headers: kwigaHeaders(),
  });
  if (!res.ok) {
    throw new Error(`GET /contacts/:id/products ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: KwigaProduct[] };
  return body.data ?? [];
}

function buildGrantPlans(products: KwigaProduct[], filterOfferIds: number[] | null): GrantPlan[] {
  const plans: GrantPlan[] = [];
  const seenOffers = new Set<number>();

  for (const p of products) {
    const sub = p.subscriptions?.[0];
    const offerId = sub?.offer_id;
    if (!offerId) {
      console.warn(`Skip product ${p.id} (${p.title}): no offer_id on subscription`);
      continue;
    }
    if (filterOfferIds && !filterOfferIds.includes(offerId)) continue;
    if (seenOffers.has(offerId)) continue;
    seenOffers.add(offerId);

    plans.push({
      product_id: p.id,
      product_title: p.title,
      offer_id: offerId,
      previous_end_at: sub?.end_at ?? p.aggregated_subscription?.end_at ?? null,
      subscription_id: sub?.id ?? null,
    });
  }

  return plans;
}

async function postPurchase(email: string, offerId: number): Promise<unknown> {
  const body = {
    email,
    offer_id: offerId,
    is_paid: true,
    send_activation_email: false,
    send_product_access_email: false,
    send_payment_success_email: false,
    comment: "Debug trial: POST /contacts/purchases (Option B)",
  };

  const res = await fetch(`${BASE_URL}/contacts/purchases`, {
    method: "POST",
    headers: kwigaHeaders(),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    /* keep text */
  }

  if (!res.ok) {
    throw new Error(`POST /contacts/purchases offer_id=${offerId} ${res.status}: ${text}`);
  }
  return parsed;
}

function summarizeProducts(products: KwigaProduct[]) {
  return products.flatMap((p) =>
    (p.subscriptions ?? []).map((s) => ({
      product_id: p.id,
      title: p.title.slice(0, 50),
      subscription_id: s.id,
      offer_id: s.offer_id ?? null,
      order_id: s.order_id ?? null,
      end_at: s.end_at ?? null,
      is_active: s.is_active ?? null,
      agg_active: p.aggregated_subscription?.is_active ?? null,
    })),
  );
}

async function main(): Promise<void> {
  const { email, apply, syncLocal, offerIds, allProducts } = parseArgs();
  assertKwigaEnv();

  if (apply) {
    await sequelize.authenticate();
  }

  const contact = await searchKwigaContact(email);
  if (!contact) {
    console.error("Kwiga contact not found:", email);
    process.exit(1);
  }

  const productsBefore = await fetchKwigaProducts(contact.id);
  const plans = buildGrantPlans(productsBefore, offerIds);

  if (plans.length === 0) {
    console.error("No grant plans (missing offer_id or filter matched nothing).");
    process.exit(1);
  }

  console.log("--- Kwiga purchase trial (Option B) ---");
  console.log({
    email,
    kwiga_contact_id: contact.id,
    mode: apply ? "APPLY" : "DRY RUN",
    grants: plans.length,
    all_products: allProducts && offerIds === null,
  });

  console.log("\n--- Before (subscriptions) ---");
  console.table(summarizeProducts(productsBefore));

  console.log("\n--- Planned POST /contacts/purchases ---");
  console.table(
    plans.map((p) => ({
      offer_id: p.offer_id,
      product_id: p.product_id,
      product_title: p.product_title.slice(0, 45),
      previous_end_at: p.previous_end_at,
    })),
  );

  if (!apply) {
    console.log(
      "\nDry run only. To execute purchases in Kwiga:\n" +
        `  npx ts-node debug/grant-kwiga-purchase-trial.ts --apply\n` +
        "One product only:\n" +
        `  npx ts-node debug/grant-kwiga-purchase-trial.ts --offer-id=548416 --apply\n` +
        "After apply, verify:\n" +
        `  npx ts-node users/contact-access-test.ts ${email}`,
    );
    return;
  }

  console.log("\n--- Applying purchases ---");
  for (const plan of plans) {
    console.log(`POST offer_id=${plan.offer_id} (${plan.product_title.slice(0, 40)}…)`);
    const result = await postPurchase(email, plan.offer_id);
    const data =
      result && typeof result === "object" && "data" in result
        ? (result as { data?: { orders?: { id: number }[] } }).data
        : null;
    const orderIds = data?.orders?.map((o) => o.id) ?? [];
    console.log("  OK", { new_order_ids: orderIds });
  }

  const productsAfter = await fetchKwigaProducts(contact.id);
  console.log("\n--- After (subscriptions) ---");
  console.table(summarizeProducts(productsAfter));

  if (syncLocal) {
    const local = await findContactByEmailForBot(email);
    if (local && local.externalId === contact.id) {
      console.log("\n--- Sync local DB from Kwiga ---");
      await syncKwigaContactProductsToDb(contact.id, local.id);
      console.log("Local contact_product_access updated.");
    } else {
      console.warn(
        "Skip --sync: no local contacts row or externalId mismatch. Run kwiga:sync or fix contact link.",
      );
    }
  }

  console.log("\nDone. Compare before/after subscription count and end_at.");
  console.log(`  npx ts-node users/contact-access-test.ts ${email}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
