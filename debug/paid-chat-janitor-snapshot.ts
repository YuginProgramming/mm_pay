/**
 * Крок (a) janitor: з app_settings.telegram_bot_chats_json читає MASTERS / Chat PRO,
 * виводить memberCount та id адміністраторів (Telegram Bot API).
 *
 *   npx ts-node debug/paid-chat-janitor-snapshot.ts
 */
import "dotenv/config";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { getAppSettingString } from "../database/app-settings-queries";
import { sequelize } from "../database/db";
import {
  buildPaidChatJanitorStepASnapshot,
  parseTelegramBotChatsJson,
} from "../telegram/paid-chat-janitor";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("Задайте TELEGRAM_BOT_TOKEN у .env");
  }

  await sequelize.authenticate();
  const raw = await getAppSettingString(APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON);
  const rows = parseTelegramBotChatsJson(raw ?? "[]");

  const { snapshots, warnings } = await buildPaidChatJanitorStepASnapshot(token, rows);

  for (const w of warnings) {
    console.warn("[paid-chat-janitor]", w);
  }

  for (const s of snapshots) {
    console.log(
      JSON.stringify(
        {
          role: s.role,
          chatId: s.chatId,
          type: s.type,
          title: s.title,
          memberCount: s.memberCount,
          administratorUserIds: [...s.administratorUserIds].sort((a, b) => a - b),
          administratorCount: s.administratorUserIds.size,
        },
        null,
        2,
      ),
    );
  }

  if (snapshots.length === 0) {
    console.log("Немає знімків: перевірте JSON і назви MASTERS / Chat PRO.");
  }

  await sequelize.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
