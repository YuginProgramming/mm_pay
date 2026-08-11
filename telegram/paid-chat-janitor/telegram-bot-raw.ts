type TelegramOkResult<T> = { ok: true; result: T };
type TelegramErr = { ok: false; description?: string; error_code?: number };
type TelegramResponse<T> = TelegramOkResult<T> | TelegramErr;

async function telegramPostJson<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as TelegramResponse<T>;
  if (!json.ok) {
    const desc =
      json && typeof json === "object" && "description" in json
        ? String((json as TelegramErr).description ?? "unknown")
        : "unknown";
    throw new Error(`[telegram] ${method}: ${desc}`);
  }
  return (json as TelegramOkResult<T>).result;
}

async function telegramGetJson<T>(
  token: string,
  method: string,
  query: Record<string, string>,
): Promise<T> {
  const u = new URL(`https://api.telegram.org/bot${token}/${method}`);
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u.toString());
  const json = (await res.json()) as TelegramResponse<T>;
  if (!json.ok) {
    const desc =
      json && typeof json === "object" && "description" in json
        ? String((json as TelegramErr).description ?? "unknown")
        : "unknown";
    throw new Error(`[telegram] ${method}: ${desc}`);
  }
  return (json as TelegramOkResult<T>).result;
}

type ChatMemberAdmin = {
  user?: { id: number; is_bot?: boolean; first_name?: string };
  status?: string;
};

export async function rawGetChatAdministrators(
  token: string,
  chatId: number,
): Promise<number[]> {
  const result = await telegramGetJson<ChatMemberAdmin[]>(token, "getChatAdministrators", {
    chat_id: String(chatId),
  });
  const ids: number[] = [];
  for (const m of result) {
    const id = m.user?.id;
    if (typeof id === "number" && Number.isFinite(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export async function rawGetChatMemberCount(
  token: string,
  chatId: number,
): Promise<number | null> {
  try {
    const n = await telegramGetJson<number>(token, "getChatMemberCount", {
      chat_id: String(chatId),
    });
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

type ChatMemberUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type ChatMemberInfo = {
  status: string;
  user: ChatMemberUser;
};

export async function rawGetChatMemberInfo(
  token: string,
  chatId: number,
  userId: number,
): Promise<ChatMemberInfo | null> {
  try {
    const result = await telegramGetJson<ChatMemberInfo>(token, "getChatMember", {
      chat_id: String(chatId),
      user_id: String(userId),
    });
    const st = result.status ?? "";
    if (st === "left" || st === "kicked") {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Якщо користувача немає в чаті або помилка API — null.
 * `left` / `kicked` теж трактуємо як «немає сенсу kick».
 */
export async function rawGetChatMember(
  token: string,
  chatId: number,
  userId: number,
): Promise<{ status: string } | null> {
  const info = await rawGetChatMemberInfo(token, chatId, userId);
  return info ? { status: info.status } : null;
}

export function isChatAdminStatus(status: string): boolean {
  return status === "creator" || status === "administrator";
}

export async function rawBanChatMember(
  token: string,
  chatId: number,
  userId: number,
): Promise<void> {
  await telegramPostJson<unknown>(token, "banChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
}

/**
 * Знімає бан у чаті (користувач лишається поза групою, але може знову зайти за invite).
 * `only_if_banned: true` — no-op, якщо користувач не в бан-листі.
 */
export async function rawUnbanChatMember(
  token: string,
  chatId: number,
  userId: number,
): Promise<void> {
  await telegramPostJson<unknown>(token, "unbanChatMember", {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  });
}
