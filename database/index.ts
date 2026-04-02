import { Contact } from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { EmailChangeLog } from "./EmailChangeLog";
import { AppSetting } from "./AppSetting";
import { RulesConsent } from "./RulesConsent";
import { KwigaProduct } from "./KwigaProduct";
import { TelegramUser } from "./TelegramUser";

export { defineAssociations } from "./associations";
export { APP_SETTING_KEYS, type AppSettingKey } from "./app-setting-keys";
export {
  getAppSettingInt,
  getAppSettingRaw,
  getAppSettingString,
} from "./app-settings-queries";
export {
  Contact,
  ContactProductAccess,
  EmailChangeLog,
  KwigaProduct,
  AppSetting,
  RulesConsent,
  TelegramUser,
};
export * from "./access-queries";
export const models = {
  Contact,
  ContactProductAccess,
  EmailChangeLog,
  KwigaProduct,
  AppSetting,
  RulesConsent,
  TelegramUser,
};
