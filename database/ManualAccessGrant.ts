import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export type ManualAccessGrantStatus = "pending" | "applied" | "partial" | "failed";

export interface ManualAccessGrantAttributes {
  id: number;
  operationKey: string;
  telegramUserId: string;
  contactId: number;
  email: string;
  startAt: Date;
  endAt: Date;
  days: number;
  reason: string;
  operator: string;
  status: ManualAccessGrantStatus;
  closeLocalAuto: boolean;
  kwigaResult: object | null;
  error: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type ManualAccessGrantCreationAttributes = Optional<
  ManualAccessGrantAttributes,
  | "id"
  | "status"
  | "closeLocalAuto"
  | "kwigaResult"
  | "error"
  | "createdAt"
  | "updatedAt"
>;

export class ManualAccessGrant
  extends Model<ManualAccessGrantAttributes, ManualAccessGrantCreationAttributes>
  implements ManualAccessGrantAttributes
{
  declare id: number;
  declare operationKey: string;
  declare telegramUserId: string;
  declare contactId: number;
  declare email: string;
  declare startAt: Date;
  declare endAt: Date;
  declare days: number;
  declare reason: string;
  declare operator: string;
  declare status: ManualAccessGrantStatus;
  declare closeLocalAuto: boolean;
  declare kwigaResult: object | null;
  declare error: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ManualAccessGrant.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    operationKey: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
      field: "operation_key",
    },
    telegramUserId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "telegram_user_id",
    },
    contactId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "contact_id",
      references: { model: "contacts", key: "id" },
      onDelete: "CASCADE",
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
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
    days: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    operator: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "pending",
    },
    closeLocalAuto: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "close_local_auto",
    },
    kwigaResult: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "kwiga_result",
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "manual_access_grants",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["telegram_user_id", "created_at"] },
      { fields: ["contact_id", "end_at"] },
    ],
  },
);
