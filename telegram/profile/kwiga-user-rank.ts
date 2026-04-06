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
