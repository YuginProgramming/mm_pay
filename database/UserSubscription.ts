import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export type UserSubscriptionStatus = "active" | "lapsed" | "canceled";

export interface UserSubscriptionAttributes {
  id: number;
  userId: string;
  planId: number;
  status: UserSubscriptionStatus;
  startAt: Date;
  endAt: Date;
  lastPaymentOrderReference: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type UserSubscriptionCreationAttributes = Optional<
  UserSubscriptionAttributes,
  "id" | "status" | "lastPaymentOrderReference" | "createdAt" | "updatedAt"
>;

export class UserSubscription
  extends Model<UserSubscriptionAttributes, UserSubscriptionCreationAttributes>
  implements UserSubscriptionAttributes
{
  declare id: number;
  declare userId: string;
  declare planId: number;
  declare status: UserSubscriptionStatus;
  declare startAt: Date;
  declare endAt: Date;
  declare lastPaymentOrderReference: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

UserSubscription.init(
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
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "active",
    },
    startAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "start_at",
    },
    endAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "end_at",
    },
    lastPaymentOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "last_payment_order_reference",
    },
  },
  {
    sequelize,
    tableName: "user_subscriptions",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["user_id", "status", "end_at"] }],
  },
);
