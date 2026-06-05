import { getPaidChatAccessDays } from "../../database/app-settings-queries";
import type {
  MultimaskingAccessSource,
  MultimaskingAccessStatus,
  MultimaskingAutoRenewSnapshot,
} from "../../payment/multimasking-access-status";
import { MONTHLY_SUBSCRIPTION_PLAN_CODE } from "../../payment/subscription-plan-codes";
import { SUPPORT_CONTACT_SUFFIX_PLAIN_UA } from "../core/support";
import type { KwigaAudienceRank } from "./kwiga-user-rank";
import { formatKwigaRankLine } from "./kwiga-user-rank";

export type MultimaskingAlreadyActiveContext = {
  grantEndAt: Date | null;
  accessSource?: MultimaskingAccessSource | null;
  autoRenew?: MultimaskingAutoRenewSnapshot | null;
};

export function toAlreadyActiveContext(
  access: MultimaskingAccessStatus,
): MultimaskingAlreadyActiveContext {
  return {
    grantEndAt: access.grantEndAt ?? access.userSubscriptionEndAt,
    accessSource: access.source,
    autoRenew: access.autoRenew,
  };
}

function formatGrantEndUaKyiv(end: Date): string {
  return end.toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Kyiv",
  });
}

function formatDateTimeUaKyiv(end: Date): string {
  return end.toLocaleString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

function buildPeriodLine(grantEndAt: Date | null): string {
  if (grantEndAt == null) {
    return "Дату закінчення поточного періоду див. у /profile.";
  }
  return `Поточний оплачений період до ${formatGrantEndUaKyiv(grantEndAt)}.`;
}

function isMonthlyAutoRenew(autoRenew: MultimaskingAutoRenewSnapshot | null | undefined): boolean {
  return autoRenew?.planCode === MONTHLY_SUBSCRIPTION_PLAN_CODE;
}

/**
 * Довге повідомлення: активний доступ — legacy, щомісячна підписка або ledger.
 */
export async function buildMultimaskingAlreadyActivePaymentMessageUa(
  ctx: MultimaskingAlreadyActiveContext,
): Promise<string> {
  const periodLine = buildPeriodLine(ctx.grantEndAt);

  if (ctx.accessSource === "subscription_auto" && ctx.autoRenew) {
    const monthly = isMonthlyAutoRenew(ctx.autoRenew);
    const title = monthly
      ? "У вас уже є активний доступ. Щомісячна підписка WayForPay у статусі Active."
      : "У вас уже є активний доступ. Автопродовження WayForPay (тест) у статусі Active.";
    const nextLine = ctx.autoRenew.nextChargeAt
      ? `Наступне списання: ${formatDateTimeUaKyiv(ctx.autoRenew.nextChargeAt)}.`
      : "Наступне списання — див. у /profile.";
    const renewHint = monthly
      ? "Повторна оплата за поточний період не потрібна — доступ продовжується автоматично щомісяця."
      : "Повторна оплата за поточний період не потрібна — списання за графіком WayForPay.";

    return `${title}\n\n${periodLine}\n${nextLine}\n\n${renewHint}\n\nДеталі: /profile.`;
  }

  if (ctx.accessSource === "user_subscription") {
    return (
      "У вас уже є активний запис підписки в боті (без нової оплати зараз).\n\n" +
      `${periodLine}\n\n` +
      "Повторна оплата за поточний період не потрібна.\n\n" +
      "Деталі: /profile."
    );
  }

  const days = await getPaidChatAccessDays();
  const daysLabel = formatAccessDaysUa(days);
  return (
    "У вас уже є активний доступ за разовою оплатою MULTIMASKING у цьому боті.\n\n" +
    `${periodLine}\n\n` +
    "Повторна оплата за поточний період не потрібна — ви вже маєте чинний доступ.\n\n" +
    `Після закінчення періоду можна оформити доступ через /payment (щомісячна підписка) або разову оплату — +${daysLabel} доступу згідно з налаштуваннями бота.`
  );
}

/** Короткий текст для спливаючого вікна при активному доступі. */
export function buildMultimaskingAlreadyActiveAlertUa(
  ctx: Pick<MultimaskingAlreadyActiveContext, "accessSource" | "autoRenew">,
): string {
  if (ctx.accessSource === "subscription_auto") {
    return isMonthlyAutoRenew(ctx.autoRenew)
      ? "Щомісячна підписка активна. Повторна оплата не потрібна — списання автоматичне."
      : "Автопродовження активне. Повторна оплата за період не потрібна.";
  }
  if (ctx.accessSource === "user_subscription") {
    return "Підписка в боті активна. Повторна оплата зараз не потрібна.";
  }
  return CALLBACK_ALERT_ALREADY_ACTIVE_MULTIMASKING_UA;
}

/** Legacy one-shot (без розрізнення джерела). */
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
