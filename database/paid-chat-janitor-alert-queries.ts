import { UniqueConstraintError } from "sequelize";
import { PaidChatJanitorAlertLog } from "./PaidChatJanitorAlertLog";

function isUniqueConstraintError(e: unknown): boolean {
  if (e instanceof UniqueConstraintError) {
    return true;
  }
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    (e as { name: string }).name === "SequelizeUniqueConstraintError"
  );
}

export async function tryInsertPaidChatJanitorAlertLog(
  telegramId: string,
  alertType: string,
  dedupeKey: string,
  meta?: { contactId?: number | null; grantEndAt?: Date | null },
): Promise<boolean> {
  try {
    await PaidChatJanitorAlertLog.create({
      telegramId,
      alertType,
      dedupeKey,
      contactId: meta?.contactId ?? null,
      grantEndAt: meta?.grantEndAt ?? null,
    });
    return true;
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return false;
    }
    throw e;
  }
}
