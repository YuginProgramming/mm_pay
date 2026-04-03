import { normalizeEmail } from "./normalize-email";
import { TelegramUser } from "./TelegramUser";

/**
 * Інший користувач бота (інший telegram id), у якого уже збережено цей email.
 */
export async function findConflictingTelegramUserForEmail(
  emailRaw: string,
  currentTelegramId: string,
): Promise<TelegramUser | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    return null;
  }

  const row = await TelegramUser.findOne({
    where: { email },
  });
  if (!row || String(row.telegramId) === String(currentTelegramId)) {
    return null;
  }
  return row;
}
