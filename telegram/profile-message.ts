import { Op } from "sequelize";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { TelegramUser } from "../database/TelegramUser";
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

export async function buildProfileMessage(user: TelegramUser): Promise<string> {
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
    return lines.join("\n");
  }

  lines.push(`Email: ${email}`);
  const contact = snapshot.contact;
  if (!contact) {
    lines.push("Статус у базі KWIGA: контакт не знайдено");
    lines.push(formatKwigaRankLine(snapshot.rank));
    lines.push("");
    lines.push(
      "Спробуйте інший email або зверніться до адміністратора, якщо впевнені, що email правильний.",
    );
    return lines.join("\n");
  }

  lines.push("Статус у базі KWIGA: контакт знайдено");
  lines.push(formatKwigaRankLine(snapshot.rank));
  const now = new Date();
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

  const isActiveAccess = activeRows.length > 0;
  const nearestExpiry = activeRows.find((row) => row.endAt !== null)?.endAt ?? null;
  const activeByPid = groupRowsByExternalProductId(activeRows);

  lines.push(`Доступ активний: ${isActiveAccess ? "так" : "ні"}`);
  lines.push(`Дата завершення доступу: ${formatDate(nearestExpiry)}`);
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

  return lines.join("\n");
}
