import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface RulesConsentAttributes {
  id: number;
  telegramId: string;
  rulesVersion: string;
  rulesUrl: string;
  acceptedAt: Date;
}

type RulesConsentCreationAttributes = Optional<
  RulesConsentAttributes,
  "id" | "acceptedAt"
>;

export class RulesConsent
  extends Model<RulesConsentAttributes, RulesConsentCreationAttributes>
  implements RulesConsentAttributes
{
  declare id: number;
  declare telegramId: string;
  declare rulesVersion: string;
  declare rulesUrl: string;
  declare acceptedAt: Date;
}

RulesConsent.init(
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
    rulesVersion: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "rules_version",
    },
    rulesUrl: {
      type: DataTypes.STRING(512),
      allowNull: false,
      field: "rules_url",
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "accepted_at",
    },
  },
  {
    sequelize,
    tableName: "rules_consents",
    underscored: true,
    timestamps: false,
    indexes: [
      { unique: true, fields: ["telegram_id", "rules_version"] },
      { fields: ["telegram_id"] },
      { fields: ["accepted_at"] },
    ],
  },
);
