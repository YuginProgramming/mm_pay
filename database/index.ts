import { Contact } from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { EmailChangeLog } from "./EmailChangeLog";
import { RulesConsent } from "./RulesConsent";
import { KwigaProduct } from "./KwigaProduct";
import { TelegramUser } from "./TelegramUser";

export { defineAssociations } from "./associations";
export {
  Contact,
  ContactProductAccess,
  EmailChangeLog,
  KwigaProduct,
  RulesConsent,
  TelegramUser,
};
export * from "./access-queries";
export const models = {
  Contact,
  ContactProductAccess,
  EmailChangeLog,
  KwigaProduct,
  RulesConsent,
  TelegramUser,
};
