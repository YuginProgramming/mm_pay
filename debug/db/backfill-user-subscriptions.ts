/**
 * Backfill script: create user_subscriptions from historical payment_hook rows.
 *
 * Usage:
 *   npx ts-node debug/backfill-user-subscriptions.ts
 *   npx ts-node debug/backfill-user-subscriptions.ts --dry-run
 */
import "dotenv/config";
import { QueryTypes } from "sequelize";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { UserSubscription } from "../../database/UserSubscription";
import { sequelize } from "../../database/db";

type CandidateRow = {
  user_id: string;
  start_at: Date;
  end_at: Date;
  last_payment_order_reference: string | null;
  access_rows: number;
};

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function getMonthlyPlanId(): Promise<number> {
  const plan = await SubscriptionPlan.findOne({
    where: { code: "monthly_1m", isActive: true },
    attributes: ["id"],
  });
  if (!plan) {
    throw new Error(
      "Plan monthly_1m not found. Run migrations/seed before backfill.",
    );
  }
  return plan.id;
}

async function fetchCandidates(): Promise<CandidateRow[]> {
  return sequelize.query<CandidateRow>(
    `
    SELECT
      tu.telegram_id::text AS user_id,
      MIN(COALESCE(cpa.start_at, cpa.paid_at, cpa.created_at)) AS start_at,
      MAX(
        COALESCE(
          cpa.end_at,
          cpa.paid_at + INTERVAL '30 days',
          cpa.created_at + INTERVAL '30 days'
        )
      ) AS end_at,
      (
        ARRAY_REMOVE(
          ARRAY_AGG(
            cpa.wayforpay_order_reference
            ORDER BY COALESCE(cpa.paid_at, cpa.created_at) DESC
          ),
          NULL
        )
      )[1] AS last_payment_order_reference,
      COUNT(*)::int AS access_rows
    FROM telegram_users tu
    INNER JOIN contacts c
      ON lower(c.email) = lower(tu.email)
    INNER JOIN contact_product_access cpa
      ON cpa.contact_id = c.id
    WHERE tu.email IS NOT NULL
      AND cpa.source = 'payment_hook'
      AND cpa.is_paid = true
      AND cpa.revoked_at IS NULL
    GROUP BY tu.telegram_id
    ORDER BY tu.telegram_id;
    `,
    { type: QueryTypes.SELECT },
  );
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  await sequelize.authenticate();

  const planId = await getMonthlyPlanId();
  const candidates = await fetchCandidates();

  let created = 0;
  let skipped = 0;

  console.log(
    `[backfill-user-subscriptions] mode=${dryRun ? "dry-run" : "write"} candidates=${candidates.length}`,
  );

  for (const c of candidates) {
    const existing = await UserSubscription.findOne({
      where: { userId: c.user_id, planId },
      attributes: ["id"],
    });

    if (existing) {
      skipped += 1;
      console.log(
        JSON.stringify({
          action: "skipped_existing",
          user_id: c.user_id,
          plan_id: planId,
        }),
      );
      continue;
    }

    const status = c.end_at > new Date() ? "active" : "lapsed";
    const payload = {
      userId: c.user_id,
      planId,
      status,
      startAt: c.start_at,
      endAt: c.end_at,
      lastPaymentOrderReference: c.last_payment_order_reference,
    } as const;

    if (!dryRun) {
      await UserSubscription.create(payload);
    }

    created += 1;
    console.log(
      JSON.stringify({
        action: dryRun ? "would_create" : "created",
        user_id: c.user_id,
        plan_id: planId,
        status,
        start_at: c.start_at,
        end_at: c.end_at,
        last_payment_order_reference: c.last_payment_order_reference,
        access_rows: c.access_rows,
      }),
    );
  }

  console.log(
    JSON.stringify({
      summary: true,
      mode: dryRun ? "dry-run" : "write",
      candidates: candidates.length,
      created,
      skipped,
    }),
  );
}

void main()
  .catch((err) => {
    console.error("[backfill-user-subscriptions] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
