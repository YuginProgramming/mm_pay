import { Contact } from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { KwigaProduct } from "./KwigaProduct";
import { TelegramUser } from "./TelegramUser";

export { defineAssociations } from "./associations";
export { Contact, ContactProductAccess, KwigaProduct, TelegramUser };
export * from "./access-queries";
export const models = { Contact, ContactProductAccess, KwigaProduct, TelegramUser };
