// telegram/payment-check.ts
import { Context, Markup, Telegraf } from "telegraf";
import { Contact } from "../database/contact";

const PAID_USERS_BUTTON_CALLBACK = "show_paid_users_button";
const NOT_PAID_USERS_BUTTON_CALLBACK = "show_not_paid_users_button";

/**
 * Builds an inline keyboard with:
 *  - "покажи користувачів що проплатили"
 *  - "покажи користувачів що не платили"
 *
 * You can attach this keyboard to any message, for example in /start.
 */
export function buildPaymentCheckKeyboard() {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "покажи користувачів що проплатили",
        PAID_USERS_BUTTON_CALLBACK,
      ),
    ],
    [
      Markup.button.callback(
        "покажи користувачів що не платили",
        NOT_PAID_USERS_BUTTON_CALLBACK,
      ),
    ],
  ]);

  return keyboard;
}

/**
 * Registers handlers for:
 *  - "покажи користувачів що проплатили"
 *  - "покажи користувачів що не платили"
 *
 * It searches in contacts.orders[] for orders with:
 *  - paid_status === "paid"
 *  - paid_status === "not_paid"
 */
export function registerPaymentCheckHandlers(bot: Telegraf<Context>) {
  // 1) Users who paid
  bot.action(PAID_USERS_BUTTON_CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery(); // stop loading spinner

      // Find contacts that have at least one order with paid_status === "paid"
      const contacts = await Contact.findAll();

      const paidContacts = contacts.filter((contact) =>
        (contact.orders ?? []).some((order) => order.paid_status === "paid"),
      );

      if (paidContacts.length === 0) {
        await ctx.reply("Немає користувачів з оплатою (paid_status = \"paid\").");
        return;
      }

      // Build a short, readable list
      const lines = paidContacts.slice(0, 50).map((c) => {
        const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
        const nameOrEmail = fullName || c.email;
        return `• ${nameOrEmail} (${c.email})`;
      });

      const header = "Користувачі, які проплатили (paid_status = \"paid\"):";
      const footer =
        paidContacts.length > lines.length
          ? `\n\nПоказано ${lines.length} з ${paidContacts.length} користувачів.`
          : "";

      await ctx.reply(`${header}\n\n${lines.join("\n")}${footer}`);
    } catch (error) {
      console.error("Error while listing paid users:", error);
      await ctx.reply(
        "Сталася помилка під час отримання списку користувачів, які оплатили. Спробуйте пізніше.",
      );
    }
  });

  // 2) Users who have not paid
  bot.action(NOT_PAID_USERS_BUTTON_CALLBACK, async (ctx) => {
    try {
      await ctx.answerCbQuery(); // stop loading spinner

      // Find contacts that have at least one order with paid_status === "not_paid"
      const contacts = await Contact.findAll();

      const notPaidContacts = contacts.filter((contact) =>
        (contact.orders ?? []).some(
          (order) => order.paid_status === "not_paid",
        ),
      );

      if (notPaidContacts.length === 0) {
        await ctx.reply(
          "Немає користувачів з неоплаченою підпискою (paid_status = \"not_paid\").",
        );
        return;
      }

      const lines = notPaidContacts.slice(0, 50).map((c) => {
        const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
        const nameOrEmail = fullName || c.email;
        return `• ${nameOrEmail} (${c.email})`;
      });

      const header =
        "Користувачі, які ще не оплатили (paid_status = \"not_paid\"):";
      const footer =
        notPaidContacts.length > lines.length
          ? `\n\nПоказано ${lines.length} з ${notPaidContacts.length} користувачів.`
          : "";

      await ctx.reply(`${header}\n\n${lines.join("\n")}${footer}`);
    } catch (error) {
      console.error("Error while listing not-paid users:", error);
      await ctx.reply(
        "Сталася помилка під час отримання списку користувачів, які не оплатили. Спробуйте пізніше.",
      );
    }
  });
}