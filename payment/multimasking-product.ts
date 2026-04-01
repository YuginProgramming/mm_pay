/** Єдине джерело правди для бот-оплати MULTIMASKING (Telegram + payment сервер). */

export const MULTIMASKING_ACCESS_PRICE_UAH = 500;

/** Латиниця для рахунку WayForPay; без коми (для метаданих productName). */
export const MULTIMASKING_PRODUCT_NAME = "Multimasking Learning Project";

/**
 * Синтетичний external_product_id для рядків доступу з бота (не з Kwiga API).
 * Не повинен збігатися з реальними kwiga product id у вашій базі.
 */
export const BOT_PAYMENT_EXTERNAL_PRODUCT_ID = 9_000_000_001;
