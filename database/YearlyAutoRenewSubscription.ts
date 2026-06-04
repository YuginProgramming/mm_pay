import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface YearlyAutoRenewSubscriptionAttributes {
  id: number;
  userId: string;
  planId: number;
  wayforpayRecurringOrderReference: string | null;
  paymentToken: string | null;
  autoRenewEnabled: boolean;
  nextChargeAt: Date | null;
  lastChargeStatus: string | null;
  cancelledAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type YearlyAutoRenewSubscriptionCreationAttributes = Optional<
  YearlyAutoRenewSubscriptionAttributes,
  | "id"
  | "wayforpayRecurringOrderReference"
  | "paymentToken"
  | "autoRenewEnabled"
  | "nextChargeAt"
  | "lastChargeStatus"
  | "cancelledAt"
  | "createdAt"
  | "updatedAt"
>;

export class YearlyAutoRenewSubscription
  extends Model<
    YearlyAutoRenewSubscriptionAttributes,
    YearlyAutoRenewSubscriptionCreationAttributes
  >
  implements YearlyAutoRenewSubscriptionAttributes
{
  declare id: number;
  declare userId: string;
  declare planId: number;
  declare wayforpayRecurringOrderReference: string | null;
  declare paymentToken: string | null;
  declare autoRenewEnabled: boolean;
  declare nextChargeAt: Date | null;
  declare lastChargeStatus: string | null;
  declare cancelledAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

YearlyAutoRenewSubscription.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "user_id",
    },
    planId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "plan_id",
      references: { model: "subscription_plans", key: "id" },
      onDelete: "RESTRICT",
    },
    wayforpayRecurringOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "wayforpay_recurring_order_reference",
    },
    paymentToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "payment_token",
    },
    autoRenewEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "auto_renew_enabled",
    },
    nextChargeAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "next_charge_at",
    },
    lastChargeStatus: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "last_charge_status",
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "cancelled_at",
    },
  },
  {
    sequelize,
    tableName: "yearly_auto_renew_subscriptions",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["user_id"] },
      { fields: ["auto_renew_enabled", "next_charge_at"] },
    ],
  },
);
