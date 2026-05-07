import "dotenv/config";
import { AppSetting } from "../database/AppSetting";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";
import { sequelize } from "../database/db";

async function upsertSetting(
  settingKey: string,
  settingValue: string,
  descriptionUk: string,
): Promise<void> {
  await AppSetting.upsert({ settingKey, settingValue, descriptionUk });
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  await upsertSetting(
    APP_SETTING_KEYS.CONSULTATION_CLIENT_PRICE_UAH,
    process.env.CONSULTATION_CLIENT_PRICE_UAH ?? "1000",
    "Ціна персональної консультації для клієнта, грн",
  );
  await upsertSetting(
    APP_SETTING_KEYS.CONSULTATION_MASTER_PRICE_UAH,
    process.env.CONSULTATION_MASTER_PRICE_UAH ?? "1000",
    "Ціна консультації для майстрів, грн",
  );

  console.log("Consultation prices are upserted in app_settings.");
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
