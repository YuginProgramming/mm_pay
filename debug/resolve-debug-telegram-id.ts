import { AppSetting } from "../database/AppSetting";
import { APP_SETTING_KEYS } from "../database/app-setting-keys";

/**
 * Порядок: argv[argvIndex], env DEBUG_TG_USER_ID, app_settings.debug_telegram_user_id.
 */
export async function resolveDebugTelegramUserId(
  argvIndex: number,
  scriptHint: string,
): Promise<string> {
  const fromArg = process.argv[argvIndex]?.trim();
  if (fromArg && /^\d+$/.test(fromArg)) {
    return fromArg;
  }

  const fromEnv = process.env.DEBUG_TG_USER_ID?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return fromEnv;
  }

  const row = await AppSetting.findByPk(APP_SETTING_KEYS.DEBUG_TELEGRAM_USER_ID);
  const fromDb = row?.settingValue?.trim();
  if (fromDb && /^\d+$/.test(fromDb)) {
    return fromDb;
  }

  throw new Error(
    "Не знайдено telegram user id: задайте app_settings.debug_telegram_user_id, " +
      `або DEBUG_TG_USER_ID у .env, або аргументом: ${scriptHint}`,
  );
}
