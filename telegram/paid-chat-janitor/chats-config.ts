/**
 * Цільові чати для paid-chat janitor (TZ/user-control-crawler.txt): лише MASTERS та Chat PRO.
 * Community та інші записи в JSON ігноруються.
 */
export type TelegramBotChatRow = {
  chatId: number;
  type: string;
  title: string;
};

export type PaidChatRole = "masters" | "cat_pro";

const NORM_MASTERS = "masters";
const NORM_CAT_PRO = "chat pro";

function normalizeChatTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseTelegramBotChatsJson(raw: string | null | undefined): TelegramBotChatRow[] {
  if (raw == null || raw.trim() === "") return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: TelegramBotChatRow[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const chatId = rec.chatId;
      if (typeof chatId !== "number" || !Number.isFinite(chatId)) continue;
      const type = typeof rec.type === "string" ? rec.type : "unknown";
      const title = typeof rec.title === "string" ? rec.title : "";
      out.push({ chatId, type, title });
    }
    return out;
  } catch {
    return [];
  }
}

export type ResolvedPaidChats = {
  masters: TelegramBotChatRow | null;
  catPro: TelegramBotChatRow | null;
  warnings: string[];
};

/**
 * Знаходить рядки за назвою (як у app_settings). Рекомендований тип для обох — supergroup.
 */
export function resolvePaidChatRows(rows: TelegramBotChatRow[]): ResolvedPaidChats {
  const warnings: string[] = [];
  let masters: TelegramBotChatRow | null = null;
  let catPro: TelegramBotChatRow | null = null;

  for (const row of rows) {
    const n = normalizeChatTitle(row.title);
    if (n === NORM_MASTERS) {
      if (masters) {
        warnings.push(
          `Дубль назви MASTERS: chatId ${masters.chatId} і ${row.chatId}; лишається перший.`,
        );
        continue;
      }
      masters = row;
      if (row.type !== "supergroup") {
        warnings.push(
          `MASTERS (${row.chatId}) має type="${row.type}", очікувалось supergroup.`,
        );
      }
    }
    if (n === NORM_CAT_PRO) {
      if (catPro) {
        warnings.push(
          `Дубль назви Chat PRO: chatId ${catPro.chatId} і ${row.chatId}; лишається перший.`,
        );
        continue;
      }
      catPro = row;
      if (row.type !== "supergroup") {
        warnings.push(
          `Chat PRO (${row.chatId}) має type="${row.type}", очікувалось supergroup.`,
        );
      }
    }
  }

  if (!masters) warnings.push("У telegram_bot_chats_json не знайдено чат з title «MASTERS».");
  if (!catPro) warnings.push("У telegram_bot_chats_json не знайдено чат з title «Chat PRO».");

  return { masters, catPro, warnings };
}

export function isPaidChatAdministrator(
  userId: number,
  administratorUserIds: ReadonlySet<number>,
): boolean {
  return administratorUserIds.has(userId);
}
