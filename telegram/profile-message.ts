import { Op } from "sequelize";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { TelegramUser } from "../database/TelegramUser";
import { formatKwigaRankLine, kwigaAudienceRank } from "./kwiga-user-rank";

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

export async function buildProfileMessage(user: TelegramUser): Promise<string> {
  const email = user.email ?? null;
  const lines: string[] = ["Ваш профіль", ""];

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
  const contact = await Contact.findOne({ where: { email } });
  if (!contact) {
    lines.push("Статус у базі KWIGA: контакт не знайдено");
    lines.push(formatKwigaRankLine("no_kwiga_contact"));
    lines.push("");
    lines.push(
      "Спробуйте інший email або зверніться до адміністратора, якщо впевнені, що email правильний.",
    );
    return lines.join("\n");
  }

  lines.push("Статус у базі KWIGA: контакт знайдено");
  const lifetimeAccessCount = await ContactProductAccess.count({
    where: { contactId: contact.id },
  });
  lines.push(
    formatKwigaRankLine(kwigaAudienceRank(true, lifetimeAccessCount)),
  );
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
  for (const row of allNonRevoked) {
    const title =
      row.titleSnapshot && row.titleSnapshot.trim().length > 0
        ? row.titleSnapshot.trim()
        : `Продукт #${row.externalProductId}`;
    let g = byProduct.get(row.externalProductId);
    if (!g) {
      g = { title, total: 0, activeNow: 0 };
      byProduct.set(row.externalProductId, g);
    }
    g.total += 1;
    const effectiveNow =
      row.isActive && (row.endAt === null || row.endAt > now);
    if (effectiveNow) g.activeNow += 1;
    if (title.length > g.title.length) g.title = title;
  }

  const isActiveAccess = activeRows.length > 0;
  const nearestExpiry = activeRows.find((row) => row.endAt !== null)?.endAt ?? null;
  const optionTitles = activeRows.map((row) => {
    if (row.titleSnapshot && row.titleSnapshot.trim().length > 0) {
      return row.titleSnapshot.trim();
    }
    return `Product #${row.externalProductId}`;
  });

  lines.push(`Доступ активний: ${isActiveAccess ? "так" : "ні"}`);
  lines.push(`Дата завершення доступу: ${formatDate(nearestExpiry)}`);
  lines.push("");
  lines.push("Доступні опції:");

  if (optionTitles.length === 0) {
    lines.push("- Наразі немає активних опцій");
  } else {
    optionTitles.forEach((title) => lines.push(`- ${title}`));
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
