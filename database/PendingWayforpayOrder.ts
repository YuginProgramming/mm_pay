import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface PendingWayforpayOrderAttributes {
  orderReference: string;
  chatId: string;
  courseName: string;
  createdAt?: Date;
}

type Creation = Optional<PendingWayforpayOrderAttributes, "createdAt">;

export class PendingWayforpayOrder
  extends Model<PendingWayforpayOrderAttributes, Creation>
  implements PendingWayforpayOrderAttributes
{
  declare orderReference: string;
  declare chatId: string;
  declare courseName: string;
  declare readonly createdAt: Date;
}

PendingWayforpayOrder.init(
  {
    orderReference: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      field: "order_reference",
    },
    chatId: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "chat_id",
    },
    courseName: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "course_name",
    },
  },
  {
    sequelize,
    tableName: "pending_wayforpay_orders",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);
