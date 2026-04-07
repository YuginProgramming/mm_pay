/**
 * Читає знімок з debug/bot-telegram-chats.json (вивід list-bot-telegram-chats.ts)
 * і записує компактний JSON у app_settings.telegram_bot_chats_json.
 *
 * З кореня проєкту:
 *   npx ts-node debug/seed-telegram-chat-ids-to-app-settings.ts
 *   npx ts-node debug/seed-telegram-chat-ids-to-app-settings.ts /шлях/до/in.json
 *   npx ts-node debug/seed-telegram-chat-ids-to-app-settings.ts --dry-run
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { AppSetting } from "../database/AppSetting";
import { sequelize } from "../database/db";

type ListBotChatsFile = {
  chats?: Array<{
    chatId?: number;
    observedTypesFromUpdates?: string[];
    getChat?: { title?: string; type?: string; id?: number };
  }>;
};

export type TelegramBotChatRow = {
  chatId: number;
  type: string;
  title: string;
};

function parseArgs(): { jsonPath: string; dryRun: boolean } {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let dryRun = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === "--dry-run" || a === "-n") {
      dryRun = true;
      continue;
    }
    paths.push(a);
  }
  const jsonPath =
    paths[0]?.trim() ||
    path.join(__dirname, "bot-telegram-chats.json");
  return { jsonPath, dryRun };
}

function extractRows(data: ListBotChatsFile): TelegramBotChatRow[] {
  const chats = data.chats;
  if (!Array.isArray(chats)) {
    throw new Error('Файл не містить масиву "chats"');
  }
  const rows: TelegramBotChatRow[] = [];
  for (const c of chats) {
    const chatId = c.chatId ?? c.getChat?.id;
    if (chatId == null || typeof chatId !== "number") {
      continue;
    }
    const type =
      c.getChat?.type ??
      (c.observedTypesFromUpdates && c.observedTypesFromUpdates[0]) ??
      "unknown";
    const title = (c.getChat?.title ?? "").trim() || "(без назви)";
    rows.push({ chatId, type, title });
  }
  if (rows.length === 0) {
    throw new Error("У файлі не знайдено жодного chatId");
  }
  return rows;
}

async function main(): Promise<void> {
  const { jsonPath, dryRun } = parseArgs();
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.resolve(jsonPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не знайдено: ${abs}`);
  }

  const raw = fs.readFileSync(abs, "utf8");
  const data = JSON.parse(raw) as ListBotChatsFile;
  const rows = extractRows(data);
  const settingValue = JSON.stringify(rows);

  console.error(`[seed-telegram-chats] Джерело: ${abs}`);
  console.error(`[seed-telegram-chats] Записів: ${rows.length}`);
  for (const r of rows) {
    console.error(`  • ${r.chatId}  ${r.type}  ${r.title}`);
  }

  if (dryRun) {
    console.error("[seed-telegram-chats] --dry-run: БД не змінювалась");
    console.log(settingValue);
    return;
  }

  await sequelize.authenticate();
  await AppSetting.upsert({
    settingKey: APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON,
    settingValue,
    descriptionUk:
      "JSON: chatId/type/title чатів і каналів бота; джерело — bot-telegram-chats.json",
  });
  console.error(
    `[seed-telegram-chats] Оновлено app_settings.${APP_SETTING_KEYS.TELEGRAM_BOT_CHATS_JSON}`,
  );
  await sequelize.close();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
