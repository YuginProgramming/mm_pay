import type { KwigaAudienceRank } from "./kwiga-user-rank";
import { formatKwigaRankLine } from "./kwiga-user-rank";

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
    "Відкрийте /profile і перевірте email. Якщо статус має оновитися — зачекайте на синхронізацію з KWIGA " +
    "або зверніться до підтримки."
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
    orderReference
  );
}
