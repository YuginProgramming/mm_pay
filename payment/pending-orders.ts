import { PendingWayforpayOrder } from "../database/PendingWayforpayOrder";

export type PendingMeta = { chatId: string; courseName: string };

export async function putPendingOrder(
  orderReference: string,
  meta: PendingMeta,
): Promise<void> {
  await PendingWayforpayOrder.create({
    orderReference,
    chatId: meta.chatId,
    courseName: meta.courseName,
  });
}

/** Read without removing (intermediate statuses may POST several times). */
export async function peekPendingOrder(
  orderReference: string,
): Promise<PendingMeta | undefined> {
  const row = await PendingWayforpayOrder.findByPk(orderReference);
  if (!row) {
    return undefined;
  }
  return { chatId: row.chatId, courseName: row.courseName };
}

export async function takePendingOrder(
  orderReference: string,
): Promise<PendingMeta | undefined> {
  const row = await PendingWayforpayOrder.findByPk(orderReference);
  if (!row) {
    return undefined;
  }
  const meta = { chatId: row.chatId, courseName: row.courseName };
  await row.destroy();
  return meta;
}
