import { Contact } from "./Contact";
import { normalizeEmail } from "./normalize-email";

/**
 * External id reserved for synthetic rows created by `debug/add-testuser.ts`.
 * Kwiga-synced contacts use real API ids (not this value).
 */
export const SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID = 9_000_002;

/**
 * Resolve `contacts` row for bot flows when the same email can exist twice
 * (debug seed + KWIGA sync). Prefer the real KWIGA row so access counts match
 * what users see in /profile.
 */
export async function findContactByEmailForBot(
  email: string,
): Promise<Contact | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }

  const rows = await Contact.findAll({
    where: { email: normalized },
    order: [["id", "ASC"]],
  });
  if (rows.length === 0) {
    return null;
  }

  const nonSynthetic = rows.filter(
    (c) => c.externalId !== SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID,
  );
  return nonSynthetic[0] ?? rows[0];
}
