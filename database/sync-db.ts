import { sequelize } from "./db";
import "./Contact";
import "./TelegramUser";
async function syncDb() {
  try {
    await sequelize.authenticate();
    await sequelize.sync(); // creates table if not exists
    console.log("DB synced.");
  } catch (e) {
    console.error("DB sync failed:", e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}
void syncDb();