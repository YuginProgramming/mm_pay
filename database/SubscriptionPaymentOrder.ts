import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface SubscriptionPaymentOrderAttributes {
  id: number;
  orderReference: string;
  userId: string;
  planId: number;
  status: string;
  amount: string;
  currency: string;
  provider: string;
  checkoutUrl: string | null;
  terminalAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type SubscriptionPaymentOrderCreationAttributes = Optional<
  SubscriptionPaymentOrderAttributes,
  "id" | "checkoutUrl" | "terminalAt" | "createdAt" | "updatedAt"
>;

export class SubscriptionPaymentOrder
  extends Model<
    SubscriptionPaymentOrderAttributes,
    SubscriptionPaymentOrderCreationAttributes
  >
  implements SubscriptionPaymentOrderAttributes
{
  declare id: number;
  declare orderReference: string;
  declare userId: string;
  declare planId: number;
  declare status: string;
  declare amount: string;
  declare currency: string;
  declare provider: string;
  declare checkoutUrl: string | null;
  declare terminalAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SubscriptionPaymentOrder.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    orderReference: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
      field: "order_reference",
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
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: "UAH",
    },
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "wayforpay",
    },
    checkoutUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "checkout_url",
    },
    terminalAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "terminal_at",
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updated_at",
    },
  },
  {
    sequelize,
    tableName: "subscription_payment_orders",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["user_id", "plan_id", "status"] }],
  },
);
