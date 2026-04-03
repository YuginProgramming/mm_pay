/** Єдиний формат email у БД і в перевірках (унікальність без урахування регістру та пробілів). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
