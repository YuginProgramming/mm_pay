/**
 * S0 smoke: Kwiga Public API exact end-date
 *   GET /contacts/{id}/products
 *   PUT /contacts/{id}/products/{product}/end-date  (no timezone_id → UTC)
 *   GET again to verify
 *
 * Dry-run (default): only GET + print intended PUTs.
 * Apply: PUT, verify, then restore previous end_at (unless --no-restore).
 *
 *   npx ts-node debug/kwiga/smoke-kwiga-end-date.ts --email=user@example.com
 *   npx ts-node debug/kwiga/smoke-kwiga-end-date.ts --email=user@example.com --apply
 *   npx ts-node debug/kwiga/smoke-kwiga-end-date.ts --email=user@example.com --apply --until=2026-09-01T23:59:59Z
 *   npx ts-node debug/kwiga/smoke-kwiga-end-date.ts --email=user@example.com --apply --no-restore
 *
 * TA: TZ/kwiga-recurring-prolong.md §13 / sprint S0
 */
import "dotenv/config";
import { normalizeEmail } from "../../database/normalize-email";
import {
  fetchKwigaContactProducts,
  putKwigaProductEndDate,
  searchKwigaContactByEmail,
} from "../../kwiga/kwiga-api-client";
import { KWIGA_BASE_URL, requireKwigaCredentials } from "../../kwiga/kwiga-config";
import {
  effectiveKwigaProductEndAt,
  formatKwigaEndAtForPut,
  toKwigaIso,
} from "../../kwiga/kwiga-product";
import type { KwigaProduct } from "../../kwiga/kwiga-types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(): {
  email: string | null;
  contactId: number | null;
  apply: boolean;
  noRestore: boolean;
  until: Date | null;
} {
  const argv = process.argv.slice(2);
  let email: string | null = null;
  let contactId: number | null = null;
  let apply = false;
  let noRestore = false;
  let until: Date | null = null;

  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--no-restore") noRestore = true;
    else if (arg.startsWith("--email=")) {
      email = normalizeEmail(arg.slice("--email=".length).trim()) || null;
    } else if (arg.startsWith("--contact-id=")) {
      const n = Number.parseInt(arg.slice("--contact-id=".length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --contact-id`);
      }
      contactId = n;
    } else if (arg.startsWith("--until=")) {
      const raw = arg.slice("--until=".length).trim();
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid --until=${raw}`);
      }
      until = d;
    }
  }

  if (!email && contactId == null) {
    throw new Error(
      "Usage: --email=user@example.com | --contact-id=123 [--apply] [--until=ISO] [--no-restore]",
    );
  }

  return { email, contactId, apply, noRestore, until };
}

function summarizeProducts(products: KwigaProduct[]): Array<Record<string, unknown>> {
  return products.map((p) => {
    const end = effectiveKwigaProductEndAt(p);
    return {
      product_id: p.id,
      title: p.title,
      effective_end_at: toKwigaIso(end),
      subs: (p.subscriptions ?? []).map((s) => ({
        id: s.id,
        offer_id: s.offer_id ?? null,
        end_at: s.end_at ?? null,
      })),
    };
  });
}

async function main(): Promise<void> {
  requireKwigaCredentials();
  const args = parseArgs();

  console.log("--- S0 smoke: Kwiga PUT .../end-date ---");
  console.log({
    email: args.email,
    contactId: args.contactId,
    apply: args.apply,
    noRestore: args.noRestore,
    until: args.until?.toISOString() ?? "(default: now+2 days UTC)",
    baseUrl: KWIGA_BASE_URL,
  });

  let contactId = args.contactId;
  let contactEmail: string | null = args.email;

  if (contactId == null) {
    const contact = await searchKwigaContactByEmail(args.email!);
    if (!contact) {
      console.error("No Kwiga contact for email:", args.email);
      process.exit(1);
    }
    contactId = contact.id;
    contactEmail = contact.email;
  }

  console.log("Kwiga contact id:", contactId, "email:", contactEmail ?? "(via --contact-id)");

  const before = await fetchKwigaContactProducts(contactId);
  console.log("\n=== GET products (before) count:", before.length);
  console.log(JSON.stringify(summarizeProducts(before), null, 2));

  if (before.length === 0) {
    console.error("No products — cannot smoke PUT end-date.");
    process.exit(1);
  }

  const target =
    args.until ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 2);
      d.setUTCHours(23, 59, 59, 0);
      return d;
    })();
  const endAtFormatted = formatKwigaEndAtForPut(target);

  console.log("\n=== Intended PUT body (no timezone_id) ===");
  console.log({ end_at: endAtFormatted });
  console.log("URL pattern: PUT /contacts/%s/products/{product.id}/end-date", contactId);
  console.log("product.id values:", before.map((p) => p.id).join(", "));

  if (!args.apply) {
    console.log("\nDry-run only. Re-run with --apply to PUT (then restore unless --no-restore).");
    return;
  }

  const originals = before.map((p) => ({
    productId: p.id,
    title: p.title,
    end: effectiveKwigaProductEndAt(p),
  }));

  console.log("\n=== Applying PUT for each product (500 ms gap) ===");
  for (let i = 0; i < before.length; i += 1) {
    const p = before[i];
    try {
      const updated = await putKwigaProductEndDate({
        kwigaContactId: contactId,
        productId: p.id,
        endAt: target,
      });
      console.log({
        productId: p.id,
        title: p.title,
        ok: true,
        responseEnd: updated.aggregated_subscription?.end_at ?? null,
      });
    } catch (err) {
      console.error({
        productId: p.id,
        title: p.title,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("PUT failed — aborting further products.");
      process.exit(1);
    }
    if (i < before.length - 1) {
      await sleep(500);
    }
  }

  const after = await fetchKwigaContactProducts(contactId);
  console.log("\n=== GET products (after PUT) ===");
  console.log(JSON.stringify(summarizeProducts(after), null, 2));

  const mismatches: string[] = [];
  for (const p of after) {
    const end = effectiveKwigaProductEndAt(p);
    if (!end) {
      mismatches.push(`product ${p.id}: end_at null after PUT`);
      continue;
    }
    // Compare calendar day UTC (Kwiga may normalize time)
    const gotDay = end.toISOString().slice(0, 10);
    const wantDay = target.toISOString().slice(0, 10);
    if (gotDay !== wantDay) {
      mismatches.push(
        `product ${p.id}: got ${end.toISOString()} want day ${wantDay}`,
      );
    }
  }

  if (mismatches.length > 0) {
    console.error("\nVERIFY FAILED:", mismatches);
  } else {
    console.log("\nVERIFY OK: all products effective end day matches target (UTC day).");
  }

  console.log("\n=== S0 findings ===");
  console.log(
    JSON.stringify(
      {
        contactIdField: "contact.id from search",
        productIdField: "product.id from GET /products (used in PUT URL)",
        endAtFormatTried: endAtFormatted,
        timezone_id: "omitted",
        putSucceeded: mismatches.length === 0,
      },
      null,
      2,
    ),
  );

  if (args.noRestore) {
    console.log("\n--no-restore: leaving new end dates in place.");
    return;
  }

  console.log("\n=== Restoring previous end dates (500 ms gap) ===");
  for (let i = 0; i < originals.length; i += 1) {
    const o = originals[i];
    if (o.end == null) {
      console.warn("Skip restore product", o.productId, "— previous end was null");
      continue;
    }
    const formatted = formatKwigaEndAtForPut(o.end);
    try {
      await putKwigaProductEndDate({
        kwigaContactId: contactId,
        productId: o.productId,
        endAt: o.end,
      });
      console.log({ productId: o.productId, restoredTo: formatted, ok: true });
    } catch (err) {
      console.log({
        productId: o.productId,
        restoredTo: formatted,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (i < originals.length - 1) {
      await sleep(500);
    }
  }

  const restored = await fetchKwigaContactProducts(contactId);
  console.log("\n=== GET products (after restore) ===");
  console.log(JSON.stringify(summarizeProducts(restored), null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
