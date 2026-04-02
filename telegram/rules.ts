import { Context, Markup, Telegraf } from "telegraf";
import { RulesConsent } from "../database/RulesConsent";
import { TelegramUser } from "../database/TelegramUser";
import { sparkleLabel } from "./sparkle-label";

/** Full rules (Telegraph). */
export const MULTIMASKING_RULES_URL =
  "https://telegra.ph/Pravila-dostupu-do-navchalnogo-proyektu-MULTIMASKING-04-01";

/**
 * Bump when the Telegraph page changes so users re-confirm.
 * Must stay within Telegram callback_data limit (64 bytes).
 */
export const MULTIMASKING_RULES_VERSION = "mm-rules-2026-04-01";

export const RULES_ACCEPT_CALLBACK = `rules_accept:${MULTIMASKING_RULES_VERSION}`;

export async function hasAcceptedCurrentRules(
  telegramId: string,
): Promise<boolean> {
  const row = await RulesConsent.findOne({
    where: {
      telegramId,
      rulesVersion: MULTIMASKING_RULES_VERSION,
    },
  });
  return row !== null;
}

/** Inline actions when full rules text is shown separately or under email menu. */
export function buildRulesMiniKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url(sparkleLabel("Відкрити правила"), MULTIMASKING_RULES_URL)],
    [Markup.button.callback(sparkleLabel("Погоджуюсь"), RULES_ACCEPT_CALLBACK)],
  ]);
}

/** Short copy + link; «Погоджуюсь» matches the Telegraph page. */
export function buildRulesMessageAndKeyboard() {
  const text =
    "Перед оплатою та доступом ознайомтеся з правилами навчального проєкту MULTIMASKING.\n\n" +
    `Повний текст: ${MULTIMASKING_RULES_URL}\n\n` +
    "Натискаючи «Погоджуюсь», ви підтверджуєте, що прочитали правила та згодні їх дотримуватися.";

  return { text, extra: buildRulesMiniKeyboard() };
}

export function registerRulesAcceptHandler(bot: Telegraf<Context>): void {
  bot.action(RULES_ACCEPT_CALLBACK, async (ctx) => {
    if (!ctx.from) {
      return;
    }
    const telegramId = String(ctx.from.id);

    try {
      const user = await TelegramUser.findOne({ where: { telegramId } });
      if (!user) {
        await ctx.answerCbQuery("Спочатку натисніть /start.");
        await ctx.reply("Профіль не знайдено. Натисніть /start.");
        return;
      }

      try {
        await RulesConsent.create({
          telegramId,
          rulesVersion: MULTIMASKING_RULES_VERSION,
          rulesUrl: MULTIMASKING_RULES_URL,
          acceptedAt: new Date(),
        });
      } catch (err: unknown) {
        const name =
          err && typeof err === "object" && "name" in err
            ? String((err as { name: string }).name)
            : "";
        if (name !== "SequelizeUniqueConstraintError") {
          throw err;
        }
      }

      await ctx.answerCbQuery("Дякуємо!");

      const { buildStandalonePaymentMenuKeyboard } = await import(
        "./payment-menu-keyboards"
      );
      await ctx.reply(
        "Умови прийнято. Нижче — меню оплати:",
        await buildStandalonePaymentMenuKeyboard(true),
      );
    } catch (err) {
      console.error("rules accept:", err);
      try {
        await ctx.answerCbQuery("Помилка збереження.");
      } catch {
        /* already answered or expired */
      }
      await ctx.reply("Не вдалося зберечи згоду. Спробуйте /start.");
    }
  });
}
