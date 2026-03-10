// database/migrations.ts
import { sequelize } from "./db";
async function addEmailToTelegramUsers() {
  try {
    await sequelize.authenticate();
    console.log("Connected to DB, running migration...");
    // Add column only if it does NOT exist yet
    await sequelize.query(`
      ALTER TABLE telegram_users
      ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);
    console.log('Migration completed: "email" column added to telegram_users (if it was missing).');
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}
void addEmailToTelegramUsers();