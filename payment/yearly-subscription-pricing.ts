import { getMultimaskingCoursePriceUah } from "./multimasking-price";
import { getYearlySubscriptionPriceUah } from "./yearly-subscription-settings";

export type YearlySubscriptionPricing = {
  monthlyPriceUah: number;
  yearlyPriceUah: number;
  fullYearPriceUah: number;
  discountPercent: number;
};

/** Відображення знижки річного тарифу відносно 12× місячної ціни (лише % для UI). */
export async function getYearlySubscriptionPricing(): Promise<YearlySubscriptionPricing> {
  const [monthlyPriceUah, yearlyPriceUah] = await Promise.all([
    getMultimaskingCoursePriceUah(),
    getYearlySubscriptionPriceUah(),
  ]);
  const fullYearPriceUah = monthlyPriceUah * 12;
  const discountPercent =
    fullYearPriceUah > 0
      ? Math.max(0, Math.round((1 - yearlyPriceUah / fullYearPriceUah) * 100))
      : 0;

  return {
    monthlyPriceUah,
    yearlyPriceUah,
    fullYearPriceUah,
    discountPercent,
  };
}
