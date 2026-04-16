import { getPaidChatAccessDays } from "../../database/app-settings-queries";
import type { ActiveMultimaskingPaymentSummary } from "../paid-chat-janitor/paid-chat-allowlist";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import type { KwigaAudienceRank } from "./kwiga-user-rank";
import { formatKwigaRankLine } from "./kwiga-user-rank";

function formatGrantEndUaKyiv(end: Date): string {
  return end.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Kyiv",
  });
}

function formatAccessDaysUa(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дні`;
  return `${n} днів`;
}

/**
 * Користувач з активним payment_hook MULTIMASKING — повторна оплата за поточний період не пропонується.
 */
export async function buildMultimaskingAlreadyActivePaymentMessageUa(
  summary: Extract<ActiveMultimaskingPaymentSummary, { active: true }>,
): Promise<string> {
  const days = await getPaidChatAccessDays();
  const daysLabel = formatAccessDaysUa(days);
  const periodLine =
    summary.grantEndAt == null
      ? "Дату закінчення поточного періоду див. у /profile."
      : `Поточний оплачений період до ${formatGrantEndUaKyiv(summary.grantEndAt)}.`;
  return (
    "У вас уже є активний доступ за оплатою MULTIMASKING у цьому боті.\n\n" +
    `${periodLine}\n\n` +
    "Повторна оплата за поточний період не потрібна — ви вже маєте чинний доступ.\n\n" +
    `Коли поточний період закінчиться, зможете оформити продовження через /payment: нова оплата додасть ${daysLabel} доступу до професійних спільнот (згідно з налаштуваннями бота).`
  );
}

/** Короткий текст для спливаючого вікна, якщо натиснули «Оплатити» при активному доступі. */
export const CALLBACK_ALERT_ALREADY_ACTIVE_MULTIMASKING_UA =
  "Доступ за оплатою вже активний. Продовження — після закінчення періоду; нова оплата додасть дні доступу.";

/** Чи дозволена оплата за доступ до закритих чатів (Masters / Chat PRO); див. TZ/user-control-crawler.txt. */
export function isKwigaRankEligibleForPaidChatPurchase(
  rank: KwigaAudienceRank,
): boolean {
  return rank === "masters" || rank === "pro";
}

/** Повідомлення перед створенням інвойсу (блок у боті). */
export function multimaskingIneligibleUserMessageUa(
  rank: KwigaAudienceRank,
): string {
  return (
    "Оплата цього продукту доступна лише учасникам з категоріями «masters» або «pro» " +
    "за даними KWIGA.\n\n" +
    `${formatKwigaRankLine(rank)}\n\n` +
    "Відкрийте /profile і перевірте email. Якщо статус має оновитися — зачекайте на синхронізацію з KWIGA.\n\n" +
    SUPPORT_CONTACT_SUFFIX_PLAIN_UA
  );
}

/** Після успішної оплати, якщо ранг не дозволяв доступ (захист на webhook). */
export function multimaskingPaidButRankIneligibleUa(
  orderReference: string,
  rank: KwigaAudienceRank,
): string {
  return (
    "Оплату в WayForPay зафіксовано, але автоматично зарахувати доступ неможливо: потрібен статус «masters» або «pro».\n\n" +
    `${formatKwigaRankLine(rank)}\n\n` +
    "Зверніться до підтримки з цим номером замовлення — узгодять повернення коштів або зарахування вручну, якщо це доречно:\n" +
    orderReference +
    "\n\n" +
    SUPPORT_CONTACT_SUFFIX_PLAIN_UA
  );
}
