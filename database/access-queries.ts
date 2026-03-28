import { QueryTypes } from "sequelize";
import { sequelize } from "./db";

/**
 * SQL predicate: row counts as “effective” access for your business rules.
 * Adjust here if Kwiga semantics change (e.g. rely only on is_active).
 */
export const EFFECTIVE_ACCESS_SQL = `
  a.revoked_at IS NULL
  AND a.is_active = true
  AND (a.end_at IS NULL OR a.end_at > NOW())
`;

export type ContactBriefRow = {
  id: number;
  external_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export type ContactAccessRow = ContactBriefRow & {
  active_access_count: number;
};

/** Contacts with strictly more than `min` effective product accesses (default 5). */
export async function findContactsWithAccessCountGreaterThan(
  min: number = 5,
): Promise<ContactAccessRow[]> {
  return sequelize.query<ContactAccessRow>(
    `
    SELECT c.id, c.external_id, c.email, c.first_name, c.last_name,
           COUNT(a.id)::int AS active_access_count
    FROM contacts c
    INNER JOIN contact_product_access a ON a.contact_id = c.id
    WHERE ${EFFECTIVE_ACCESS_SQL.replace(/\n/g, " ")}
    GROUP BY c.id, c.external_id, c.email, c.first_name, c.last_name
    HAVING COUNT(a.id) > :min
    ORDER BY COUNT(a.id) DESC
    `,
    { replacements: { min }, type: QueryTypes.SELECT },
  );
}

/** Contacts that have no effective access row (0 accesses under the same rules). */
export async function findContactsWithZeroEffectiveAccess(): Promise<ContactBriefRow[]> {
  return sequelize.query<ContactBriefRow>(
    `
    SELECT c.id, c.external_id, c.email, c.first_name, c.last_name
    FROM contacts c
    WHERE NOT EXISTS (
      SELECT 1 FROM contact_product_access a
      WHERE a.contact_id = c.id
        AND (${EFFECTIVE_ACCESS_SQL.replace(/\n/g, " ")})
    )
    ORDER BY c.email
    `,
    { type: QueryTypes.SELECT },
  );
}
