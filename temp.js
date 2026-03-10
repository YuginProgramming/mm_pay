import { DataTypes } from 'sequelize';
import { sequelize } from '../sequelize.js';

const TelegramUser = sequelize.define('TelegramUser', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  telegramId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    unique: true,
    comment: 'Telegram user ID (unique identifier from Telegram)'
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Telegram username (without @)'
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'User first name from Telegram'
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'User last name from Telegram'
  },
  languageCode: {
    type: DataTypes.STRING(10),
    allowNull: true,
    comment: 'User language code (e.g., "uk", "en")'
  },
  isBot: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether the user is a bot'
  },
  isPremium: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether user has Telegram Premium'
  },
  addedToAttachmentMenu: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether user added bot to attachment menu'
  },
  allowsWriteToPm: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether user allows bot to write private messages'
  },
  lastActivity: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time user interacted with bot'
  },
  totalInteractions: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Total number of interactions with bot'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether user is currently active'
  },
  preferences: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'User preferences (language, reading settings, etc.)'
  }
}, {
  tableName: 'telegram_users',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    {
      unique: true,
      fields: ['telegramId']
    },
    {
      fields: ['username']
    },
    {
      fields: ['lastActivity']
    },
    {
      fields: ['isActive']
    }
  ]
});

export default TelegramUser;
