import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

/** Kwiga catalog row (product_id from GET /contacts/:id/products). */
export interface KwigaProductAttributes {
  id: number;
  externalProductId: number;
  productableType: string | null;
  productableId: number | null;
  title: string;
  isPublished: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type KwigaProductCreationAttributes = Optional<
  KwigaProductAttributes,
  "id" | "productableType" | "productableId" | "isPublished" | "createdAt" | "updatedAt"
>;

export class KwigaProduct
  extends Model<KwigaProductAttributes, KwigaProductCreationAttributes>
  implements KwigaProductAttributes
{
  declare id: number;
  declare externalProductId: number;
  declare productableType: string | null;
  declare productableId: number | null;
  declare title: string;
  declare isPublished: boolean | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

KwigaProduct.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    externalProductId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: "external_product_id",
    },
    productableType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "productable_type",
    },
    productableId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "productable_id",
    },
    title: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    isPublished: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_published",
    },
  },
  {
    sequelize,
    tableName: "kwiga_products",
    underscored: true,
  },
);
