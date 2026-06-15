export const KWIGA_BASE_URL = process.env.KWIGA_BASE_URL ?? "https://api.kwiga.com";

export const KWIGA_PURCHASE_DELAY_MS = Math.max(
  0,
  parseInt(process.env.KWIGA_PURCHASE_DELAY_MS ?? "2500", 10) || 2500,
);

export const KWIGA_RETRY_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.KWIGA_RETRY_MAX_ATTEMPTS ?? "4", 10) || 4,
);

export const KWIGA_RETRY_BASE_DELAY_MS = Math.max(
  100,
  parseInt(process.env.KWIGA_RETRY_BASE_DELAY_MS ?? "2000", 10) || 2000,
);

export const DEFAULT_KWIGA_PROLONG_FALLBACK_DAYS = 30;

export function requireKwigaCredentials(): { token: string; cabinetHash: string } {
  const token = process.env.KWIGA_TOKEN?.trim();
  const cabinetHash = process.env.KWIGA_CABINET_HASH?.trim();
  if (!token || !cabinetHash) {
    throw new Error("Missing KWIGA_TOKEN or KWIGA_CABINET_HASH in .env");
  }
  return { token, cabinetHash };
}
