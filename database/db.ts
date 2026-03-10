import "dotenv/config";
import { Sequelize } from "sequelize";
const {
  DB_HOST = "localhost",
  DB_PORT = "5432",
  DB_NAME = "mm_project",
  DB_USER,
  DB_PASSWORD,
  DB_SSL = "false",
} = process.env;
if (!DB_USER || !DB_PASSWORD) {
  console.error("Missing DB_USER or DB_PASSWORD in .env");
  process.exit(1);
}
export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: Number(DB_PORT),
  dialect: "postgres",
  dialectOptions: {
    ssl: DB_SSL === "true" ? { require: true, rejectUnauthorized: false } : false,
  },
  logging: false, // set to console.log to see SQL
});
// Optional: simple connection test when run directly
if (require.main === module) {
  (async () => {
    try {
      await sequelize.authenticate();
      console.log("Connection to PostgreSQL has been established successfully.");
      process.exit(0);
    } catch (error) {
      console.error("Unable to connect to the database:", error);
      process.exit(1);
    }
  })();
}