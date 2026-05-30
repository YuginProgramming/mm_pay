/**
 * Збирає чати (групи / супергрупи / канали), які з’являються в оновленнях бота,
 * і для кожного тягне getChat + getChatMember(bot) — тип, назва, права бота тощо.
 *
 * ВАЖЛИВО: getUpdates забирає чергу оновлень. Поки скрипт працює, зупиніть
 * production-бота (pm2 тощо) для того ж TELEGRAM_BOT_TOKEN, або використайте
 * тестовий токен. Одночасно два споживачі getUpdates на один токен не ведуть себе передбачувано.
 *
 * Спочатку можна запустити скрипт, потім написати повідомлення в кожній групі/каналі —
 * або використати режим --listen, щоб скрипт чекав нові апдейти.
 *
 * З кореня проєкту:
 *   npx ts-node debug/list-bot-telegram-chats.ts
 *       Якщо черга getUpdates порожня, скрипт автоматично чекає до 300 с на ваші
 *       повідомлення в групах/каналах (щоб зібрати chat id). Для миттєвого виходу з
 *       порожнім списком: --drain-only
 *   npx ts-node debug/list-bot-telegram-chats.ts --listen 600
 *   npx ts-node debug/list-bot-telegram-chats.ts --listen 0
 *   npx ts-node debug/list-bot-telegram-chats.ts --drain-only
 *   npx ts-node debug/list-bot-telegram-chats.ts --timeout 50
 */
import "dotenv/config";
import type { Chat, Update } from "telegraf/types";

/** Оновлення — дискримінована юнія; для збору чатів достатньо широкого доступу до полів. */
type UpdateWithChats = Partial<{
  message: { chat?: Chat };
  edited_message: { chat?: Chat };
  channel_post: { chat?: Chat };
  edited_channel_post: { chat?: Chat };
  callback_query: { message?: { chat?: Chat } };
  my_chat_member: { chat?: Chat };
  chat_member: { chat?: Chat };
  chat_join_request: { chat?: Chat };
  message_reaction: { chat?: Chat };
  message_reaction_count: { chat?: Chat };
}>;

/** Якщо після drain немає жодного chat id — скільки секунд long-poll чекати на нові апдейти. */
const DEFAULT_LISTEN_WHEN_NO_CHATS = 300;

function parseArgs() {
  const raw = process.argv.slice(2);
  let listenSeconds: number | null = null;
  let longPollTimeout = 45;
  let drainOnly = false;
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--drain-only" || a === "-d") {
      drainOnly = true;
      continue;
    }
    if (a === "--listen" || a === "-l") {
      const v = raw[++i];
      listenSeconds = v ? Number(v) : 120;
      if (!Number.isFinite(listenSeconds) || listenSeconds < 0) {
        listenSeconds = 120;
      }
      continue;
    }
    if (a.startsWith("--listen=")) {
      listenSeconds = Number(a.slice("--listen=".length));
      if (!Number.isFinite(listenSeconds) || listenSeconds < 0) listenSeconds = 120;
      continue;
    }
    if (a === "--timeout" || a === "-t") {
      const v = raw[++i];
      longPollTimeout = v ? Number(v) : 45;
      if (!Number.isFinite(longPollTimeout) || longPollTimeout < 1) longPollTimeout = 45;
      continue;
    }
    if (a.startsWith("--timeout=")) {
      longPollTimeout = Number(a.slice("--timeout=".length));
      if (!Number.isFinite(longPollTimeout) || longPollTimeout < 1) longPollTimeout = 45;
      continue;
    }
    rest.push(a);
  }
  return { listenSeconds, longPollTimeout, drainOnly, rest };
}

function chatsFromUpdate(update: Update): Chat[] {
  const u = update as UpdateWithChats;
  const out: Chat[] = [];
  const add = (c: Chat | undefined): void => {
    if (c) out.push(c);
  };

  add(u.message?.chat);
  add(u.edited_message?.chat);
  add(u.channel_post?.chat);
  add(u.edited_channel_post?.chat);

  const cbMsg = u.callback_query?.message;
  if (cbMsg && "chat" in cbMsg) {
    add(cbMsg.chat);
  }

  add(u.my_chat_member?.chat);
  add(u.chat_member?.chat);
  add(u.chat_join_request?.chat);

  add(u.message_reaction?.chat);
  add(u.message_reaction_count?.chat);

  return out;
}

function chatKey(id: number): string {
  return String(id);
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Задайте TELEGRAM_BOT_TOKEN у .env (або середовищі), як у production-бота.",
    );
  }

  const { listenSeconds, longPollTimeout, drainOnly } = parseArgs();
  const base = `https://api.telegram.org/bot${token}`;

  const meRes = await fetch(`${base}/getMe`);
  const meJson = (await meRes.json()) as {
    ok: boolean;
    result?: { id: number; is_bot: boolean; first_name: string; username?: string };
    description?: string;
  };
  if (!meJson.ok || !meJson.result) {
    throw new Error(
      `getMe failed: ${meJson.description ?? meRes.statusText ?? meRes.status}`,
    );
  }
  const botUser = meJson.result;

  const seenChatIds = new Map<string, { id: number; types: Set<string> }>();
  let updateCount = 0;

  const ingestUpdates = (updates: Update[]): void => {
    for (const u of updates) {
      updateCount += 1;
      for (const chat of chatsFromUpdate(u)) {
        const id = chat.id;
        const key = chatKey(id);
        const prev = seenChatIds.get(key);
        if (!prev) {
          seenChatIds.set(key, { id, types: new Set([chat.type]) });
        } else {
          prev.types.add(chat.type);
        }
      }
    }
  };

  let offset = 0;

  const pullOnce = async (timeout: number): Promise<Update[]> => {
    const body = new URLSearchParams({
      offset: String(offset),
      limit: "100",
      timeout: String(timeout),
      allowed_updates: JSON.stringify([
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "callback_query",
        "my_chat_member",
        "chat_member",
        "chat_join_request",
        "message_reaction",
        "message_reaction_count",
      ]),
    });
    const r = await fetch(`${base}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = (await r.json()) as {
      ok: boolean;
      result?: Update[];
      description?: string;
    };
    if (!j.ok || !j.result) {
      throw new Error(`getUpdates failed: ${j.description ?? r.statusText}`);
    }
    return j.result;
  };

  const drainPending = async (): Promise<void> => {
    for (;;) {
      const batch = await pullOnce(0);
      if (batch.length === 0) break;
      ingestUpdates(batch);
      offset = batch[batch.length - 1].update_id + 1;
    }
  };

  console.error(
    "[list-bot-telegram-chats] Забираю вже накопичені getUpdates (timeout=0)…",
  );
  await drainPending();

  let listenAfterDrain = 0;
  if (drainOnly) {
    listenAfterDrain = 0;
  } else if (listenSeconds !== null) {
    listenAfterDrain = listenSeconds;
  } else if (seenChatIds.size === 0) {
    listenAfterDrain = DEFAULT_LISTEN_WHEN_NO_CHATS;
    console.error(
      `[list-bot-telegram-chats] У черзі getUpdates не було апдейтів — чекаю ${listenAfterDrain}s на повідомлення в групах/каналах.`,
    );
    console.error(
      "[list-bot-telegram-chats] Надішліть текст (або пост) там, де є бот. Довше: --listen 900. Швидкий вихід порожньо: --drain-only",
    );
  }

  if (listenAfterDrain > 0) {
    const end = Date.now() + listenAfterDrain * 1000;
    console.error(
      `[list-bot-telegram-chats] Listen ${listenAfterDrain}s (long_poll timeout ${longPollTimeout}s)…`,
    );
    while (Date.now() < end) {
      const remainingMs = end - Date.now();
      const t = Math.min(
        longPollTimeout,
        Math.max(1, Math.ceil(remainingMs / 1000)),
      );
      const batch = await pullOnce(t);
      ingestUpdates(batch);
      if (batch.length > 0) {
        offset = batch[batch.length - 1].update_id + 1;
      }
    }
  }

  const chatIds = [...seenChatIds.values()].map((x) => x.id);

  type Enriched = {
    chatId: number;
    observedTypesFromUpdates: string[];
    getChat: unknown;
    botChatMember: unknown;
    enrichmentError?: string;
  };

  const enriched: Enriched[] = [];

  for (const chatId of chatIds) {
    const observed = [...(seenChatIds.get(chatKey(chatId))?.types ?? [])].sort();
    try {
      const gcRes = await fetch(
        `${base}/getChat?chat_id=${encodeURIComponent(String(chatId))}`,
      );
      const gcJson = (await gcRes.json()) as {
        ok: boolean;
        result?: unknown;
        description?: string;
      };

      let botMember: unknown = null;
      if (gcJson.ok && gcJson.result) {
        const cmRes = await fetch(
          `${base}/getChatMember?chat_id=${encodeURIComponent(String(chatId))}&user_id=${botUser.id}`,
        );
        const cmJson = (await cmRes.json()) as {
          ok: boolean;
          result?: unknown;
          description?: string;
        };
        if (cmJson.ok) {
          botMember = cmJson.result ?? null;
        } else {
          botMember = { error: cmJson.description ?? "getChatMember failed" };
        }
      }

      enriched.push({
        chatId,
        observedTypesFromUpdates: observed,
        getChat: gcJson.ok ? gcJson.result : { error: gcJson.description },
        botChatMember: botMember,
      });
    } catch (e) {
      enriched.push({
        chatId,
        observedTypesFromUpdates: observed,
        getChat: null,
        botChatMember: null,
        enrichmentError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  enriched.sort((a, b) => {
    const ta = String(a.chatId);
    const tb = String(b.chatId);
    return ta.localeCompare(tb, undefined, { numeric: true });
  });

  const report = {
    warning:
      "Один токен = одна черга getUpdates. Не запускайте цей скрипт паралельно з polling-ботом на тому ж токені.",
    bot: botUser,
    stats: {
      updatesProcessed: updateCount,
      uniqueChats: enriched.length,
    },
    chats: enriched,
  };

  console.log(JSON.stringify(report, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
