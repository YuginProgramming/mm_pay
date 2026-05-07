import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";
import type { ConsultationProductCode } from "../payment/consultation-product";

export interface ConsultationPaymentOrderAttributes {
  id: number;
  orderReference: string;
  telegramUserId: string;
  telegramChatId: string;
  productCode: ConsultationProductCode;
  status: string;
  amount: string;
  currency: string;
  provider: string;
  checkoutUrl: string | null;
  terminalAt: Date | null;
  failureReasonCode: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type Creation = Optional<
  ConsultationPaymentOrderAttributes,
  | "id"
  | "checkoutUrl"
  | "terminalAt"
  | "failureReasonCode"
  | "createdAt"
  | "updatedAt"
>;

export class ConsultationPaymentOrder
  extends Model<ConsultationPaymentOrderAttributes, Creation>
  implements ConsultationPaymentOrderAttributes
{
  declare id: number;
  declare orderReference: string;
  declare telegramUserId: string;
  declare telegramChatId: string;
  declare productCode: ConsultationProductCode;
  declare status: string;
  declare amount: string;
  declare currency: string;
  declare provider: string;
  declare checkoutUrl: string | null;
  declare terminalAt: Date | null;
  declare failureReasonCode: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ConsultationPaymentOrder.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    orderReference: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
      field: "order_reference",
    },
    telegramUserId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "telegram_user_id",
    },
    telegramChatId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "telegram_chat_id",
    },
    productCode: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "product_code",
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
      defaultValue: "UAH",
    },
    provider: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "wayforpay",
    },
    checkoutUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "checkout_url",
    },
    terminalAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "terminal_at",
    },
    failureReasonCode: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "failure_reason_code",
    },
  },
  {
    sequelize,
    tableName: "consultation_payment_orders",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["telegram_user_id", "product_code", "status"] },
      { fields: ["telegram_chat_id"] },
    ],
  },
);
