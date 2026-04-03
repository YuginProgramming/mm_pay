/**
 * Назва продукту та технічні id для бот-оплати MULTIMASKING.
 * Ціна в грн: таблиця app_settings, ключ multimasking_course_price_uah → getMultimaskingCoursePriceUah().
 */

/** Латиниця для рахунку WayForPay; без коми (для метаданих productName). */
export const MULTIMASKING_PRODUCT_NAME = "Multimasking Learning Project";

/**
 * Синтетичний external_product_id для рядків доступу з бота (не з Kwiga API).
 * Не повинен збігатися з реальними kwiga product id у вашій базі.
 */
/** У межах PostgreSQL INTEGER (max ~2.1e9); не перетинатися з реальними Kwiga product id. */
export const BOT_PAYMENT_EXTERNAL_PRODUCT_ID = 9_001_337;
