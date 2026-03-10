// telegram/run-bot.ts
import "dotenv/config";
import { launchTelegramBot } from "./bot";

void (async () => {
  await launchTelegramBot();
})();