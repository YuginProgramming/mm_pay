import "dotenv/config";
import { QueryTypes } from "sequelize";
import { EFFECTIVE_ACCESS_SQL } from "../database/access-queries";
import { sequelize } from "../database/db";

/**
 * Counts contacts by how many *effective* product access rows they have
 * (same rules as database/access-queries.ts — DB only, no Kwiga API).
 *
 * Run from project root:
 *   npx ts-node users/contact-access-count.ts
 */

type CountRow = {
  zero_products: string;
  one_to_four: string;
  five_plus: string;
};

function effectivePredicateOnJoin(): string {
  return EFFECTIVE_ACCESS_SQL.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

async function getAccessCountBuckets(): Promise<CountRow> {
  const pred = effectivePredicateOnJoin();
  const [row] = await sequelize.query<CountRow>(
    `
    SELECT
      COUNT(*) FILTER (WHERE n = 0)::bigint AS zero_products,
      COUNT(*) FILTER (WHERE n BETWEEN 1 AND 4)::bigint AS one_to_four,
      COUNT(*) FILTER (WHERE n >= 5)::bigint AS five_plus
    FROM (
      SELECT c.id, COUNT(a.id)::int AS n
      FROM contacts c
      LEFT JOIN contact_product_access a
        ON a.contact_id = c.id AND (${pred})
      GROUP BY c.id
    ) t
    `,
    { type: QueryTypes.SELECT },
  );
  if (!row) {
    return { zero_products: "0", one_to_four: "0", five_plus: "0" };
  }
  return row;
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const r = await getAccessCountBuckets();
  const z = Number(r.zero_products);
  const m = Number(r.one_to_four);
  const p = Number(r.five_plus);

  console.log("Contacts by effective product access count (SQL / contact_product_access):");
  console.log(`  0 products:     ${z.toLocaleString()}`);
  console.log(`  1–4 products:   ${m.toLocaleString()}`);
  console.log(`  5+ products:    ${p.toLocaleString()}`);
  console.log(`  Total contacts: ${(z + m + p).toLocaleString()}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
