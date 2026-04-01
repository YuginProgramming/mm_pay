import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

/**
 * One row per product access line (Kwiga subscription or a locally granted row).
 * Effective “has access” for reporting: not locally revoked, API says active, and end_at not passed.
 */
export type AccessSource = "kwiga_sync" | "manual_grant" | "payment_hook";

export interface ContactProductAccessAttributes {
  id: number;
  contactId: number;
  kwigaProductId: number | null;
  externalProductId: number;
  externalSubscriptionId: string | null;
  titleSnapshot: string | null;
  isActive: boolean;
  isPaid: boolean;
  startAt: Date | null;
  endAt: Date | null;
  paidAt: Date | null;
  subscriptionStateTitle: string | null;
  countAvailableDays: number | null;
  countLeftDays: number | null;
  orderId: string | null;
  offerId: string | null;
  /** WayForPay orderReference (UUID) — ідемпотентність webhook; лише для payment_hook. */
  wayforpayOrderReference: string | null;
  source: AccessSource;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastSyncedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

type ContactProductAccessCreationAttributes = Optional<
  ContactProductAccessAttributes,
  | "id"
  | "kwigaProductId"
  | "externalSubscriptionId"
  | "titleSnapshot"
  | "isActive"
  | "isPaid"
  | "startAt"
  | "endAt"
  | "paidAt"
  | "subscriptionStateTitle"
  | "countAvailableDays"
  | "countLeftDays"
  | "orderId"
  | "offerId"
  | "wayforpayOrderReference"
  | "source"
  | "revokedAt"
  | "revokedReason"
  | "lastSyncedAt"
  | "createdAt"
  | "updatedAt"
>;

export class ContactProductAccess
  extends Model<ContactProductAccessAttributes, ContactProductAccessCreationAttributes>
  implements ContactProductAccessAttributes
{
  declare id: number;
  declare contactId: number;
  declare kwigaProductId: number | null;
  declare externalProductId: number;
  declare externalSubscriptionId: string | null;
  declare titleSnapshot: string | null;
  declare isActive: boolean;
  declare isPaid: boolean;
  declare startAt: Date | null;
  declare endAt: Date | null;
  declare paidAt: Date | null;
  declare subscriptionStateTitle: string | null;
  declare countAvailableDays: number | null;
  declare countLeftDays: number | null;
  declare orderId: string | null;
  declare offerId: string | null;
  declare wayforpayOrderReference: string | null;
  declare source: AccessSource;
  declare revokedAt: Date | null;
  declare revokedReason: string | null;
  declare lastSyncedAt: Date | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

ContactProductAccess.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    contactId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "contact_id",
      references: { model: "contacts", key: "id" },
      onDelete: "CASCADE",
    },
    kwigaProductId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "kwiga_product_id",
      references: { model: "kwiga_products", key: "id" },
      onDelete: "SET NULL",
    },
    externalProductId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "external_product_id",
    },
    externalSubscriptionId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      unique: true,
      field: "external_subscription_id",
    },
    titleSnapshot: {
      type: DataTypes.STRING(512),
      allowNull: true,
      field: "title_snapshot",
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
    isPaid: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_paid",
    },
    startAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "start_at",
    },
    endAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "end_at",
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "paid_at",
    },
    subscriptionStateTitle: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "subscription_state_title",
    },
    countAvailableDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "count_available_days",
    },
    countLeftDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "count_left_days",
    },
    orderId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "order_id",
    },
    offerId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "offer_id",
    },
    wayforpayOrderReference: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: "wayforpay_order_reference",
    },
    source: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "kwiga_sync",
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "revoked_at",
    },
    revokedReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "revoked_reason",
    },
    lastSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_synced_at",
    },
  },
  {
    sequelize,
    tableName: "contact_product_access",
    underscored: true,
    indexes: [
      { fields: ["contact_id"] },
      { fields: ["external_product_id"] },
      { fields: ["contact_id", "is_active", "revoked_at"] },
    ],
  },
);
