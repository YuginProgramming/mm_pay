import { SubscriptionAuto } from "../database/SubscriptionAuto";
import { SubscriptionPaymentOrder } from "../database/SubscriptionPaymentOrder";
import { getWayforpayMerchantPassword } from "./payment.config";
import { parentWayforpayOrderReference } from "./wayforpay-order-reference";
import {
  getWayforpayRegularPaymentStatus,
  removeWayforpayRegularPayment,
} from "./wayforpay-regular-api";

const LIVE_STATUSES = new Set(["active", "suspended"]);

export type RemoveLiveRegularsResult = {
  scanned: string[];
  live: string[];
  kept: string | null;
  removed: string[];
  errors: { ref: string; message: string }[];
};

type ParsedRegularApiError = {
  reasonCode?: number;
  status?: string;
  reason?: string;
  message: string;
};

function parseRegularApiError(err: unknown): ParsedRegularApiError {
  const message = err instanceof Error ? err.message : String(err);
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const data = JSON.parse(message.slice(jsonStart)) as {
        reasonCode?: number;
        status?: string;
        reason?: string;
      };
      return {
        reasonCode: Number(data.reasonCode),
        status: data.status,
        reason: data.reason,
        message,
      };
    } catch {
      return { message };
    }
  }
  return { message };
}

function isGoneStatus(parsed: ParsedRegularApiError): boolean {
  const status = (parsed.status ?? "").trim().toLowerCase();
  if (status === "removed") return true;
  return parsed.reasonCode === 4107 || parsed.reasonCode === 4102;
}

export function isLiveWayforpayRegularStatus(status: string | null | undefined): boolean {
  return LIVE_STATUSES.has((status ?? "").trim().toLowerCase());
}

export async function listKnownWayforpayRegularRefs(userId: string): Promise<string[]> {
  const [autos, orders] = await Promise.all([
    SubscriptionAuto.findAll({
      where: { userId },
      attributes: ["anchorOrderReference", "latestOrderReference"],
    }),
    SubscriptionPaymentOrder.findAll({
      where: { userId, status: "approved" },
      attributes: ["orderReference"],
    }),
  ]);

  const refs = new Set<string>();
  for (const row of autos) {
    const anchor = parentWayforpayOrderReference(row.anchorOrderReference ?? "");
    const latest = parentWayforpayOrderReference(row.latestOrderReference ?? "");
    if (anchor) refs.add(anchor);
    if (latest) refs.add(latest);
  }
  for (const row of orders) {
    const parent = parentWayforpayOrderReference(row.orderReference ?? "");
    if (parent) refs.add(parent);
  }
  return [...refs];
}

async function statusOf(ref: string): Promise<string> {
  try {
    const s = await getWayforpayRegularPaymentStatus(ref);
    return String(s.status ?? "").trim() || "unknown";
  } catch (err) {
    const parsed = parseRegularApiError(err);
    if (isGoneStatus(parsed)) {
      return "Removed";
    }
    throw err;
  }
}

async function removeIfLive(ref: string): Promise<"removed" | "gone" | "error"> {
  try {
    await removeWayforpayRegularPayment(ref);
    return "removed";
  } catch (err) {
    const parsed = parseRegularApiError(err);
    if (isGoneStatus(parsed)) {
      return "gone";
    }
    throw err;
  }
}

/**
 * At most one live WayForPay regular per user.
 * `keepOrderReference` — leave this parent Active; omit/null to REMOVE all live ones.
 */
export async function removeLiveWayforpayRegularsForUser(
  userId: string,
  options?: { keepOrderReference?: string | null },
): Promise<RemoveLiveRegularsResult> {
  const keep = parentWayforpayOrderReference(options?.keepOrderReference ?? "");
  const kept = keep || null;
  const empty: RemoveLiveRegularsResult = {
    scanned: [],
    live: [],
    kept,
    removed: [],
    errors: [],
  };

  if (!getWayforpayMerchantPassword()) {
    console.warn("[user-wayforpay-regulars] skip sweep: WFP_MERCHANT_PASSWORD not set");
    return empty;
  }

  const scanned = await listKnownWayforpayRegularRefs(userId);
  const result: RemoveLiveRegularsResult = {
    scanned,
    live: [],
    kept,
    removed: [],
    errors: [],
  };

  for (const ref of scanned) {
    let status: string;
    try {
      status = await statusOf(ref);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ ref, message: message.slice(0, 300) });
      continue;
    }
    if (!isLiveWayforpayRegularStatus(status)) {
      continue;
    }
    result.live.push(ref);
    if (kept && ref === kept) {
      continue;
    }
    try {
      const out = await removeIfLive(ref);
      if (out === "removed" || out === "gone") {
        result.removed.push(ref);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ ref, message: message.slice(0, 300) });
    }
  }

  if (result.removed.length > 0 || result.errors.length > 0) {
    console.log("[user-wayforpay-regulars] sweep", {
      userId,
      kept,
      scanned: result.scanned.length,
      live: result.live,
      removed: result.removed,
      errors: result.errors,
    });
  }

  return result;
}
