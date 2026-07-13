import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import { escapeTelegramHtml, telegramHtmlLink } from "../core/telegram-html";
import { Op } from "sequelize";
import { ContactProductAccess } from "../../database/ContactProductAccess";
import { TelegramUser } from "../../database/TelegramUser";
import {
  MULTIMASKING_KWIGA_CABINET_URL,
  MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL,
  MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
} from "../../payment/multimasking-telegram-groups";
import {
  getMultimaskingAccessGraceDays,
  hasActiveMultimaskingAccess,
  type MultimaskingAccessStatus,
} from "../../payment/multimasking-access-status";
import {
  isMonthlySubscriptionPlanCode,
  isYearlySubscriptionPlanCode,
} from "../../payment/subscription-plan-codes";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "./kwiga-rank-db";
import { formatKwigaRankLine } from "./kwiga-user-rank";

function formatDate(date: Date | null): string {
  if (!date) {
    return "—";
  }
  return date.toISOString().slice(0, 10);
}

function formatDateTimeUaKyiv(date: Date): string {
  return date.toLocaleString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  });
}

function formatWayforpayAutoRenewStatus(status: string | null | undefined): string {
  const trimmed = (status ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Active";
}

/** S2-6: рядки про recurring WayForPay з `subscription_auto`. */
function buildAutoRenewProfileLines(access: MultimaskingAccessStatus): string[] {
  const auto = access.autoRenew;
  if (!auto) {
    return [];
  }

  const statusLabel = formatWayforpayAutoRenewStatus(auto.wayforpayStatus);
  const lines: string[] = [`Автопродовження: ${statusLabel}`];

  if (isMonthlySubscriptionPlanCode(auto.planCode)) {
    lines.push("Тариф: щомісячна підписка MULTIMASKING (WayForPay).");
  } else if (isYearlySubscriptionPlanCode(auto.planCode)) {
    lines.push("Тариф: річна підписка MULTIMASKING (WayForPay).");
  }

  lines.push(
    auto.nextChargeAt
      ? `Наступне списання: ${formatDateTimeUaKyiv(auto.nextChargeAt)}`
      : "Наступне списання: —",
  );

  if (access.inGracePeriod) {
    const graceDays = getMultimaskingAccessGraceDays();
    lines.push(
      `Оплачений період формально завершився; доступ у групах зберігається ще до ${graceDays} дн. після кінця періоду.`,
    );
  }

  return lines;
}

function uaRecordsCount(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} запис`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} записи`;
  return `${n} записів`;
}

/** Коротка «канонічна» назва продукту: без дебаг-суфіксів у titleSnapshot, інакше найкоротший варіант. */
function pickPreferredProductTitle(
  candidates: string[],
  fallbackProductId: number,
): string {
  const trimmed = candidates.map((t) => t.trim()).filter((t) => t.length > 0);
  if (trimmed.length === 0) return `Продукт #${fallbackProductId}`;
  const noDebug = trimmed.filter((t) => !/\(debug/i.test(t));
  const pool = noDebug.length > 0 ? noDebug : trimmed;
  return pool.reduce((a, b) => (a.length <= b.length ? a : b));
}

function groupRowsByExternalProductId(
  rows: ContactProductAccess[],
): Map<number, ContactProductAccess[]> {
  const map = new Map<number, ContactProductAccess[]>();
  for (const row of rows) {
    const list = map.get(row.externalProductId) ?? [];
    list.push(row);
    map.set(row.externalProductId, list);
  }
  return map;
}

export async function buildProfileMessage(
  user: TelegramUser,
): Promise<{ text: string; parseMode?: "HTML" }> {
  const email = user.email ?? null;
  const lines: string[] = ["Ваш профіль", ""];

  const snapshot = await computeKwigaRankSnapshot(user);
  await persistKwigaRankSnapshot(user, snapshot);

  if (!email) {
    lines.push("Email: не вказано");
    lines.push(
      "Категорія клієнта: email не вказано — неможливо зіставити з KWIGA",
    );
    lines.push("");
    lines.push("Надішліть email у чат, щоб побачити статус доступу та доступні опції.");
    return { text: lines.join("\n") };
  }

  lines.push(`Email: ${email}`);
  const contact = snapshot.contact;
  if (!contact) {
    lines.push("Статус у базі KWIGA: контакт не знайдено");
    lines.push(formatKwigaRankLine(snapshot.rank));
    lines.push("");
    lines.push(
      "Спробуйте інший email, якщо впевнені, що поточна адреса некоректна.\n" +
        SUPPORT_CONTACT_SUFFIX_PLAIN_UA,
    );
    return { text: lines.join("\n") };
  }

  lines.push("Статус у базі KWIGA: контакт знайдено");
  lines.push(formatKwigaRankLine(snapshot.rank));
  const now = new Date();
  const multimaskingAccess = await hasActiveMultimaskingAccess(
    contact.id,
    user.telegramId,
    now,
  );
  const activeRows = await ContactProductAccess.findAll({
    where: {
      contactId: contact.id,
      revokedAt: null,
      isActive: true,
      [Op.or]: [{ endAt: null }, { endAt: { [Op.gt]: now } }],
    },
    order: [["endAt", "ASC"]],
  });

  const allNonRevoked = await ContactProductAccess.findAll({
    where: { contactId: contact.id, revokedAt: null },
    order: [["externalProductId", "ASC"]],
  });

  type ProductAccessGroup = { title: string; total: number; activeNow: number };
  const byProduct = new Map<number, ProductAccessGroup>();
  const rowsByPid = groupRowsByExternalProductId(allNonRevoked);
  for (const [productId, list] of rowsByPid) {
    const titles = list
      .map((r) => r.titleSnapshot?.trim())
      .filter((t): t is string => Boolean(t && t.length > 0));
    const title = pickPreferredProductTitle(titles, productId);
    let activeNow = 0;
    for (const row of list) {
      const effectiveNow =
        row.isActive && (row.endAt === null || row.endAt > now);
      if (effectiveNow) activeNow += 1;
    }
    byProduct.set(productId, {
      title,
      total: list.length,
      activeNow,
    });
  }

  const isActiveAccess = activeRows.length > 0 || multimaskingAccess.hasAccess;
  const nearestExpiry =
    multimaskingAccess.grantEndAt ??
    activeRows.find((row) => row.endAt !== null)?.endAt ??
    null;
  const activeByPid = groupRowsByExternalProductId(activeRows);

  lines.push(`Доступ активний: ${isActiveAccess ? "так" : "ні"}`);
  lines.push(`Дата завершення доступу: ${formatDate(nearestExpiry)}`);
  const autoRenewLines = buildAutoRenewProfileLines(multimaskingAccess);
  if (autoRenewLines.length > 0) {
    lines.push(...autoRenewLines);
  }
  lines.push("");
  lines.push("Доступні опції:");

  if (activeByPid.size === 0) {
    lines.push("- Наразі немає активних опцій");
  } else {
    const sortedActive = [...activeByPid.entries()].sort((a, b) => {
      const ta = pickPreferredProductTitle(
        a[1]
          .map((r) => r.titleSnapshot?.trim())
          .filter((t): t is string => Boolean(t && t.length > 0)),
        a[0],
      );
      const tb = pickPreferredProductTitle(
        b[1]
          .map((r) => r.titleSnapshot?.trim())
          .filter((t): t is string => Boolean(t && t.length > 0)),
        b[0],
      );
      return ta.localeCompare(tb, "uk");
    });
    for (const [productId, list] of sortedActive) {
      const titles = list
        .map((r) => r.titleSnapshot?.trim())
        .filter((t): t is string => Boolean(t && t.length > 0));
      const label = pickPreferredProductTitle(titles, productId);
      const n = list.length;
      lines.push(`- ${label}${n > 1 ? ` ×${n}` : ""}`);
    }
  }

  lines.push("");
  lines.push("Доступи по продуктах (усі невідкликані записи):");
  if (byProduct.size === 0) {
    lines.push("- Немає записів доступу для цього контакту");
  } else {
    const sorted = [...byProduct.entries()].sort((a, b) =>
      a[1].title.localeCompare(b[1].title, "uk"),
    );
    for (const [, g] of sorted) {
      lines.push(`- ${g.title}: ${uaRecordsCount(g.total)}, активних зараз: ${g.activeNow}`);
    }
  }

  const rank = snapshot.rank;
  const accessLinks =
    isActiveAccess && rank === "pro"
      ? [
          { label: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
          {
            label: "Група для Про підписників",
            url: MULTIMASKING_TELEGRAM_GROUP_PRO_URL,
          },
          { label: "Кабінет (відеолекції)", url: MULTIMASKING_KWIGA_CABINET_URL },
        ]
      : isActiveAccess && rank === "masters"
        ? [
            { label: "Група для Майстрів", url: MULTIMASKING_TELEGRAM_GROUP_MASTERS_URL },
            { label: "Кабінет (відеолекції)", url: MULTIMASKING_KWIGA_CABINET_URL },
          ]
        : [];

  const body = lines.join("\n");
  if (accessLinks.length === 0) {
    return { text: body };
  }

  const linksBlock =
    "Далі вам доступні розділи — натисніть на назви нижче:\n\n" +
    accessLinks
      .map((l, i) => `${i + 1}) ` + telegramHtmlLink(l.url, l.label))
      .join("\n");

  return {
    text: escapeTelegramHtml(body) + "\n\n" + linksBlock,
    parseMode: "HTML",
  };
}
