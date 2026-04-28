import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface SubscriptionRenewalReminderLogAttributes {
  id: number;
  userId: string;
  subscriptionId: number;
  alertType: string;
  dedupeKey: string;
  subscriptionEndAt: Date | null;
  createdAt?: Date;
}

type Creation = Optional<
  SubscriptionRenewalReminderLogAttributes,
  "id" | "subscriptionEndAt" | "createdAt"
>;

export class SubscriptionRenewalReminderLog
  extends Model<SubscriptionRenewalReminderLogAttributes, Creation>
  implements SubscriptionRenewalReminderLogAttributes
{
  declare id: number;
  declare userId: string;
  declare subscriptionId: number;
  declare alertType: string;
  declare dedupeKey: string;
  declare subscriptionEndAt: Date | null;
  declare readonly createdAt: Date;
}

SubscriptionRenewalReminderLog.init(
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
    subscriptionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "subscription_id",
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
    subscriptionEndAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "subscription_end_at",
    },
  },
  {
    sequelize,
    tableName: "subscription_renewal_reminder_log",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "subscription_renewal_reminder_log_dedupe_uq",
        unique: true,
        fields: ["user_id", "alert_type", "dedupe_key"],
      },
    ],
  },
);
