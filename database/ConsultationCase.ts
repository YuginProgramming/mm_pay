import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface ConsultationCaseAttributes {
  id: number;
  consultationId: string;
  telegramUserId: string;
  telegramChatId: string;
  status: string;
  productCode: string | null;
  orderReference: string | null;
  managerChatId: string | null;
  messageThreadId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type Creation = Optional<
  ConsultationCaseAttributes,
  | "id"
  | "productCode"
  | "orderReference"
  | "managerChatId"
  | "messageThreadId"
  | "createdAt"
  | "updatedAt"
>;

export class ConsultationCase
  extends Model<ConsultationCaseAttributes, Creation>
  implements ConsultationCaseAttributes
{
  declare id: number;
  declare consultationId: string;
  declare telegramUserId: string;
  declare telegramChatId: string;
  declare status: string;
  declare productCode: string | null;
  declare orderReference: string | null;
  declare managerChatId: string | null;
  declare messageThreadId: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ConsultationCase.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    consultationId: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
      field: "consultation_id",
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
    status: { type: DataTypes.STRING(32), allowNull: false },
    productCode: { type: DataTypes.STRING(64), allowNull: true, field: "product_code" },
    orderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "order_reference",
    },
    managerChatId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "manager_chat_id",
    },
    messageThreadId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "message_thread_id",
    },
  },
  {
    sequelize,
    tableName: "consultation_cases",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);
