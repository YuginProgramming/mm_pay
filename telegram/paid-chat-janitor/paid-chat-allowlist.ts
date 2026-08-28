/**
 * Крок (b) paid-chat janitor: хто має право лишатися в MASTERS / Chat PRO за БД
 * (активний доступ MULTIMASKING: `payment_hook`/`manual_override`, `subscription_auto` Active + grant,
 * grace `MULTIMASKING_ACCESS_GRACE_DAYS` (усі типи доступу) після простроченого `end_at`, або `user_subscriptions`;
 * ранг KWIGA без урахування оплати).
 *
 * Ранг завжди береться через `computeKwigaRankSnapshot` під час побудови allowlist — не з колонки
 * `kwiga_audience_rank`. Перед фактичним kick у наступних кроках janitor знову перераховувати ранг
 * на час прогону (той самий шлях). Див. TZ/user-control-crawler.txt п. 1.1.
 *
 * Не виконує kick — лише будує списки для подальших кроків.
 */
import { Op } from "sequelize";
import { Contact } from "../../database/Contact";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { findContactByEmailForBot } from "../../database/contact-lookup";
import { normalizeEmail } from "../../database/normalize-email";
import { SubscriptionAuto } from "../../database/SubscriptionAuto";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { TelegramUser } from "../../database/TelegramUser";
import { isActiveSubscriptionAutoRecord } from "../../payment/subscription-auto-active";
import { hasActiveMultimaskingAccess } from "../../payment/multimasking-access-status";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "../../payment/multimasking-product";
import { isMultimaskingRecurringPlanCode } from "../../payment/subscription-plan-codes";
import { computeKwigaRankSnapshot } from "../profile/kwiga-rank-db";
import type { KwigaAudienceRank } from "../profile/kwiga-user-rank";
import type { PaidChatRole } from "./chats-config";

export type PaidChatAllowlistEntry = {
  telegramId: string;
  contactId: number;
  rank: KwigaAudienceRank;
  /** Найпізніший `endAt` серед активних bot-payment рядків для цього контакту. */
  grantEndAt: Date | null;
};

export type PaidChatAllowlistsStepB = {
  masters: PaidChatAllowlistEntry[];
  catPro: PaidChatAllowlistEntry[];
};

export function maxGrantEndAt(rows: ContactProductAccess[]): Date | null {
  let max: Date | null = null;
  for (const r of rows) {
    const e = r.endAt;
    if (e == null) continue;
    if (max == null || e.getTime() > max.getTime()) {
      max = e;
    }
  }
  return max;
}

function dedupeByTelegramKeepLatestGrant(
  entries: PaidChatAllowlistEntry[],
): PaidChatAllowlistEntry[] {
  const map = new Map<string, PaidChatAllowlistEntry>();
  for (const entry of entries) {
    const prev = map.get(entry.telegramId);
    if (!prev) {
      map.set(entry.telegramId, entry);
      continue;
    }
    const pt = prev.grantEndAt?.getTime() ?? 0;
    const nt = entry.grantEndAt?.getTime() ?? 0;
    if (nt >= pt) {
      map.set(entry.telegramId, entry);
    }
  }
  return [...map.values()].sort((a, b) => a.telegramId.localeCompare(b.telegramId));
}

/**
 * Активний доступ з бот-оплати MULTIMASKING (як у `profile-message` + фільтр продукту).
 */
export async function loadActiveBotPaymentRowsByContact(): Promise<
  Map<number, ContactProductAccess[]>
> {
  const now = new Date();
  const rows = await ContactProductAccess.findAll({
    where: {
      source: { [Op.in]: ["payment_hook", "manual_override"] },
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      revokedAt: null,
      isActive: true,
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }],
    },
  });

  const byContact = new Map<number, ContactProductAccess[]>();
  for (const row of rows) {
    const list = byContact.get(row.contactId) ?? [];
    list.push(row);
    byContact.set(row.contactId, list);
  }
  return byContact;
}

function mergeGrantEndAt(
  map: Map<number, Date | null>,
  contactId: number,
  candidate: Date | null | undefined,
): void {
  if (candidate == null) {
    if (!map.has(contactId)) {
      map.set(contactId, null);
    }
    return;
  }
  const prev = map.get(contactId);
  if (prev == null || candidate.getTime() > prev.getTime()) {
    map.set(contactId, candidate);
  }
}

/**
 * Контакти з правом лишатися в paid chats: активний grant і/або recurring `subscription_auto`.
 */
async function resolveAllowlistGrantEndByContact(): Promise<Map<number, Date | null>> {
  const grantEndByContact = new Map<number, Date | null>();

  const byContact = await loadActiveBotPaymentRowsByContact();
  for (const [contactId, payRows] of byContact) {
    grantEndByContact.set(contactId, maxGrantEndAt(payRows));
  }

  const autos = await SubscriptionAuto.findAll({
    where: { cancelledAt: null },
    attributes: ["userId", "planId", "wayforpayStatus"],
  });

  for (const auto of autos) {
    if (!isActiveSubscriptionAutoRecord(auto)) {
      continue;
    }
    const plan = await SubscriptionPlan.findByPk(auto.planId, { attributes: ["code"] });
    if (!plan || !isMultimaskingRecurringPlanCode(plan.code)) {
      continue;
    }

    const user = await TelegramUser.findOne({ where: { telegramId: auto.userId } });
    const emailRaw = user?.email?.trim();
    if (!emailRaw) {
      continue;
    }
    const contact = await findContactByEmailForBot(normalizeEmail(emailRaw));
    if (!contact) {
      continue;
    }

    const access = await hasActiveMultimaskingAccess(contact.id, auto.userId);
    if (!access.hasAccess) {
      continue;
    }

    const endAt = access.grantEndAt ?? access.userSubscriptionEndAt;
    mergeGrantEndAt(grantEndByContact, contact.id, endAt);
  }

  return grantEndByContact;
}

export async function buildPaidChatAllowlistsStepB(): Promise<PaidChatAllowlistsStepB> {
  const grantEndByContact = await resolveAllowlistGrantEndByContact();
  const masters: PaidChatAllowlistEntry[] = [];
  const catPro: PaidChatAllowlistEntry[] = [];

  for (const [contactId, grantEndAt] of grantEndByContact) {
    const contact = await Contact.findByPk(contactId);
    if (!contact?.email?.trim()) {
      continue;
    }

    const users = await TelegramUser.findAll({
      where: { email: contact.email },
    });

    for (const user of users) {
      const snapshot = await computeKwigaRankSnapshot(user);
      if (!snapshot.contact || snapshot.contact.id !== contactId) {
        continue;
      }

      const rank = snapshot.rank;
      const entry: PaidChatAllowlistEntry = {
        telegramId: user.telegramId,
        contactId,
        rank,
        grantEndAt,
      };

      if (rank === "masters" || rank === "pro") {
        masters.push(entry);
      }
      if (rank === "pro") {
        catPro.push(entry);
      }
    }
  }

  return {
    masters: dedupeByTelegramKeepLatestGrant(masters),
    catPro: dedupeByTelegramKeepLatestGrant(catPro),
  };
}

export type ActiveMultimaskingPaymentSummary =
  | { active: false }
  | {
      active: true;
      grantEndAt: Date | null;
      source?: "payment_hook" | "manual_override";
    };

/**
 * Активний локальний доступ MULTIMASKING для контакту: діючий payment_hook
 * або manual_override і орієнтир кінця періоду.
 * `grantEndAt: null` — у записі немає дати закінчення (рідко); див. /profile.
 */
export async function getActiveMultimaskingPaymentSummaryForContact(
  contactId: number,
): Promise<ActiveMultimaskingPaymentSummary> {
  const now = new Date();
  const rows = await ContactProductAccess.findAll({
    where: {
      contactId,
      source: { [Op.in]: ["payment_hook", "manual_override"] },
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      revokedAt: null,
      isActive: true,
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }],
    },
  });
  if (rows.length === 0) {
    return { active: false };
  }
  if (rows.some((r) => r.endAt == null)) {
    return {
      active: true,
      grantEndAt: null,
      source: rows.some((r) => r.source === "manual_override")
        ? "manual_override"
        : "payment_hook",
    };
  }
  const grantEndAt = maxGrantEndAt(rows);
  const latestRow = rows
    .filter((r) => r.endAt != null && r.endAt.getTime() === grantEndAt?.getTime())
    .sort((a, b) => b.id - a.id)[0];
  return {
    active: true,
    grantEndAt,
    source: latestRow?.source === "manual_override" ? "manual_override" : "payment_hook",
  };
}

/**
 * Чи є активний доступ MULTIMASKING (payment_hook, recurring, user_subscriptions).
 * Якщо передано `telegramId`, використовує `hasActiveMultimaskingAccess` (S2).
 */
export async function contactHasActiveMultimaskingPayment(
  contactId: number,
  telegramId?: string,
): Promise<boolean> {
  const tid = telegramId?.trim();
  if (tid) {
    return (await hasActiveMultimaskingAccess(contactId, tid)).hasAccess;
  }
  const summary = await getActiveMultimaskingPaymentSummaryForContact(contactId);
  return summary.active;
}

/**
 * Усі `telegram_users.telegram_id`, для яких є хоча б один payment_hook
 * або manual_override на MULTIMASKING
 * на відповідному контакті (для обходу janitor).
 */
export async function findTelegramIdsWithAnyBotPaymentHistory(): Promise<string[]> {
  const rows = await ContactProductAccess.findAll({
    where: {
      source: { [Op.in]: ["payment_hook", "manual_override"] },
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
    },
    attributes: ["contactId"],
  });
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const telegramIds = new Set<string>();
  for (const contactId of contactIds) {
    const contact = await Contact.findByPk(contactId);
    if (!contact?.email?.trim()) {
      continue;
    }
    const users = await TelegramUser.findAll({
      where: { email: contact.email },
    });
    for (const u of users) {
      telegramIds.add(u.telegramId);
    }
  }
  return [...telegramIds].sort((a, b) => a.localeCompare(b));
}

export function isTelegramIdOnPaidChatAllowlistStepB(
  telegramId: string,
  role: PaidChatRole,
  lists: PaidChatAllowlistsStepB,
): boolean {
  const entries = role === "masters" ? lists.masters : lists.catPro;
  return entries.some((e) => e.telegramId === telegramId);
}
