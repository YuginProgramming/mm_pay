import "dotenv/config";

const DEFAULT_EMAIL = "fesbis@ukr.net";

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const TOKEN = process.env.KWIGA_TOKEN;
const CABINET_HASH = process.env.KWIGA_CABINET_HASH;

if (!TOKEN || !CABINET_HASH) {
  console.error("Missing KWIGA_TOKEN or KWIGA_CABINET_HASH in .env");
  process.exit(1);
}

type ContactTag = {
  id: number;
  name: string;
};

type ContactOffer = {
  id: number;
  unique_offer_code: string;
  title: string;
};

type ContactPayment = {
  id: number;
  status?: number;
  status_title?: string;
  price_info?: {
    amount?: number;
    currency?: {
      code?: string;
      html_code?: string;
      html_letter_code?: string;
    };
  };
};

type ContactOrder = {
  id: number;
  paid_status?: string;
  paid_status_title?: string;
  cost_info?: {
    amount?: number;
    currency?: {
      code?: string;
      html_code?: string;
      html_letter_code?: string;
    };
  };
  payments?: ContactPayment[];
};

type Contact = {
  id: number;
  created_at?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: ContactTag[];
  offers?: ContactOffer[];
  orders?: ContactOrder[];
};

type ContactsListResponse = {
  data: Contact[];
  meta?: {
    total?: number;
  };
};
export async function showUserDetailsByEmail(
  email: string = DEFAULT_EMAIL,
): Promise<void> {
  try {
    const token = TOKEN as string;
    const cabinetHash = CABINET_HASH as string;
    const url = new URL(`${BASE_URL}/contacts`);
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", "15");
    url.searchParams.set("filters[search]", email);
    url.searchParams.set("with_orders", "1");
    url.searchParams.set("with_certificates", "1");
    url.searchParams.set("with_offers", "1");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Token: token,
        "Cabinet-Hash": cabinetHash,
      },
    });
    console.log("Status:", response.status, response.statusText);
    if (!response.ok) {
      const text = await response.text();
      console.error("Error body:", text);
      return;
    }
    const body = (await response.json()) as ContactsListResponse;
    if (!body.data || body.data.length === 0) {
      console.log(`No contact found for email: ${email}`);
      return;
    }
    const contact = body.data[0];
    const fullName =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
    console.log("Contact details:");
    console.log({
      id: contact.id,
      email: contact.email,
      name: fullName,
      phone: contact.phone ?? null,
      created_at: contact.created_at ?? null,
      tags: (contact.tags ?? []).map((t) => t.name),
      offers: (contact.offers ?? []).map((o) => ({
        id: o.id,
        code: o.unique_offer_code,
        title: o.title,
      })),
      orders: (contact.orders ?? []).map((order) => ({
        id: order.id,
        paid_status: order.paid_status ?? null,
        paid_status_title: order.paid_status_title ?? null,
        amount: order.cost_info?.amount ?? null,
        currency: order.cost_info?.currency?.code ?? null,
        payments: (order.payments ?? []).map((payment) => ({
          id: payment.id,
          status: payment.status ?? null,
          status_title: payment.status_title ?? null,
          amount: payment.price_info?.amount ?? null,
          currency: payment.price_info?.currency?.code ?? null,
        })),
      })),
      total_matching_contacts: body.meta?.total ?? body.data.length,
    });
  } catch (error) {
    console.error("Failed to fetch user details:", error);
  }
}
if (require.main === module) {
  void showUserDetailsByEmail();
}