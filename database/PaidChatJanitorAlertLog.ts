import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface PaidChatJanitorAlertLogAttributes {
  id: number;
  telegramId: string;
  alertType: string;
  dedupeKey: string;
  contactId: number | null;
  grantEndAt: Date | null;
  createdAt?: Date;
}

type Creation = Optional<
  PaidChatJanitorAlertLogAttributes,
  "id" | "contactId" | "grantEndAt" | "createdAt"
>;

export class PaidChatJanitorAlertLog
  extends Model<PaidChatJanitorAlertLogAttributes, Creation>
  implements PaidChatJanitorAlertLogAttributes
{
  declare id: number;
  declare telegramId: string;
  declare alertType: string;
  declare dedupeKey: string;
  declare contactId: number | null;
  declare grantEndAt: Date | null;
  declare readonly createdAt: Date;
}

PaidChatJanitorAlertLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    telegramId: {
      type: DataTypes.STRING(32),
      allowNull: false,
      field: "telegram_id",
    },
    alertType: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "alert_type",
    },
    dedupeKey: {
      type: DataTypes.STRING(512),
      allowNull: false,
      field: "dedupe_key",
    },
    contactId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "contact_id",
    },
    grantEndAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "grant_end_at",
    },
  },
  {
    sequelize,
    tableName: "paid_chat_janitor_alert_log",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "paid_chat_janitor_alert_log_dedupe_uq",
        unique: true,
        fields: ["telegram_id", "alert_type", "dedupe_key"],
      },
    ],
  },
);
