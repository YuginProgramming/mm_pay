import paymentConfig, { getWayforpayMerchantPassword } from "./payment.config";

const WAYFORPAY_REGULAR_API_URL = "https://api.wayforpay.com/regularApi";
const REGULAR_API_SUCCESS_REASON_CODE = 4100;

export type WayforpayRegularRequestType = "STATUS" | "REMOVE" | "SUSPEND" | "RESUME";

type RegularApiBaseBody = {
  requestType: WayforpayRegularRequestType;
  merchantAccount: string;
  merchantPassword: string;
  orderReference: string;
};

export type WayforpayRegularStatusResponse = {
  reasonCode: number;
  reason: string;
  orderReference?: string;
  mode?: string;
  status?: string;
  amount?: number;
  currency?: string;
  nextPaymentDate?: string | null;
  lastPayedDate?: string | null;
  lastPayedStatus?: string | null;
  email?: string;
  card?: string;
  dateBegin?: number;
  dateEnd?: number;
};

export type WayforpayRegularSimpleResponse = {
  reasonCode: number;
  reason: string;
};

function requireMerchantPassword(): string {
  const password = getWayforpayMerchantPassword();
  if (!password) {
    throw new Error(
      "[wayforpay] WFP_MERCHANT_PASSWORD is not set (cabinet MERCHANT PASSWORD for regularApi)",
    );
  }
  return password;
}

async function postRegularApi<T extends Record<string, unknown>>(
  body: RegularApiBaseBody,
): Promise<T> {
  const res = await fetch(WAYFORPAY_REGULAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let data: T;
  try {
    data = JSON.parse(rawText) as T;
  } catch {
    throw new Error(
      `[wayforpay] regularApi invalid JSON (HTTP ${res.status}): ${rawText.slice(0, 500)}`,
    );
  }

  const reasonCode = Number((data as unknown as WayforpayRegularSimpleResponse).reasonCode);
  if (reasonCode !== REGULAR_API_SUCCESS_REASON_CODE) {
    throw new Error(
      `[wayforpay] regularApi ${body.requestType} failed: ${JSON.stringify(data)}`,
    );
  }

  return data;
}

export async function getWayforpayRegularPaymentStatus(
  orderReference: string,
): Promise<WayforpayRegularStatusResponse> {
  return postRegularApi<WayforpayRegularStatusResponse>({
    requestType: "STATUS",
    merchantAccount: paymentConfig.merchantAccount,
    merchantPassword: requireMerchantPassword(),
    orderReference,
  });
}

export async function removeWayforpayRegularPayment(
  orderReference: string,
): Promise<WayforpayRegularSimpleResponse> {
  return postRegularApi<WayforpayRegularSimpleResponse>({
    requestType: "REMOVE",
    merchantAccount: paymentConfig.merchantAccount,
    merchantPassword: requireMerchantPassword(),
    orderReference,
  });
}
