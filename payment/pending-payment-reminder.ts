import {
  sendDuePendingReminderAlerts,
  sendDuePendingTimeoutAlerts,
} from "./payment-pending-notify";

function getTickMs(): number {
  const raw = Number(process.env.WAYFORPAY_PENDING_TICK_SECONDS ?? "");
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return seconds * 1000;
}

export function startPendingPaymentReminderLoop(): void {
  if (process.env.WAYFORPAY_PENDING_LOOP_ENABLED === "false") {
    console.log("[payment] pending reminder loop disabled by env");
    return;
  }

  const run = async (): Promise<void> => {
    try {
      await sendDuePendingReminderAlerts();
      await sendDuePendingTimeoutAlerts();
    } catch (err) {
      console.error("[payment] pending reminder loop error", err);
    }
  };

  const tickMs = getTickMs();
  void run();
  const timer = setInterval(() => {
    void run();
  }, tickMs);
  timer.unref();
  console.log("[payment] pending reminder loop started", { tickMs });
}
