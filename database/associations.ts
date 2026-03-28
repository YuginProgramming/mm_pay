import { Contact } from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { KwigaProduct } from "./KwigaProduct";

export function defineAssociations(): void {
  Contact.hasMany(ContactProductAccess, {
    foreignKey: "contact_id",
    as: "productAccesses",
  });
  ContactProductAccess.belongsTo(Contact, {
    foreignKey: "contact_id",
    as: "contact",
  });

  KwigaProduct.hasMany(ContactProductAccess, {
    foreignKey: "kwiga_product_id",
    as: "accessRows",
  });
  ContactProductAccess.belongsTo(KwigaProduct, {
    foreignKey: "kwiga_product_id",
    as: "kwigaProduct",
  });
}
