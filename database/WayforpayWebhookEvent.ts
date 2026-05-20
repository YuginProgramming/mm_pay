import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./db";

export interface WayforpayWebhookEventAttributes {
  id: number;
  orderReference: string;
  transactionStatus: string;
  amountRaw: string;
  currency: string;
  reasonCode: string | null;
  merchantAccount: string;
  signatureValid: boolean;
  metadataChatId: string | null;
  metadataCourseName: string | null;
  rawPayload: Record<string, unknown>;
  createdAt?: Date;
}

type Creation = Optional<
  WayforpayWebhookEventAttributes,
  | "id"
  | "reasonCode"
  | "metadataChatId"
  | "metadataCourseName"
  | "createdAt"
>;

export class WayforpayWebhookEvent
  extends Model<WayforpayWebhookEventAttributes, Creation>
  implements WayforpayWebhookEventAttributes
{
  declare id: number;
  declare orderReference: string;
  declare transactionStatus: string;
  declare amountRaw: string;
  declare currency: string;
  declare reasonCode: string | null;
  declare merchantAccount: string;
  declare signatureValid: boolean;
  declare metadataChatId: string | null;
  declare metadataCourseName: string | null;
  declare rawPayload: Record<string, unknown>;
  declare readonly createdAt: Date;
}

WayforpayWebhookEvent.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    orderReference: {
      type: DataTypes.STRING(128),
      allowNull: false,
      field: "order_reference",
    },
    transactionStatus: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "transaction_status",
    },
    amountRaw: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "amount_raw",
      comment: "Amount as WayForPay sent it (string or number stringified)",
    },
    currency: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    reasonCode: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: "reason_code",
    },
    merchantAccount: {
      type: DataTypes.STRING(128),
      allowNull: false,
      field: "merchant_account",
    },
    signatureValid: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "signature_valid",
    },
    metadataChatId: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "metadata_chat_id",
    },
    metadataCourseName: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "metadata_course_name",
    },
    rawPayload: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "raw_payload",
    },
  },
  {
    sequelize,
    tableName: "wayforpay_webhook_events",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  },
);
