import { Contact } from "./Contact";
import { ContactProductAccess } from "./ContactProductAccess";
import { KwigaProduct } from "./KwigaProduct";
import { SubscriptionPlan } from "./SubscriptionPlan";
import { UserSubscription } from "./UserSubscription";
import { SubscriptionAuto } from "./SubscriptionAuto";

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

  SubscriptionPlan.hasMany(UserSubscription, {
    foreignKey: "plan_id",
    as: "subscriptions",
  });
  UserSubscription.belongsTo(SubscriptionPlan, {
    foreignKey: "plan_id",
    as: "plan",
  });

  SubscriptionPlan.hasMany(SubscriptionAuto, {
    foreignKey: "plan_id",
    as: "subscriptionAutoRows",
  });
  SubscriptionAuto.belongsTo(SubscriptionPlan, {
    foreignKey: "plan_id",
    as: "plan",
  });
}
