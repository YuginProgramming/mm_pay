import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface WayforpayPendingNoticeAttributes {
  orderReference: string;
  chatId: string | null;
  firstPendingAt: Date | null;
  pendingNotifiedAt: Date | null;
  pendingReminderSentAt: Date | null;
  pendingTimeoutSentAt: Date | null;
  terminalStatusAt: Date | null;
  terminalStatusValue: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type Creation = Optional<
  WayforpayPendingNoticeAttributes,
  | "chatId"
  | "firstPendingAt"
  | "pendingNotifiedAt"
  | "pendingReminderSentAt"
  | "pendingTimeoutSentAt"
  | "terminalStatusAt"
  | "terminalStatusValue"
  | "createdAt"
  | "updatedAt"
>;

export class WayforpayPendingNotice
  extends Model<WayforpayPendingNoticeAttributes, Creation>
  implements WayforpayPendingNoticeAttributes
{
  declare orderReference: string;
  declare chatId: string | null;
  declare firstPendingAt: Date | null;
  declare pendingNotifiedAt: Date | null;
  declare pendingReminderSentAt: Date | null;
  declare pendingTimeoutSentAt: Date | null;
  declare terminalStatusAt: Date | null;
  declare terminalStatusValue: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

WayforpayPendingNotice.init(
  {
    orderReference: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      field: "order_reference",
    },
    chatId: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "chat_id",
    },
    firstPendingAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "first_pending_at",
    },
    pendingNotifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "pending_notified_at",
    },
    pendingReminderSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "pending_reminder_sent_at",
    },
    pendingTimeoutSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "pending_timeout_sent_at",
    },
    terminalStatusAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "terminal_status_at",
    },
    terminalStatusValue: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "terminal_status_value",
    },
  },
  {
    sequelize,
    tableName: "wayforpay_pending_notices",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);
