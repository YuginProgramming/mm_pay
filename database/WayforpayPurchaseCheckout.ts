import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

/** Поля HTML-форми POST на https://secure.wayforpay.com/pay */
export type WayforpayPurchaseFormFields = {
  scalars: Record<string, string | number>;
  arrays: Record<string, string[]>;
};

export interface WayforpayPurchaseCheckoutAttributes {
  orderReference: string;
  formFields: WayforpayPurchaseFormFields;
  createdAt?: Date;
}

type Creation = Optional<WayforpayPurchaseCheckoutAttributes, "createdAt">;

export class WayforpayPurchaseCheckout
  extends Model<WayforpayPurchaseCheckoutAttributes, Creation>
  implements WayforpayPurchaseCheckoutAttributes
{
  declare orderReference: string;
  declare formFields: WayforpayPurchaseFormFields;
  declare readonly createdAt: Date;
}

WayforpayPurchaseCheckout.init(
  {
    orderReference: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      field: "order_reference",
    },
    formFields: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "form_fields",
    },
  },
  {
    sequelize,
    tableName: "wayforpay_purchase_checkouts",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);
