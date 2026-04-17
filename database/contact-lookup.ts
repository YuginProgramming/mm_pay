import { Contact } from "./Contact";
import { normalizeEmail } from "./normalize-email";

/**
 * External id reserved for synthetic rows created by `debug/add-testuser.ts`.
 * Kwiga-synced contacts use real API ids (not this value).
 */
export const SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID = 9_000_002;

/** Email для masters debug (`debug/set-masters-rank-test-user.ts`). */
export const MASTERS_DEBUG_TEST_EMAIL = "vlad@example.com";

/** Синтетичний contact для `debug/set-masters-rank-test-user.ts` (email vlad@example.com). */
export const SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID = 9_000_005;

/** Раніший masters-seed (dudaryev@); лишається в exclude для findContactByEmailForBot. */
const SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID_LEGACY = 9_000_004;

const SYNTHETIC_CONTACT_EXTERNAL_IDS: ReadonlySet<number> = new Set([
  SYNTHETIC_DEBUG_CONTACT_EXTERNAL_ID,
  SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID_LEGACY,
  SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID,
]);

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
    (c) => !SYNTHETIC_CONTACT_EXTERNAL_IDS.has(c.externalId),
  );
  return nonSynthetic[0] ?? rows[0];
}

/**
 * Якщо це email masters debug (`MASTERS_DEBUG_TEST_EMAIL`) і в `contacts` ще немає рядка —
 * створює синтетичний контакт (той самий рядок, що й `debug/set-masters-rank-test-user.ts`).
 * Рядки доступу для рангу masters додає `ensureMastersDebugRankDataForUser` або `debug/set-masters-rank-test-user.ts`.
 */
export async function ensureMastersDebugSyntheticContactIfNeeded(
  emailRaw: string,
): Promise<void> {
  const normalized = normalizeEmail(emailRaw);
  if (!normalized || normalized !== normalizeEmail(MASTERS_DEBUG_TEST_EMAIL)) {
    return;
  }

  const existingByEmail = await Contact.findOne({ where: { email: normalized } });
  if (existingByEmail) {
    return;
  }

  const [contact] = await Contact.findOrCreate({
    where: { externalId: SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID },
    defaults: {
      externalId: SYNTHETIC_MASTERS_DEBUG_CONTACT_EXTERNAL_ID,
      email: normalized,
      firstName: "Masters",
      lastName: "Debug",
      phone: null,
      createdAtFromApi: new Date(),
      tags: [],
      offers: [],
      orders: [],
    },
  });

  if (contact.email !== normalized) {
    await contact.update({ email: normalized });
  }
}
