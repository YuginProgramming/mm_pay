/**
 * Крок (b) paid-chat janitor: хто має право лишатися в MASTERS / Chat PRO за БД
 * (активний `payment_hook` на MULTIMASKING + ранг KWIGA без урахування оплати).
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
import { TelegramUser } from "../../database/TelegramUser";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID } from "../../payment/multimasking-product";
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
      source: "payment_hook",
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

export async function buildPaidChatAllowlistsStepB(): Promise<PaidChatAllowlistsStepB> {
  const byContact = await loadActiveBotPaymentRowsByContact();
  const masters: PaidChatAllowlistEntry[] = [];
  const catPro: PaidChatAllowlistEntry[] = [];

  for (const [contactId, payRows] of byContact) {
    const grantEndAt = maxGrantEndAt(payRows);
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

/** Чи є в контакту активний рядок оплати MULTIMASKING у боті (як у профілі). */
export async function contactHasActiveMultimaskingPayment(
  contactId: number,
): Promise<boolean> {
  const now = new Date();
  const row = await ContactProductAccess.findOne({
    where: {
      contactId,
      source: "payment_hook",
      externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
      revokedAt: null,
      isActive: true,
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }],
    },
  });
  return row !== null;
}

/**
 * Усі `telegram_users.telegram_id`, для яких є хоча б один `payment_hook` на MULTIMASKING
 * на відповідному контакті (для обходу janitor).
 */
export async function findTelegramIdsWithAnyBotPaymentHistory(): Promise<string[]> {
  const rows = await ContactProductAccess.findAll({
    where: {
      source: "payment_hook",
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
