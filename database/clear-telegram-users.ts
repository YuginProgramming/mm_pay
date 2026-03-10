// database/clear-telegram-users.ts
import { sequelize } from "./db";
import { TelegramUser } from "./TelegramUser";

async function clearTelegramUsers() {
  try {
    await sequelize.authenticate();
    console.log("Connected to DB.");

    // Option 1: TRUNCATE (fast, resets sequence, cannot be rolled back in some setups)
    // await sequelize.query('TRUNCATE TABLE telegram_users RESTART IDENTITY CASCADE;');

    // Option 2: destroy all rows via Sequelize (safer if you want it inside transactions, etc.)
    const deletedCount = await TelegramUser.destroy({
      where: {},
      truncate: true, // uses TRUNCATE under the hood in Postgres
    });

    console.log(`telegram_users table cleared. Rows removed: ${deletedCount}`);
  } catch (error) {
    console.error("Failed to clear telegram_users:", error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

void clearTelegramUsers();