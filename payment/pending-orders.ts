type PendingMeta = { chatId: string; courseName: string };

const store = new Map<string, PendingMeta>();

export function putPendingOrder(orderReference: string, meta: PendingMeta): void {
  store.set(orderReference, meta);
}

/** Read without removing (intermediate statuses may POST several times). */
export function peekPendingOrder(orderReference: string): PendingMeta | undefined {
  return store.get(orderReference);
}

export function takePendingOrder(orderReference: string): PendingMeta | undefined {
  const meta = store.get(orderReference);
  if (!meta) return undefined;
  store.delete(orderReference);
  return meta;
}
