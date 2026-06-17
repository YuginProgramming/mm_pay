import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export type KwigaPurchaseGrantStatus =
  | "pending"
  | "completed"
  | "skipped_valid"
  | "partial"
  | "failed";

export interface KwigaPurchaseGrantAttributes {
  id: number;
  wayforpayOrderReference: string;
  contactId: number;
  status: KwigaPurchaseGrantStatus;
  actionsJson: object | null;
  lastError: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type Creation = Optional<
  KwigaPurchaseGrantAttributes,
  "id" | "status" | "actionsJson" | "lastError" | "createdAt" | "updatedAt"
>;

export class KwigaPurchaseGrant
  extends Model<KwigaPurchaseGrantAttributes, Creation>
  implements KwigaPurchaseGrantAttributes
{
  declare id: number;
  declare wayforpayOrderReference: string;
  declare contactId: number;
  declare status: KwigaPurchaseGrantStatus;
  declare actionsJson: object | null;
  declare lastError: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

KwigaPurchaseGrant.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    wayforpayOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
      field: "wayforpay_order_reference",
    },
    contactId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "contact_id",
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "pending",
    },
    actionsJson: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "actions_json",
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "last_error",
    },
  },
  {
    sequelize,
    tableName: "kwiga_purchase_grants",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "kwiga_purchase_grants_contact_status_idx",
        fields: ["contact_id", "status"],
      },
    ],
  },
);
