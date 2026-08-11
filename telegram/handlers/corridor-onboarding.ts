import { SUPPORT_EMAIL, SUPPORT_MAILTO_URL } from "../core/support";
import { telegramHtmlLink } from "../core/telegram-html";

/**
 * Онбординг після збереження email (див. plan.txt §3).
 * Містить HTML (`<a href=…>`) — надсилати з parse_mode: "HTML".
 */

export { SUPPORT_EMAIL } from "../core/support";

const CORRIDOR_FOOTER_UA =
  "Команди: /profile — статус і дати доступу, /payment — оплата, /unsubscribe — скасувати автопродовження, /change_email — змінити email.\n" +
  "Якщо після оплати нічого не змінилося за кілька хвилин — напишіть " +
  telegramHtmlLink(SUPPORT_MAILTO_URL, SUPPORT_EMAIL) +
  " (вкажіть час оплати).";

const PAYMENT_STEP_UA =
  "У меню оплати здійсніть оплату — після підтвердження банком відкриється доступ до професійної спільноти на 1 місяць.";

const RULES_STEP_UA =
  "Погодьтеся з правилами доступу до навчального проєкту.";

/**
 * @param rulesAlreadyAccepted — якщо true, крок про згоду з правилами не показується
 * (користувач вже погодився в боті).
 */
export function buildCorridorAfterEmailHintUa(
  rulesAlreadyAccepted: boolean,
): string {
  const steps = rulesAlreadyAccepted
    ? "Далі:\n" + "1. " + PAYMENT_STEP_UA + "\n\n"
    : "Далі:\n" +
      "1. " +
      RULES_STEP_UA +
      "\n" +
      "2. " +
      PAYMENT_STEP_UA +
      "\n\n";
  return steps + CORRIDOR_FOOTER_UA;
}
