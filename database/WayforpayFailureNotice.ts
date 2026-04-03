import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

/** One row per order_reference — avoids duplicate Telegram alerts on webhook retries. */
export interface WayforpayFailureNoticeAttributes {
  orderReference: string;
  createdAt?: Date;
}

type Creation = Optional<WayforpayFailureNoticeAttributes, "createdAt">;

export class WayforpayFailureNotice
  extends Model<WayforpayFailureNoticeAttributes, Creation>
  implements WayforpayFailureNoticeAttributes
{
  declare orderReference: string;
  declare readonly createdAt: Date;
}

WayforpayFailureNotice.init(
  {
    orderReference: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      field: "order_reference",
    },
  },
  {
    sequelize,
    tableName: "wayforpay_failure_notices",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);
