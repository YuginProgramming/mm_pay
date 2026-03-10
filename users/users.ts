import "dotenv/config";

const BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";
const TOKEN = process.env.KWIGA_TOKEN;
const CABINET_HASH = process.env.KWIGA_CABINET_HASH;

if (!TOKEN || !CABINET_HASH) {
  console.error("Missing KWIGA_TOKEN or KWIGA_CABINET_HASH in .env");
  process.exit(1);
}

type ContactsResponse = {
  data: unknown[];
  meta?: {
    total?: number;
  };
};

export async function showTotalUsers(): Promise<void> {
  try {
    const token = TOKEN as string;
    const cabinetHash = CABINET_HASH as string;

    const response = await fetch(`${BASE_URL}/contacts`, {
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

    const data = (await response.json()) as ContactsResponse;
    const total = data.meta?.total ?? data.data.length;

    console.log("Total users (contacts) in Kwiga account:", total);
  } catch (error) {
    console.error("Failed to fetch total users:", error);
  }
}

// Optional: run directly if this file is executed with node
if (require.main === module) {
  void showTotalUsers();
}
