import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

/** Останній відомий статус учасника (Telegram `ChatMember.status`) з оновлень chat_member. */
export interface PaidChatMemberStateAttributes {
  chatId: string;
  userId: string;
  status: string;
  updatedAt?: Date;
}

type Creation = Optional<PaidChatMemberStateAttributes, "updatedAt">;

export class PaidChatMemberState
  extends Model<PaidChatMemberStateAttributes, Creation>
  implements PaidChatMemberStateAttributes
{
  declare chatId: string;
  declare userId: string;
  declare status: string;
  declare updatedAt: Date;
}

PaidChatMemberState.init(
  {
    chatId: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      field: "chat_id",
    },
    userId: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      field: "user_id",
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "updated_at",
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "paid_chat_member_state",
    underscored: true,
    timestamps: false,
  },
);
