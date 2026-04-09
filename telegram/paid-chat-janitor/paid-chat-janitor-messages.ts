/** UA тексти приватних повідомлень для paid-chat janitor (TZ/user-control-crawler.txt §7.6). */

export const SUPPORT_TELEGRAM_URL_PM = "https://t.me/YevhenDudar";

function fmtUkrHoursMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) {
    return `${m} хв`;
  }
  if (m === 0) {
    return `${h} год`;
  }
  return `${h} год ${m} хв`;
}

export function buildExpiryWarn24hUa(args: {
  chatLabels: string;
  remainingMs: number;
  grantEndsAtIso: string;
}): string {
  const left = fmtUkrHoursMinutes(args.remainingMs);
  return (
    "Нагадування щодо платних груп MASTERS / Chat PRO.\n\n" +
    `Доступ за оплатою в боті закріплений за вашим профілем KWIGA та має кінець періоду. ` +
    `Залишилось приблизно ${left} (до ${args.grantEndsAtIso} за часом системи).\n\n` +
    `Після закінчення терміну ви будете вилучені з: ${args.chatLabels}. ` +
    `Щоб продовжити доступ — відкрийте /payment та оплатіть знову, перевірте email у /change_email або статус у /profile.\n\n` +
    `Якщо щось працює не так — напишіть у підтримку: ${SUPPORT_TELEGRAM_URL_PM}. ` +
    `Відкрита спільнота Community залишається за правилами публічного каналу.`
  );
}

export function buildExpiryWarnFinalUa(args: {
  chatLabels: string;
  remainingMs: number;
  grantEndsAtIso: string;
}): string {
  const left = fmtUkrHoursMinutes(args.remainingMs);
  return (
    "Останнє нагадування перед вилученням з платних груп.\n\n" +
    `До кінця оплаченого періоду лишилось близько ${left} (орієнтир ${args.grantEndsAtIso}). ` +
    `Незабаром ви будете вилучені з: ${args.chatLabels}.\n\n` +
    `За потреби продовжіть доступ через /payment, перевірте /profile. Підтримка: ${SUPPORT_TELEGRAM_URL_PM}.`
  );
}

export function buildExpiryWarnTest1mUa(args: {
  chatLabels: string;
  grantEndsAtIso: string;
}): string {
  return (
    "Тестовий режим короткого доступу.\n\n" +
    `Приблизно за хвилину закінчиться тестовий термін; вас можуть вилучити з: ${args.chatLabels}. ` +
    `Орієнтир часу кінця: ${args.grantEndsAtIso}.\n\n` +
    `/profile — статус, /payment — оплата. Підтримка: ${SUPPORT_TELEGRAM_URL_PM}.`
  );
}

export type PaidChatPostKickReason =
  | "no_active_access"
  | "rank_ineligible"
  | "intruder";

export function buildPostKickUa(args: {
  chatTitle: string;
  reason: PaidChatPostKickReason;
}): string {
  const base =
    `Вас вилучено з групи «${args.chatTitle}».\n\n`;
  if (args.reason === "intruder") {
    return (
      base +
      "У закритій групі можуть перебувати лише учасники з підтвердженим доступом у нашій системі " +
      "(оплата MULTIMASKING у цьому боті та відповідний запис KWIGA за email).\n\n" +
      "Якщо це ваш акаунт — оформіть доступ через /payment, перевірте email у /profile або /change_email. " +
      "Помилка або запитання — " +
      SUPPORT_TELEGRAM_URL_PM +
      ".\nВідкритий канал Community доступний окремо за його правилами."
    );
  }
  if (args.reason === "rank_ineligible") {
    return (
      base +
      "За вашим поточним рангом KWIGA умови цієї групи не виконуються (доступ у боті може бути ще активний, але чат — лише для відповідної категорії).\n\n" +
      "Перевірте /profile, за потреби зверніться до KWIGA або підтримки: " +
      SUPPORT_TELEGRAM_URL_PM +
      ".\nКоманди: /payment, /change_email."
    );
  }
  return (
    base +
    "Доступ за оплатою в боті зараз не активний або термін сплив.\n\n" +
    "Щоб повернутися після оплати: /payment, статус і дати — /profile. " +
    "Якщо це помилка — напишіть у підтримку: " +
    SUPPORT_TELEGRAM_URL_PM +
    ".\nВідкрита спільнота Community доступна окремо за правилами каналу."
  );
}
