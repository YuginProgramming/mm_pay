/**
 * Крок (a) paid-chat janitor: зняття знімка цільових чатів і адмінів.
 *
 * Обмеження Telegram Bot API: повного списку учасників супергрупи через бота немає.
 * Тут — getChatAdministrators (whitelist від kick) та getChatMemberCount (моніторинг).
 * Наступні кроки janitor: збіг з БД / kick / повідомлення (TZ §7).
 */
import type { PaidChatRole, TelegramBotChatRow } from "./chats-config";
import { resolvePaidChatRows } from "./chats-config";
import { rawGetChatAdministrators, rawGetChatMemberCount } from "./telegram-bot-raw";

export type PaidChatSnapshot = {
  role: PaidChatRole;
  chatId: number;
  type: string;
  title: string;
  memberCount: number | null;
  administratorUserIds: ReadonlySet<number>;
};

export async function fetchPaidChatSnapshot(
  token: string,
  row: TelegramBotChatRow,
  role: PaidChatRole,
): Promise<PaidChatSnapshot> {
  const [adminIds, memberCount] = await Promise.all([
    rawGetChatAdministrators(token, row.chatId),
    rawGetChatMemberCount(token, row.chatId),
  ]);
  return {
    role,
    chatId: row.chatId,
    type: row.type,
    title: row.title,
    memberCount,
    administratorUserIds: new Set(adminIds),
  };
}

export type PaidChatJanitorStepAResult = {
  snapshots: PaidChatSnapshot[];
  warnings: string[];
};

/**
 * Будує знімки для MASTERS та Chat PRO з масиву рядків (зазвичай з app_settings).
 */
export async function buildPaidChatJanitorStepASnapshot(
  token: string,
  rows: TelegramBotChatRow[],
): Promise<PaidChatJanitorStepAResult> {
  const { masters, catPro, warnings } = resolvePaidChatRows(rows);
  const snapshots: PaidChatSnapshot[] = [];

  if (masters) {
    snapshots.push(await fetchPaidChatSnapshot(token, masters, "masters"));
  }
  if (catPro) {
    snapshots.push(await fetchPaidChatSnapshot(token, catPro, "cat_pro"));
  }

  return { snapshots, warnings };
}
