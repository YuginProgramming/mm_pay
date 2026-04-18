import type { InlineKeyboardMarkup } from "@telegraf/types/markup";
import { buildRulesMiniKeyboard } from "../handlers/rules";
import { buildWayForPayInvoiceKeyboard } from "./wayforpay-invoice";

/** Лишається для callback на старих повідомленнях (кнопку з меню прибрано). */
export const DEFER_EMAIL_CALLBACK = "payment_menu_defer_email";

function rowsOf(
  keyboard: { reply_markup?: InlineKeyboardMarkup },
): InlineKeyboardMarkup["inline_keyboard"] {
  return keyboard.reply_markup?.inline_keyboard ?? [];
}

/**
 * Клавіатура після /start, коли просимо email: спочатку правила / оплата, внизу ProChat.
 * Порядок без згоди (зверху вниз): Відкрити правила → Погоджуюсь → Отримати доступ в ProChat.
 */
export async function buildMergedStartEmailKeyboard(
  emailProChatExtra: {
    reply_markup?: InlineKeyboardMarkup;
  },
  rulesAccepted: boolean,
  telegramId: string,
) {
  const paymentOrRules = rulesAccepted
    ? await buildWayForPayInvoiceKeyboard(telegramId)
    : buildRulesMiniKeyboard();

  return {
    reply_markup: {
      inline_keyboard: [
        ...rowsOf(paymentOrRules),
        ...rowsOf(emailProChatExtra),
      ],
    },
  };
}

/** Меню оплати без рядка ProChat (для /payment або після «без email»). */
export async function buildStandalonePaymentMenuKeyboard(
  rulesAccepted: boolean,
  telegramId: string,
) {
  if (!rulesAccepted) {
    return buildRulesMiniKeyboard();
  }
  const wfp = await buildWayForPayInvoiceKeyboard(telegramId);
  return {
    reply_markup: {
      inline_keyboard: [...rowsOf(wfp)],
    },
  };
}
