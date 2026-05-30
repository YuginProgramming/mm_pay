/**
 * Звіт: контакти з KWIGA, створені у квітні–травні, з ≥1 продуктом у contact_product_access
 * (будь-який статус active/revoked), у яких пов’язаний telegram_users має
 * kwiga_audience_rank не masters і не pro.
 *
 * Запуск (з кореня проєкту):
 *   npx ts-node debug/users/list-contacts-multi-product-non-masters-pro.ts
 *   npx ts-node debug/users/list-contacts-multi-product-non-masters-pro.ts --year=2026
 *
 * --year=YYYY   рік для вікна 1 квітня – 31 травня (за замовчуванням поточний рік)
 */
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/db";
import type { KwigaAudienceRank } from "../../telegram/profile/kwiga-user-rank";

type ReportRow = {
  contact_id: number;
  contact_external_id: number;
  contact_email: string;
  contact_created_at: Date | null;
  access_row_count: number;
  distinct_product_count: number;
  telegram_user_id: number;
  telegram_id: string;
  telegram_email: string | null;
  kwiga_audience_rank: KwigaAudienceRank | null;
};

type FunnelRow = {
  step1_contacts_apr_may: number;
  step2_at_least_one_product: number;
  step3_non_masters_pro_rank: number;
};

function parseYearArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--year="));
  if (arg) {
    const y = Number(arg.slice("--year=".length));
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) return y;
    throw new Error(`Некоректний --year: ${arg}`);
  }
  return new Date().getFullYear();
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const year = parseYearArg();
  const rangeStart = new Date(Date.UTC(year, 3, 1, 0, 0, 0, 0));
  const rangeEnd = new Date(Date.UTC(year, 5, 1, 0, 0, 0, 0));

  const funnel = await sequelize.query<FunnelRow>(
    `
    WITH dated_contacts AS (
      SELECT c.id
      FROM contacts c
      WHERE COALESCE(c.created_at_from_api, c.created_at) >= :rangeStart
        AND COALESCE(c.created_at_from_api, c.created_at) < :rangeEnd
    ),
    with_product AS (
      SELECT DISTINCT c.id AS contact_id
      FROM dated_contacts c
      INNER JOIN contact_product_access a ON a.contact_id = c.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM dated_contacts) AS step1_contacts_apr_may,
      (SELECT COUNT(*)::int FROM with_product) AS step2_at_least_one_product,
      (
        SELECT COUNT(*)::int
        FROM with_product wp
        INNER JOIN contacts c ON c.id = wp.contact_id
        INNER JOIN telegram_users tu
          ON LOWER(TRIM(tu.email)) = LOWER(TRIM(c.email))
        WHERE tu.kwiga_audience_rank IS DISTINCT FROM 'masters'
          AND tu.kwiga_audience_rank IS DISTINCT FROM 'pro'
      ) AS step3_non_masters_pro_rank
    `,
    {
      replacements: { rangeStart, rangeEnd },
      type: QueryTypes.SELECT,
    },
  );

  const rows = await sequelize.query<ReportRow>(
    `
    WITH dated_contacts AS (
      SELECT c.id, c.external_id, c.email, COALESCE(c.created_at_from_api, c.created_at) AS contact_created_at
      FROM contacts c
      WHERE COALESCE(c.created_at_from_api, c.created_at) >= :rangeStart
        AND COALESCE(c.created_at_from_api, c.created_at) < :rangeEnd
    ),
    with_product AS (
      SELECT
        c.id AS contact_id,
        c.external_id AS contact_external_id,
        c.email AS contact_email,
        c.contact_created_at,
        COUNT(a.id)::int AS access_row_count,
        COUNT(DISTINCT a.external_product_id)::int AS distinct_product_count
      FROM dated_contacts c
      INNER JOIN contact_product_access a ON a.contact_id = c.id
      GROUP BY c.id, c.external_id, c.email, c.contact_created_at
      HAVING COUNT(a.id) >= 1
    )
    SELECT
      wp.contact_id,
      wp.contact_external_id,
      wp.contact_email,
      wp.contact_created_at,
      wp.access_row_count,
      wp.distinct_product_count,
      tu.id AS telegram_user_id,
      tu.telegram_id::text AS telegram_id,
      tu.email AS telegram_email,
      tu.kwiga_audience_rank
    FROM with_product wp
    INNER JOIN telegram_users tu
      ON LOWER(TRIM(tu.email)) = LOWER(TRIM(wp.contact_email))
    WHERE tu.kwiga_audience_rank IS DISTINCT FROM 'masters'
      AND tu.kwiga_audience_rank IS DISTINCT FROM 'pro'
    ORDER BY wp.contact_created_at ASC NULLS LAST, wp.contact_email ASC
    `,
    {
      replacements: { rangeStart, rangeEnd },
      type: QueryTypes.SELECT,
    },
  );

  console.log("=== Contacts: Apr–May, ≥1 product, rank ≠ masters/pro ===\n");
  console.log({
    year,
    createdAtWindowUtc: {
      from: rangeStart.toISOString(),
      toExclusive: rangeEnd.toISOString(),
    },
    createdAtField: "COALESCE(created_at_from_api, created_at)",
    productMetric: "contact_product_access rows (≥1, any status)",
    funnel: funnel[0] ?? {
      step1_contacts_apr_may: 0,
      step2_at_least_one_product: 0,
      step3_non_masters_pro_rank: 0,
    },
    resultCount: rows.length,
  });
  console.log("");

  for (const r of rows) {
    console.log(
      JSON.stringify({
        contactId: r.contact_id,
        contactExternalId: r.contact_external_id,
        email: r.contact_email,
        contactCreatedAt: r.contact_created_at?.toISOString() ?? null,
        accessRowCount: r.access_row_count,
        distinctProductCount: r.distinct_product_count,
        telegramUserId: r.telegram_user_id,
        telegramId: r.telegram_id,
        telegramEmail: r.telegram_email,
        kwigaAudienceRank: r.kwiga_audience_rank,
      }),
    );
  }

  if (rows.length === 0) {
    console.log("\n(Немає рядків за цими фільтрами.)");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
