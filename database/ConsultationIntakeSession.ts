import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface ConsultationIntakeSessionAttributes {
  id: number;
  consultationId: string;
  telegramUserId: string;
  status: string;
  step: string;
  answersJson: Record<string, string>;
  mediaFileIdsJson: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}

type Creation = Optional<
  ConsultationIntakeSessionAttributes,
  "id" | "answersJson" | "mediaFileIdsJson" | "createdAt" | "updatedAt"
>;

export class ConsultationIntakeSession
  extends Model<ConsultationIntakeSessionAttributes, Creation>
  implements ConsultationIntakeSessionAttributes
{
  declare id: number;
  declare consultationId: string;
  declare telegramUserId: string;
  declare status: string;
  declare step: string;
  declare answersJson: Record<string, string>;
  declare mediaFileIdsJson: unknown[];
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ConsultationIntakeSession.init(
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
    status: { type: DataTypes.STRING(32), allowNull: false },
    step: { type: DataTypes.STRING(32), allowNull: false },
    answersJson: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
      field: "answers_json",
    },
    mediaFileIdsJson: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: "media_file_ids_json",
    },
  },
  {
    sequelize,
    tableName: "consultation_intake_sessions",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);
