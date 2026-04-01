import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface EmailChangeLogAttributes {
  id: number;
  telegramId: string;
  oldEmail: string;
  newEmail: string;
  createdAt?: Date;
}

type EmailChangeLogCreationAttributes = Optional<
  EmailChangeLogAttributes,
  "id" | "createdAt"
>;

export class EmailChangeLog
  extends Model<EmailChangeLogAttributes, EmailChangeLogCreationAttributes>
  implements EmailChangeLogAttributes
{
  declare id: number;
  declare telegramId: string;
  declare oldEmail: string;
  declare newEmail: string;
  declare readonly createdAt: Date;
}

EmailChangeLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    telegramId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "telegram_id",
    },
    oldEmail: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "old_email",
    },
    newEmail: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "new_email",
    },
  },
  {
    sequelize,
    tableName: "email_change_logs",
    underscored: true,
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ["telegram_id"] }, { fields: ["created_at"] }],
  },
);
