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
 * Клавіатура після /start, коли просимо email: ProChat + правила / WayForPay.
 */
export async function buildMergedStartEmailKeyboard(
  emailProChatExtra: {
    reply_markup?: InlineKeyboardMarkup;
  },
  rulesAccepted: boolean,
) {
  const paymentOrRules = rulesAccepted
    ? await buildWayForPayInvoiceKeyboard()
    : buildRulesMiniKeyboard();

  return {
    reply_markup: {
      inline_keyboard: [
        ...rowsOf(emailProChatExtra),
        ...rowsOf(paymentOrRules),
      ],
    },
  };
}

/** Меню оплати без рядка ProChat (для /payment або після «без email»). */
export async function buildStandalonePaymentMenuKeyboard(rulesAccepted: boolean) {
  if (!rulesAccepted) {
    return buildRulesMiniKeyboard();
  }
  const wfp = await buildWayForPayInvoiceKeyboard();
  return {
    reply_markup: {
      inline_keyboard: [...rowsOf(wfp)],
    },
  };
}
