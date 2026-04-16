import {
  SUPPORT_TELEGRAM_HANDLE,
  SUPPORT_TELEGRAM_URL,
} from "../core/support";
import { telegramHtmlLink } from "../core/telegram-html";

/**
 * Короткий онбординг для учасників з Corridor (див. plan.txt §3).
 * Підставляється після привітання для нових користувачів /start.
 * Містить HTML (`<a href=…>`) — надсилати з parse_mode: "HTML".
 */

export { SUPPORT_TELEGRAM_URL } from "../core/support";

export function buildCorridorStartHintUa(): string {
  return (
    "\n\nДалі:\n" +
    "1. Введіть email (той самий, що прив’язаний до Kwiga).\n" +
    "2. Погодьтеся з правилами доступу до навчального проєкту.\n" +
    "3. У меню оплати здійсніть оплату — після підтвердження банком відкриється доступ до професійної спільноти на 1 місяць.\n\n" +
    "Команди: /profile — статус і дати доступу, /payment — оплата, /change_email — змінити email.\n" +
    "Якщо після оплати нічого не змінилося за кілька хвилин — напишіть " +
    telegramHtmlLink(SUPPORT_TELEGRAM_URL, SUPPORT_TELEGRAM_HANDLE) +
    " (вкажіть час оплати)."
  );
}
