import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface SubscriptionPlanAttributes {
  id: number;
  code: string;
  title: string | null;
  durationDays: number;
  price: string;
  currency: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type SubscriptionPlanCreationAttributes = Optional<
  SubscriptionPlanAttributes,
  "id" | "title" | "createdAt" | "updatedAt"
>;

export class SubscriptionPlan
  extends Model<SubscriptionPlanAttributes, SubscriptionPlanCreationAttributes>
  implements SubscriptionPlanAttributes
{
  declare id: number;
  declare code: string;
  declare title: string | null;
  declare durationDays: number;
  declare price: string;
  declare currency: string;
  declare isActive: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SubscriptionPlan.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    durationDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "duration_days",
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: "UAH",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
  },
  {
    sequelize,
    tableName: "subscription_plans",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);
