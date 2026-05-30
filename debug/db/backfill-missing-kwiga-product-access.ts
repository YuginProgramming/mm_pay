/**
 * Backfill contact_product_access for contacts that have Kwiga offers in `contacts`
 * but zero rows in contact_product_access (product sync step was failing).
 *
 * Usage:
 *   npx ts-node debug/db/backfill-missing-kwiga-product-access.ts --dry-run
 *   npx ts-node debug/db/backfill-missing-kwiga-product-access.ts
 *   npx ts-node debug/db/backfill-missing-kwiga-product-access.ts --email=krakazyabryk@gmail.com
 *   npx ts-node debug/db/backfill-missing-kwiga-product-access.ts --limit=10
 *
 * Requires KWIGA_TOKEN and KWIGA_CABINET_HASH in .env.
 */
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { sequelize } from "../../database/db";
import { normalizeEmail } from "../../database/normalize-email";
import {
  assertKwigaEnv,
  syncKwigaContactProductsToDb,
} from "../../database/sync-from-kwiga";

type CandidateRow = {
  id: number;
  external_id: number;
  email: string;
  offers_len: number;
  access_rows: number;
};

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function parseEmailArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--email="));
  if (!arg) return null;
  const email = normalizeEmail(arg.slice("--email=".length));
  return email || null;
}

function parseLimitArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = parseInt(arg.slice("--limit=".length), 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid --limit: ${arg}`);
  }
  return n;
}

async function fetchCandidates(emailFilter: string | null): Promise<CandidateRow[]> {
  const emailClause = emailFilter ? "AND LOWER(TRIM(c.email)) = LOWER(TRIM(:email))" : "";
  return sequelize.query<CandidateRow>(
    `
    SELECT
      c.id,
      c.external_id,
      c.email,
      jsonb_array_length(COALESCE(c.offers, '[]'::jsonb))::int AS offers_len,
      (
        SELECT COUNT(*)::int
        FROM contact_product_access a
        WHERE a.contact_id = c.id
      ) AS access_rows
    FROM contacts c
    WHERE jsonb_array_length(COALESCE(c.offers, '[]'::jsonb)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM contact_product_access a WHERE a.contact_id = c.id
      )
      ${emailClause}
    ORDER BY c.id ASC
    `,
    {
      replacements: emailFilter ? { email: emailFilter } : {},
      type: QueryTypes.SELECT,
    },
  );
}

async function main(): Promise<void> {
  assertKwigaEnv();
  await sequelize.authenticate();

  const dryRun = isDryRun();
  const emailFilter = parseEmailArg();
  const limit = parseLimitArg();

  let candidates = await fetchCandidates(emailFilter);
  if (limit !== null) {
    candidates = candidates.slice(0, limit);
  }

  console.log("=== Backfill missing Kwiga product access ===\n");
  console.log({
    dryRun,
    emailFilter,
    limit,
    candidateCount: candidates.length,
  });
  console.log("");

  if (candidates.length === 0) {
    console.log("(No candidates — all contacts with offers already have access rows.)");
    return;
  }

  if (dryRun) {
    for (const c of candidates) {
      console.log(
        JSON.stringify({
          contactId: c.id,
          externalId: c.external_id,
          email: c.email,
          offersLen: c.offers_len,
          accessRowsBefore: c.access_rows,
        }),
      );
    }
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const c of candidates) {
    const before = c.access_rows;
    try {
      await syncKwigaContactProductsToDb(c.external_id, c.id);
      const after = await ContactProductAccess.count({ where: { contactId: c.id } });
      console.log(
        JSON.stringify({
          status: after > before ? "ok" : "no_rows_written",
          contactId: c.id,
          externalId: c.external_id,
          email: c.email,
          accessRowsBefore: before,
          accessRowsAfter: after,
        }),
      );
      if (after > before) ok += 1;
      else failed += 1;
    } catch (e) {
      failed += 1;
      console.log(
        JSON.stringify({
          status: "error",
          contactId: c.id,
          externalId: c.external_id,
          email: c.email,
          accessRowsBefore: before,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  console.log("");
  console.log({ ok, failed, total: candidates.length });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
