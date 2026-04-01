import type { InlineKeyboardMarkup } from "@telegraf/types/markup";
import { Markup } from "telegraf";
import { buildRulesMiniKeyboard } from "./rules";
import { buildWayForPayInvoiceKeyboard } from "./wayforpay-invoice";

export const DEFER_EMAIL_CALLBACK = "payment_menu_defer_email";

function rowsOf(
  keyboard: { reply_markup?: InlineKeyboardMarkup },
): InlineKeyboardMarkup["inline_keyboard"] {
  return keyboard.reply_markup?.inline_keyboard ?? [];
}

/**
 * Клавіатура після /start, коли просимо email: ProChat + списки оплат + WayForPay + «без email».
 */
export function buildMergedStartEmailKeyboard(
  emailProChatExtra: {
    reply_markup?: InlineKeyboardMarkup;
  },
  rulesAccepted: boolean,
) {
  const paymentOrRules = rulesAccepted
    ? buildWayForPayInvoiceKeyboard()
    : buildRulesMiniKeyboard();
  const defer = Markup.inlineKeyboard([
    Markup.button.callback(
      "Пізніше вкажу email — тільки меню оплати",
      DEFER_EMAIL_CALLBACK,
    ),
  ]);

  return {
    reply_markup: {
      inline_keyboard: [
        ...rowsOf(emailProChatExtra),
        ...rowsOf(paymentOrRules),
        ...rowsOf(defer),
      ],
    },
  };
}

/** Меню оплати / перевірок без рядка ProChat (для /payment або після «без email»). */
export function buildStandalonePaymentMenuKeyboard(rulesAccepted: boolean) {
  if (!rulesAccepted) {
    return buildRulesMiniKeyboard();
  }
  const wfp = buildWayForPayInvoiceKeyboard();
  return {
    reply_markup: {
      inline_keyboard: [...rowsOf(wfp)],
    },
  };
}
