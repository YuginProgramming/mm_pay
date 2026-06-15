import { KWIGA_BASE_URL, requireKwigaCredentials } from "./kwiga-config";
import type { KwigaContact, KwigaProduct } from "./kwiga-types";

export function kwigaApiHeaders(): Record<string, string> {
  const { token, cabinetHash } = requireKwigaCredentials();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Token: token,
    "Cabinet-Hash": cabinetHash,
  };
}

export async function searchKwigaContactByEmail(
  email: string,
): Promise<KwigaContact | null> {
  const url = new URL(`${KWIGA_BASE_URL}/contacts`);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.set("filters[search]", email);

  const res = await fetch(url, { method: "GET", headers: kwigaApiHeaders() });
  if (!res.ok) {
    throw new Error(`GET /contacts ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: KwigaContact[] };
  const list = body.data ?? [];
  return list.find((c) => c.email.toLowerCase() === email) ?? list[0] ?? null;
}

export async function fetchKwigaContactProducts(
  kwigaContactId: number,
): Promise<KwigaProduct[]> {
  const res = await fetch(`${KWIGA_BASE_URL}/contacts/${kwigaContactId}/products`, {
    method: "GET",
    headers: kwigaApiHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `GET /contacts/${kwigaContactId}/products ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { data?: KwigaProduct[] };
  return body.data ?? [];
}

export type PostKwigaPurchaseParams = {
  email: string;
  offerId: number;
  comment: string;
};

export async function postKwigaPurchase(params: PostKwigaPurchaseParams): Promise<void> {
  const payload = {
    email: params.email,
    offer_id: params.offerId,
    is_paid: true,
    send_activation_email: false,
    send_product_access_email: false,
    send_payment_success_email: false,
    comment: params.comment,
  };
  const res = await fetch(`${KWIGA_BASE_URL}/contacts/purchases`, {
    method: "POST",
    headers: kwigaApiHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`POST /contacts/purchases ${res.status}: ${await res.text()}`);
  }
}
