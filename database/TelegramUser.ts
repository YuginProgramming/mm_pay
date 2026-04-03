// database/TelegramUser.ts
import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";
import type { KwigaAudienceRank } from "../telegram/kwiga-user-rank";

export interface TelegramUserAttributes {
  id: number;
  telegramId: string;              // stored as BIGINT in DB
  email: string | null;
  /** Bot state: waiting for user to send an email (not stored in JSON). */
  awaitingEmail: boolean;
  /** Previous email while user is changing address (not stored in JSON). */
  emailChangeFrom: string | null;
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
  /** Кеш рангу KWIGA: оновлюється при відкритті профілю / sync / дебаг-скриптах. */
  kwigaAudienceRank: KwigaAudienceRank | null;
  kwigaAccessRowCount: number | null;
  kwigaRankSyncedAt: Date | null;
  preferences: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}
type TelegramUserCreationAttributes = Optional<
  TelegramUserAttributes,
  | "id"
  | "email"
  | "awaitingEmail"
  | "emailChangeFrom"
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
  | "kwigaAudienceRank"
  | "kwigaAccessRowCount"
  | "kwigaRankSyncedAt"
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
  declare awaitingEmail: boolean;
  declare emailChangeFrom: string | null;
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
  declare kwigaAudienceRank: KwigaAudienceRank | null;
  declare kwigaAccessRowCount: number | null;
  declare kwigaRankSyncedAt: Date | null;
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
      comment:
        "Email (lowercase after migration); unique among non-null rows — index telegram_users_email_uq",
    },
    awaitingEmail: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "awaiting_email",
      comment: "Bot is collecting email from user via chat",
    },
    emailChangeFrom: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "email_change_from",
      comment: "Previous email while change_email flow is active",
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
    kwigaAudienceRank: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "kwiga_audience_rank",
      comment:
        "KWIGA audience tier: no_kwiga_contact | prospectives | masters | pro",
    },
    kwigaAccessRowCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "kwiga_access_row_count",
      comment:
        "Lifetime contact_product_access row count used for rank (at last sync)",
    },
    kwigaRankSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "kwiga_rank_synced_at",
      comment: "When kwiga_audience_rank was last written",
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