import { ContactProductAccess } from "../database/ContactProductAccess";
import { ManualAccessGrant } from "../database/ManualAccessGrant";
import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { sequelize } from "../database/db";
import { unbanUserFromPaidChatsAfterGrant } from "../payment/grant-multimasking-access";
import { setKwigaExactEndDateForRecurringUser } from "../payment/kwiga-recurring-end-date.service";
import { BOT_PAYMENT_EXTERNAL_PRODUCT_ID, MULTIMASKING_PRODUCT_NAME } from "../payment/multimasking-product";

export type ManualAccessGrantInput = {
  operationKey: string;
  userId: string;
  contactId: number;
  email: string;
  startAt: Date;
  endAt: Date;
  days: number;
  reason: string;
  operator: string;
  closeLocalAuto: boolean;
};

export type ManualAccessGrantResult = {
  status: "applied" | "already_applied";
  manualGrantId: number;
  targetEndAt: Date;
  kwiga: {
    attempted: number;
    updated: number;
    skipped: number;
    errors: string[];
  };
  localAutoClosed: number;
  telegramUnbanErrors: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getOrCreateOperation(
  input: ManualAccessGrantInput,
): Promise<ManualAccessGrant> {
  const [row, created] = await ManualAccessGrant.findOrCreate({
    where: { operationKey: input.operationKey },
    defaults: {
      operationKey: input.operationKey,
      telegramUserId: input.userId,
      contactId: input.contactId,
      email: input.email,
      startAt: input.startAt,
      endAt: input.endAt,
      days: input.days,
      reason: input.reason,
      operator: input.operator,
      status: "pending",
      closeLocalAuto: input.closeLocalAuto,
      kwigaResult: null,
      error: null,
    },
  });

  if (!created) {
    if (
      row.telegramUserId !== input.userId ||
      row.contactId !== input.contactId
    ) {
      throw new Error(
        `operation key already belongs to another grant: ${input.operationKey}`,
      );
    }
    if (row.status === "applied") {
      return row;
    }
    await row.update({
      status: "pending",
      email: input.email,
      startAt: input.startAt,
      endAt: input.endAt,
      days: input.days,
      error: null,
      reason: input.reason,
      operator: input.operator,
      closeLocalAuto: input.closeLocalAuto,
    });
  }

  return row;
}

async function createLocalGrantAndCloseAuto(
  input: ManualAccessGrantInput,
  manualGrantId: number,
): Promise<number> {
  return sequelize.transaction(async (transaction) => {
    const existing = await ContactProductAccess.findOne({
      where: { manualAccessGrantId: manualGrantId },
      transaction,
    });

    if (!existing) {
      await ContactProductAccess.create(
        {
          contactId: input.contactId,
          kwigaProductId: null,
          externalProductId: BOT_PAYMENT_EXTERNAL_PRODUCT_ID,
          externalSubscriptionId: null,
          titleSnapshot: `${MULTIMASKING_PRODUCT_NAME} · ручна компенсація`,
          isActive: true,
          isPaid: false,
          startAt: input.startAt,
          endAt: input.endAt,
          paidAt: null,
          subscriptionStateTitle: `Ручна компенсація · ${input.days} днів`,
          countAvailableDays: input.days,
          countLeftDays: null,
          orderId: null,
          offerId: null,
          wayforpayOrderReference: null,
          manualAccessGrantId: manualGrantId,
          source: "manual_override",
          revokedAt: null,
          revokedReason: null,
          lastSyncedAt: null,
        },
        { transaction },
      );
    }

    if (!input.closeLocalAuto) {
      return 0;
    }

    const autos = await SubscriptionAuto.findAll({
      where: { userId: input.userId, cancelledAt: null },
      transaction,
    });
    if (autos.length === 0) {
      return 0;
    }

    const cancelledAt = new Date();
    for (const auto of autos) {
      await auto.update(
        {
          autoRenewEnabled: false,
          cancelledAt,
        },
        { transaction },
      );
    }
    return autos.length;
  });
}

export async function applyManualAccessGrant(
  input: ManualAccessGrantInput,
): Promise<ManualAccessGrantResult> {
  const operation = await getOrCreateOperation(input);
  if (operation.status === "applied") {
    return {
      status: "already_applied",
      manualGrantId: operation.id,
      targetEndAt: operation.endAt,
      kwiga: {
        attempted: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      },
      localAutoClosed: 0,
      telegramUnbanErrors: [],
    };
  }

  const kwiga = await setKwigaExactEndDateForRecurringUser({
    userId: input.userId,
    targetEndAt: input.endAt,
  });
  await operation.update({ kwigaResult: kwiga });

  if (kwiga.errors.length > 0) {
    const status = kwiga.updated > 0 ? "partial" : "failed";
    await operation.update({
      status,
      error: kwiga.errors.join("; ").slice(0, 4000),
    });
    throw new Error(
      `KWIGA exact end-date failed (${kwiga.updated} updated, ${kwiga.errors.length} errors)`,
    );
  }

  const localAutoClosed = await createLocalGrantAndCloseAuto(input, operation.id);
  let telegramUnbanErrors: string[] = [];
  try {
    telegramUnbanErrors = await unbanUserFromPaidChatsAfterGrant(input.userId);
  } catch (error) {
    telegramUnbanErrors.push(errorMessage(error));
  }

  await operation.update({
    status: "applied",
    error: telegramUnbanErrors.length > 0 ? telegramUnbanErrors.join("; ") : null,
  });

  return {
    status: "applied",
    manualGrantId: operation.id,
    targetEndAt: input.endAt,
    kwiga,
    localAutoClosed,
    telegramUnbanErrors,
  };
}
