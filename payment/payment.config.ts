type PaymentConfig = {
  merchantAccount: string;
  merchantSecret: string;
  merchantDomainName: string;
  serviceUrl: string;
  currency: "UAH";
  isProduction: boolean;
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`[payment config] Missing required env var: ${name}`);
  }
  return value.trim();
};

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const paymentConfig: PaymentConfig = {
  merchantAccount: requireEnv("WFP_MERCHANT_ACCOUNT"),
  merchantSecret: requireEnv("WFP_MERCHANT_SECRET"),
  merchantDomainName: requireEnv("WFP_MERCHANT_DOMAIN_NAME"),
  serviceUrl: requireEnv("WFP_SERVICE_URL"),
  currency: "UAH",
  isProduction: toBool(
    process.env.NODE_ENV === "production" ? "true" : process.env.WFP_IS_PRODUCTION,
    false,
  ),
};

export type { PaymentConfig };
export default paymentConfig;
