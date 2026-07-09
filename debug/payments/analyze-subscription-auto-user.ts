/**
 * Аналіз одного user_id із subscription_auto:
 *   - чи є валідне списання (wayforpay_webhook_events: Approved + signatureValid),
 *   - жива статусність підписки (WayForPay regularApi STATUS),
 *   - який зараз доступ (contact_product_access + hasActiveMultimaskingAccess + user_subscriptions).
 *
 *   npx ts-node debug/payments/analyze-subscription-auto-user.ts 269694206
 *   npm run debug:analyze-subscription-auto-user -- 269694206
 */
import "dotenv/config";
import { Op } from "sequelize";
import { sequelize } from "../../database/db";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { WayforpayWebhookEvent } from "../../database/WayforpayWebhookEvent";
import { TelegramUser } from "../../database/TelegramUser";
import { UserSubscription } from "../../database/UserSubscription";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { hasActiveMultimaskingAccess } from "../../payment/multimasking-access-status";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "../../payment/multimasking-product";
import { getWayforpayRegularPaymentStatus } from "../../payment/wayforpay-regular-api";
import { getWayforpayMerchantPassword } from "../../payment/payment.config";

function parseUserId(): string | null {
  const arg = process.argv[2]?.trim();
  return arg && /^\d+$/.test(arg) ? arg : null;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function liveWayforpayStatus(anchor: string | null) {
  if (!anchor?.trim()) return { note: "(no anchor_order_reference)" };
  if (!getWayforpayMerchantPassword()) return { note: "(WFP_MERCHANT_PASSWORD not set)" };
  try {
    const s = await getWayforpayRegularPaymentStatus(anchor.trim());
    return {
      status: s.status ?? null,
      mode: s.mode ?? null,
      amount: s.amount ?? null,
      currency: s.currency ?? null,
      nextPaymentDate: s.nextPaymentDate ?? null,
      lastPayedDate: s.lastPayedDate ?? null,
      lastPayedStatus: s.lastPayedStatus ?? null,
      email: s.email ?? null,
      card: s.card ?? null,
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { error: m.slice(0, 200) };
  }
}

async function main(): Promise<void> {
  const userId = parseUserId();
  if (!userId) {
    console.error(
      "Usage: npx ts-node debug/payments/analyze-subscription-auto-user.ts <telegram_user_id>",
    );
    process.exit(1);
  }

  await sequelize.authenticate();
  const cfg = sequelize.config;
  console.log(`DB: ${cfg.database} @ ${cfg.host}:${cfg.port}`);
  console.log(`user_id: ${userId}\n`);

  // 1) subscription_auto
  const autos = await SubscriptionAuto.findAll({ where: { userId } });
  const planById = new Map(
    (await SubscriptionPlan.findAll({ attributes: ["id", "code", "durationDays"] })).map(
      (p) => [p.id, p],
    ),
  );

  const orderRefs = new Set<string>();
  const autoSummaries = [];
  for (const a of autos) {
    if (a.anchorOrderReference) orderRefs.add(a.anchorOrderReference);
    if (a.latestOrderReference) orderRefs.add(a.latestOrderReference);
    autoSummaries.push({
      id: a.id,
      plan_code: planById.get(a.planId)?.code ?? `(plan_id=${a.planId})`,
      anchor_order_reference: a.anchorOrderReference,
      latest_order_reference: a.latestOrderReference,
      has_payment_token: Boolean(a.paymentToken?.trim()),
      auto_renew_enabled: a.autoRenewEnabled,
      db_wayforpay_status: a.wayforpayStatus,
      db_wayforpay_mode: a.wayforpayMode,
      db_next_charge_at: iso(a.nextChargeAt),
      db_last_charge_status: a.lastChargeStatus,
      db_last_charge_at: iso(a.lastChargeAt),
      cancelled_at: iso(a.cancelledAt),
      live_wayforpay: await liveWayforpayStatus(a.anchorOrderReference),
    });
  }

  console.log("=== subscription_auto ===");
  console.log(JSON.stringify(autoSummaries, null, 2), "\n");

  // 2) webhook events for this user (by chat metadata OR known order refs)
  const webhooks = await WayforpayWebhookEvent.findAll({
    where: {
      [Op.or]: [
        { metadataChatId: userId },
        ...(orderRefs.size ? [{ orderReference: { [Op.in]: [...orderRefs] } }] : []),
      ],
    },
    order: [["id", "ASC"]],
  });

  const approved = webhooks.filter(
    (w) => w.transactionStatus === "Approved" && w.signatureValid,
  );

  console.log("=== wayforpay_webhook_events ===");
  console.log(
    JSON.stringify(
      webhooks.map((w) => ({
        created_at: iso(w.createdAt),
        order_reference: w.orderReference,
        transaction_status: w.transactionStatus,
        amount_raw: w.amountRaw,
        currency: w.currency,
        reason_code: w.reasonCode,
        signature_valid: w.signatureValid,
        metadata_chat_id: w.metadataChatId,
        metadata_course_name: w.metadataCourseName,
      })),
      null,
      2,
    ),
    "\n",
  );

  // 3) resolve contact via telegram email
  const tgUser = await TelegramUser.findOne({ where: { telegramId: userId } });
  const email = tgUser?.email ?? null;
  const contact = email ? await findContactByEmailForBot(email) : null;

  // 4) contact_product_access (payment_hook grants)
  let grants: ContactProductAccess[] = [];
  let access = null;
  if (contact) {
    grants = await ContactProductAccess.findAll({
      where: {
        contactId: contact.id,
        source: "payment_hook",
        externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      },
      order: [["endAt", "DESC"]],
    });
    access = await hasActiveMultimaskingAccess(contact.id, userId);
  }

  console.log("=== access ===");
  console.log(
    JSON.stringify(
      {
        telegram_email: email,
        contact_id: contact?.id ?? null,
        contact_external_id: contact?.externalId ?? null,
        payment_hook_grants: grants.map((g) => ({
          id: g.id,
          wayforpay_order_reference: g.wayforpayOrderReference,
          start_at: iso(g.startAt),
          end_at: iso(g.endAt),
          is_active: g.isActive,
          revoked_at: iso(g.revokedAt),
        })),
        has_active_multimasking_access: access,
      },
      null,
      2,
    ),
    "\n",
  );

  // 5) user_subscriptions mirror
  const subs = await UserSubscription.findAll({
    where: { userId },
    order: [["endAt", "DESC"]],
  });
  console.log("=== user_subscriptions ===");
  console.log(
    JSON.stringify(
      subs.map((s) => ({
        id: s.id,
        plan_code: planById.get(s.planId)?.code ?? `(plan_id=${s.planId})`,
        status: s.status,
        start_at: iso(s.startAt),
        end_at: iso(s.endAt),
        last_payment_order_reference: s.lastPaymentOrderReference,
      })),
      null,
      2,
    ),
    "\n",
  );

  // Verdict
  const now = new Date();
  const activeGrant = grants.find(
    (g) => g.isActive && !g.revokedAt && g.endAt && g.endAt > now,
  );
  console.log("=== VERDICT ===");
  console.log(
    JSON.stringify(
      {
        valid_charge:
          approved.length > 0
            ? `yes — ${approved.length} approved+signed webhook(s)`
            : "no approved+signed webhook found",
        approved_webhook_count: approved.length,
        access_active_now: access?.hasAccess ?? false,
        access_source: access?.source ?? null,
        access_end_at: iso(access?.grantEndAt ?? activeGrant?.endAt ?? null),
        in_grace_period: access?.inGracePeriod ?? false,
        auto_renew: access?.autoRenew ?? null,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
