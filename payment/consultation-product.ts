/**
 * Consultation one-time products (WayForPay metadata-safe names, no comma).
 */
export const CONSULTATION_CLIENT_PRODUCT_CODE = "consultation_client_one_time";
export const CONSULTATION_MASTER_PRODUCT_CODE = "consultation_master_one_time";

export type ConsultationProductCode =
  | typeof CONSULTATION_CLIENT_PRODUCT_CODE
  | typeof CONSULTATION_MASTER_PRODUCT_CODE;

export function isConsultationProductCode(
  value: string,
): value is ConsultationProductCode {
  return (
    value === CONSULTATION_CLIENT_PRODUCT_CODE ||
    value === CONSULTATION_MASTER_PRODUCT_CODE
  );
}
