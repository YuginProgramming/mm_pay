// telegram/consultation/run-consultation-bot.ts
import "dotenv/config";
import { launchConsultationBot } from "./consultation-bot";

void (async () => {
  await launchConsultationBot();
})();
