import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface AppSettingAttributes {
  settingKey: string;
  settingValue: string;
  descriptionUk: string | null;
  updatedAt?: Date;
}

type AppSettingCreationAttributes = Optional<
  AppSettingAttributes,
  "descriptionUk" | "updatedAt"
>;

export class AppSetting
  extends Model<AppSettingAttributes, AppSettingCreationAttributes>
  implements AppSettingAttributes
{
  declare settingKey: string;
  declare settingValue: string;
  declare descriptionUk: string | null;
  declare readonly updatedAt: Date;
}

AppSetting.init(
  {
    settingKey: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      field: "setting_key",
      comment: "Унікальний ключ параметра (латиниця, snake_case)",
    },
    settingValue: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
      field: "setting_value",
      comment: "Значення як текст (числа, id групи тощо)",
    },
    descriptionUk: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description_uk",
      comment: "Підказка українською для адміна",
    },
  },
  {
    sequelize,
    tableName: "app_settings",
    underscored: true,
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
  },
);
