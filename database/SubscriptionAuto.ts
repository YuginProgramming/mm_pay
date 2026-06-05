import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface SubscriptionAutoAttributes {
  id: number;
  userId: string;
  planId: number;
  /** orderReference першої успішної оплати — ключ regularApi STATUS у WayForPay. */
  anchorOrderReference: string | null;
  /** Останній orderReference з webhook (може відрізнятися при повторних списаннях). */
  latestOrderReference: string | null;
  paymentToken: string | null;
  wayforpayStatus: string | null;
  wayforpayMode: string | null;
  nextChargeAt: Date | null;
  autoRenewEnabled: boolean;
  lastChargeStatus: string | null;
  lastChargeAt: Date | null;
  cancelledAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type SubscriptionAutoCreationAttributes = Optional<
  SubscriptionAutoAttributes,
  | "id"
  | "anchorOrderReference"
  | "latestOrderReference"
  | "paymentToken"
  | "wayforpayStatus"
  | "wayforpayMode"
  | "nextChargeAt"
  | "autoRenewEnabled"
  | "lastChargeStatus"
  | "lastChargeAt"
  | "cancelledAt"
  | "createdAt"
  | "updatedAt"
>;

export class SubscriptionAuto
  extends Model<SubscriptionAutoAttributes, SubscriptionAutoCreationAttributes>
  implements SubscriptionAutoAttributes
{
  declare id: number;
  declare userId: string;
  declare planId: number;
  declare anchorOrderReference: string | null;
  declare latestOrderReference: string | null;
  declare paymentToken: string | null;
  declare wayforpayStatus: string | null;
  declare wayforpayMode: string | null;
  declare nextChargeAt: Date | null;
  declare autoRenewEnabled: boolean;
  declare lastChargeStatus: string | null;
  declare lastChargeAt: Date | null;
  declare cancelledAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SubscriptionAuto.init(
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
    anchorOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "anchor_order_reference",
    },
    latestOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "latest_order_reference",
    },
    paymentToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "payment_token",
    },
    wayforpayStatus: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "wayforpay_status",
    },
    wayforpayMode: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "wayforpay_mode",
    },
    nextChargeAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "next_charge_at",
    },
    autoRenewEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "auto_renew_enabled",
    },
    lastChargeStatus: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "last_charge_status",
    },
    lastChargeAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_charge_at",
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "cancelled_at",
    },
  },
  {
    sequelize,
    tableName: "subscription_auto",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { unique: true, fields: ["user_id", "plan_id"] },
      { fields: ["auto_renew_enabled", "next_charge_at"] },
    ],
  },
);
