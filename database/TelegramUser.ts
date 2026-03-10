// database/TelegramUser.ts
import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";
export interface TelegramUserAttributes {
  id: number;
  telegramId: string;              // stored as BIGINT in DB
  email: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isBot: boolean;
  isPremium: boolean;
  addedToAttachmentMenu: boolean;
  allowsWriteToPm: boolean;
  lastActivity: Date | null;
  totalInteractions: number;
  isActive: boolean;
  preferences: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}
type TelegramUserCreationAttributes = Optional<
  TelegramUserAttributes,
  | "id"
  | "email"
  | "username"
  | "firstName"
  | "lastName"
  | "languageCode"
  | "isBot"
  | "isPremium"
  | "addedToAttachmentMenu"
  | "allowsWriteToPm"
  | "lastActivity"
  | "totalInteractions"
  | "isActive"
  | "preferences"
  | "createdAt"
  | "updatedAt"
>;
export class TelegramUser
  extends Model<TelegramUserCreationAttributes, TelegramUserCreationAttributes>
  implements TelegramUserAttributes
{
  declare id: number;
  declare telegramId: string;
  declare email: string | null;
  declare username: string | null;
  declare firstName: string | null;
  declare lastName: string | null;
  declare languageCode: string | null;
  declare isBot: boolean;
  declare isPremium: boolean;
  declare addedToAttachmentMenu: boolean;
  declare allowsWriteToPm: boolean;
  declare lastActivity: Date | null;
  declare totalInteractions: number;
  declare isActive: boolean;
  declare preferences: Record<string, any> | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
TelegramUser.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    telegramId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      unique: true,
      field: "telegram_id",
      comment: "Telegram user ID (unique identifier from Telegram)",
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Email associated with this Telegram user",
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Telegram username (without @)",
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "first_name",
      comment: "User first name from Telegram",
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "last_name",
      comment: "User last name from Telegram",
    },
    languageCode: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "language_code",
      comment: 'User language code (e.g., "uk", "en")',
    },
    isBot: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_bot",
      comment: "Whether the user is a bot",
    },
    isPremium: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_premium",
      comment: "Whether user has Telegram Premium",
    },
    addedToAttachmentMenu: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "added_to_attachment_menu",
      comment: "Whether user added bot to attachment menu",
    },
    allowsWriteToPm: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "allows_write_to_pm",
      comment: "Whether user allows bot to write private messages",
    },
    lastActivity: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_activity",
      comment: "Last time user interacted with bot",
    },
    totalInteractions: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "total_interactions",
      comment: "Total number of interactions with bot",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
      comment: "Whether user is currently active",
    },
    preferences: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: "User preferences (language, reading settings, etc.)",
    },
  },
  {
    sequelize,
    tableName: "telegram_users",
    underscored: true,
  },
);