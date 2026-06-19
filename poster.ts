import "dotenv/config";
import { launchPosterBot } from "./telegram/poster/poster-bot";

export { launchPosterBot };

void (async () => {
  await launchPosterBot();
})();
