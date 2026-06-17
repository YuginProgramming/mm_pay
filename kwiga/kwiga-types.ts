export type KwigaContact = { id: number; email: string };

export type KwigaSubscription = {
  id: number;
  offer_id?: number | null;
  order_id?: number | null;
  end_at?: string | null;
  is_active?: boolean;
};

export type KwigaProduct = {
  id: number;
  title: string;
  aggregated_subscription?: { end_at?: string | null; is_active?: boolean };
  subscriptions?: KwigaSubscription[];
};

export type ProlongKwigaProductActionKind =
  | "skip_valid"
  | "grant_offer"
  | "skip_no_offer"
  | "skip_no_products"
  | "error";

export type ProlongKwigaProductAction = {
  kind: ProlongKwigaProductActionKind;
  productId?: number;
  productTitle?: string;
  offerId?: number;
  targetEndAt?: string;
  currentEndAt?: string | null;
  note?: string;
  error?: string;
};

export type ProlongKwigaResultStatus =
  | "ok"
  | "skipped_all_valid"
  | "partial"
  | "failed"
  | "no_products";

export type ProlongKwigaResult = {
  status: ProlongKwigaResultStatus;
  actions: ProlongKwigaProductAction[];
  grantsApplied: number;
  /** True when Kwiga API was not called because this order was already processed. */
  idempotentSkip?: boolean;
};

export type ProlongKwigaInput = {
  email: string;
  kwigaContactId: number;
  localContactId: number | null;
  targetEndAt: Date;
  orderReference: string;
  fallbackDays?: number;
  /** When false, plan actions without POST /contacts/purchases. Default true. */
  apply?: boolean;
  /** When true, do not call syncKwigaContactProductsToDb after grants. */
  skipLocalSync?: boolean;
};
