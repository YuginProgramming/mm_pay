import { Op } from "sequelize";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { TelegramUser } from "../database/TelegramUser";

function formatDate(date: Date | null): string {
  if (!date) {
    return "—";
  }
  return date.toISOString().slice(0, 10);
}

export async function buildProfileMessage(user: TelegramUser): Promise<string> {
  const email = user.email ?? null;
  const lines: string[] = ["Ваш профіль", ""];

  if (!email) {
    lines.push("Email: не вказано");
    lines.push("");
    lines.push("Надішліть email у чат, щоб побачити статус доступу та доступні опції.");
    return lines.join("\n");
  }

  lines.push(`Email: ${email}`);
  const contact = await Contact.findOne({ where: { email } });
  if (!contact) {
    lines.push("Статус у базі KWIGA: контакт не знайдено");
    lines.push("");
    lines.push(
      "Спробуйте інший email або зверніться до адміністратора, якщо впевнені, що email правильний.",
    );
    return lines.join("\n");
  }

  lines.push("Статус у базі KWIGA: контакт знайдено");
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

  return lines.join("\n");
}
