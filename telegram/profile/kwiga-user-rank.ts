/**
 * Категорія клієнта за наявністю контакту KWIGA та кількістю релевантних рядків у
 * contact_product_access: kwiga_sync і manual_grant. Рядки payment_hook (оплата в Telegram)
 * не змінюють ранг — до pro лише через накопичення доступів з боку KWIGA (або manual_grant у дебагу).
 */
export type KwigaAudienceRank =
  | "no_kwiga_contact"
  | "prospectives"
  | "masters"
  | "pro";

export function kwigaAudienceRank(
  hasKwigaContact: boolean,
  lifetimeAccessRowCount: number,
): KwigaAudienceRank {
  if (!hasKwigaContact) {
    return "no_kwiga_contact";
  }
  if (lifetimeAccessRowCount <= 0) {
    return "prospectives";
  }
  if (lifetimeAccessRowCount >= 5) {
    return "pro";
  }
  return "masters";
}

/**
 * Порядок «кращий вище» для monotonic-збереження (TZ/rank-info.txt).
 * Узгоджено з `kwigaAudienceRank` (count → rank), без дублювання порогів.
 */
const RANK_MONOTONIC_ORDER: Record<KwigaAudienceRank, number> = {
  no_kwiga_contact: 0,
  prospectives: 1,
  masters: 2,
  pro: 3,
};

export function compareKwigaRanks(
  a: KwigaAudienceRank,
  b: KwigaAudienceRank,
): number {
  return RANK_MONOTONIC_ORDER[a] - RANK_MONOTONIC_ORDER[b];
}

/**
 * Мінімальна кількість релевантних рядків, яка відповідає збереженому рангу
 * (коли `kwiga_access_row_count` у БД NULL після міграцій).
 */
function minAccessRowCountForStoredRank(rank: KwigaAudienceRank): number {
  switch (rank) {
    case "pro":
      return 5;
    case "masters":
      return 1;
    case "prospectives":
    case "no_kwiga_contact":
    default:
      return 0;
  }
}

/**
 * Злиття «сирого» кандидата зі збереженим: підвищення — з кандидата;
 * пониження сирого — ігнор, лишаємо збережене (TZ/rank-info.txt).
 */
export function mergeMonotonicKwigaSnapshot(params: {
  storedRank: KwigaAudienceRank | null | undefined;
  storedCount: number | null | undefined;
  candidateRank: KwigaAudienceRank;
  candidateCount: number;
}): { rank: KwigaAudienceRank; accessRowCount: number } {
  const { storedRank, storedCount, candidateRank, candidateCount } = params;
  if (storedRank == null) {
    return { rank: candidateRank, accessRowCount: candidateCount };
  }
  if (compareKwigaRanks(candidateRank, storedRank) > 0) {
    return { rank: candidateRank, accessRowCount: candidateCount };
  }
  return {
    rank: storedRank,
    accessRowCount:
      storedCount != null
        ? storedCount
        : minAccessRowCountForStoredRank(storedRank),
  };
}

export function formatKwigaRankLine(rank: KwigaAudienceRank): string {
  switch (rank) {
    case "no_kwiga_contact":
      return "Категорія клієнта: немає відповідника в KWIGA";
    case "prospectives":
      return "Категорія клієнта: prospectives";
    case "masters":
      return "Категорія клієнта: masters";
    case "pro":
      return "Категорія клієнта: pro";
    default: {
      const _exhaustive: never = rank;
      return _exhaustive;
    }
  }
}
