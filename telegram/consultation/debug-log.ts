type DebugPayload = Record<string, unknown>;

export function consultationDebug(event: string, payload: DebugPayload = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      stream: "consultation-debug",
      event,
      ...payload,
    }),
  );
}
