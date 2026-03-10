import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";
// Shape of nested data we store as JSONB (matches API console output)
export type ContactTagRecord = { id: number; name: string };
export type ContactOfferRecord = { id: number; code: string; title: string };
export type ContactPaymentRecord = {
  id: number;
  status: number | null;
  status_title: string | null;
  amount: number | null;
  currency: string | null;
};
export type ContactOrderRecord = {
  id: number;
  paid_status: string | null;
  paid_status_title: string | null;
  amount: number | null;
  currency: string | null;
  payments: ContactPaymentRecord[];
};
export interface ContactAttributes {
  id: number;
  externalId: number;       // Kwiga API contact id (e.g. 2040136)
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAtFromApi: Date | null;  // created_at from API
  tags: ContactTagRecord[];
  offers: ContactOfferRecord[];
  orders: ContactOrderRecord[];
  createdAt?: Date;
  updatedAt?: Date;
}
type ContactCreationAttributes = Optional<
  ContactAttributes,
  "id" | "firstName" | "lastName" | "phone" | "createdAtFromApi" | "tags" | "offers" | "orders" | "createdAt" | "updatedAt"
>;
export class Contact
  extends Model<ContactAttributes, ContactCreationAttributes>
  implements ContactAttributes
{
  declare id: number;
  declare externalId: number;
  declare email: string;
  declare firstName: string | null;
  declare lastName: string | null;
  declare phone: string | null;
  declare createdAtFromApi: Date | null;
  declare tags: ContactTagRecord[];
  declare offers: ContactOfferRecord[];
  declare orders: ContactOrderRecord[];
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}
Contact.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    externalId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: "external_id",
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "first_name",
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "last_name",
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAtFromApi: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "created_at_from_api",
    },
    tags: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    offers: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    orders: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    tableName: "contacts",
    underscored: true,
  },
);