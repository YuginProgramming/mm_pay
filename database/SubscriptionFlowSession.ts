import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface SubscriptionFlowSessionAttributes {
  id: number;
  userId: string;
  flowType: string;
  step: string;
  orderReference: string | null;
  expiresAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type SubscriptionFlowSessionCreationAttributes = Optional<
  SubscriptionFlowSessionAttributes,
  "id" | "orderReference" | "expiresAt" | "createdAt" | "updatedAt"
>;

export class SubscriptionFlowSession
  extends Model<
    SubscriptionFlowSessionAttributes,
    SubscriptionFlowSessionCreationAttributes
  >
  implements SubscriptionFlowSessionAttributes
{
  declare id: number;
  declare userId: string;
  declare flowType: string;
  declare step: string;
  declare orderReference: string | null;
  declare expiresAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SubscriptionFlowSession.init(
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
    flowType: {
      type: DataTypes.STRING(32),
      allowNull: false,
      field: "flow_type",
    },
    step: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    orderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "order_reference",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "expires_at",
    },
  },
  {
    sequelize,
    tableName: "subscription_flow_sessions",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["user_id"] }],
  },
);
