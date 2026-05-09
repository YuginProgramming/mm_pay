import { Markup, Telegraf } from "telegraf";
import {
  CONSULTATION_CLIENT_PRODUCT_CODE,
  CONSULTATION_MASTER_PRODUCT_CODE,
} from "../../payment/consultation-product";
import {
  createConsultationCheckout,
  getConsultationAccessState,
} from "../../payment/consultation-payment.service";
import { CB } from "./callbacks";
import {
  TEXT_S1,
  TEXT_S10,
  TEXT_S2,
  TEXT_S2_CLIENT,
  TEXT_S2_MASTER,
  TEXT_S20,
  clientMessage,
  masterMessage,
} from "./content";
import { consultationDebug } from "./debug-log";

export function registerMenuHandlers(bot: Telegraf, input: {
  accountBotUrl: string;
  landingUrl?: string;
}): void {
  const ADMIN_CONTACT_TEXT = "Звʼязатися з адміністратором";
  const ADMIN_CONTACT_URL = "https://t.me/YevhenDudar";

  const mainMenuKeyboard = () =>
    Markup.inlineKeyboard([
      [Markup.button.callback("Я проходив навчання", CB.s10)],
      [Markup.button.callback("Консультація", CB.s2)],
      [Markup.button.callback("Хочу навчання", CB.s20)],
    ]);

  const footerKeyboard = () =>
    Markup.keyboard([[ADMIN_CONTACT_TEXT]]).resize().persistent();

  const backKeyboard = () =>
    Markup.inlineKeyboard([[Markup.button.callback("« Назад до меню", CB.s1)]]);

  bot.start(async (ctx) =>
    ctx.reply(TEXT_S1, {
      ...mainMenuKeyboard(),
      ...footerKeyboard(),
    }),
  );
  bot.hears(ADMIN_CONTACT_TEXT, async (ctx) =>
    ctx.reply(
      "Звʼязок з адміністратором:",
      Markup.inlineKeyboard([[Markup.button.url(ADMIN_CONTACT_TEXT, ADMIN_CONTACT_URL)]]),
    ),
  );
  bot.command("cancel", async (ctx) =>
    ctx.reply("Меню скинуто. Натисніть /start, щоб відкрити головне меню."),
  );

  bot.action(CB.s1, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(TEXT_S1, mainMenuKeyboard());
  });
  bot.action(CB.s10, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      TEXT_S10,
      Markup.inlineKeyboard([
        [Markup.button.url("Перейти в акаунт-бот", input.accountBotUrl)],
        [Markup.button.callback("« Назад до меню", CB.s1)],
      ]),
    );
  });
  bot.action(CB.s2, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      TEXT_S2,
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Хочу результат для себе", CB.s2Client)],
        [Markup.button.callback("🎓 Я працюю з клієнтами", CB.s2Master)],
        [Markup.button.callback("« Назад до меню", CB.s1)],
      ]),
    );
  });
  bot.action(CB.s2Client, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const state = fromId
      ? await getConsultationAccessState({
          telegramUserId: String(fromId),
          productCode: CONSULTATION_CLIENT_PRODUCT_CODE,
        })
      : { status: "no_access" as const };
    consultationDebug("menu.access_state", {
      branch: "client",
      fromId: fromId ?? null,
      status: state.status,
      hasCheckoutUrl:
        state.status === "pending_with_url" ? Boolean(state.checkoutUrl) : false,
    });
    const rows: any[] = [];
    let extra = "";
    if (state.status === "approved") {
      extra =
        "\n\n✅ Оплату підтверджено. Ви вже авторизовані для спілкування з менеджером у цьому чаті.";
    } else if (state.status === "pending_with_url") {
      extra = "\n\n⏳ Оплата вже розпочата. Ви можете продовжити її за кнопкою нижче.";
      rows.push([Markup.button.url("💳 Продовжити оплату", state.checkoutUrl)]);
    } else {
      rows.push([Markup.button.callback(clientMessage.cta.text, CB.s2ClientPay)]);
    }
    rows.push([Markup.button.callback("« Назад", CB.s2)]);
    rows.push([Markup.button.callback("« Назад до меню", CB.s1)]);
    await ctx.editMessageText(
      `${TEXT_S2_CLIENT}${extra}`,
      Markup.inlineKeyboard(rows),
    );
  });
  bot.action(CB.s2Master, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const state = fromId
      ? await getConsultationAccessState({
          telegramUserId: String(fromId),
          productCode: CONSULTATION_MASTER_PRODUCT_CODE,
        })
      : { status: "no_access" as const };
    consultationDebug("menu.access_state", {
      branch: "master",
      fromId: fromId ?? null,
      status: state.status,
      hasCheckoutUrl:
        state.status === "pending_with_url" ? Boolean(state.checkoutUrl) : false,
    });
    const rows: any[] = [];
    let extra = "";
    if (state.status === "approved") {
      extra =
        "\n\n✅ Оплату підтверджено. Ви вже авторизовані для спілкування з менеджером у цьому чаті.";
    } else if (state.status === "pending_with_url") {
      extra = "\n\n⏳ Оплата вже розпочата. Ви можете продовжити її за кнопкою нижче.";
      rows.push([Markup.button.url("💳 Продовжити оплату", state.checkoutUrl)]);
    } else {
      rows.push([Markup.button.callback(masterMessage.cta.text, CB.s2MasterPay)]);
    }
    rows.push([Markup.button.callback("« Назад", CB.s2)]);
    rows.push([Markup.button.callback("« Назад до меню", CB.s1)]);
    await ctx.editMessageText(
      `${TEXT_S2_MASTER}${extra}`,
      Markup.inlineKeyboard(rows),
    );
  });

  const createCheckoutReply = async (ctx: any, productCode: string, label: string) => {
    const fromId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!fromId || !chatId) return ctx.reply("Не вдалося визначити користувача для створення оплати.");
    try {
      consultationDebug("menu.checkout_create.start", {
        fromId,
        chatId,
        productCode,
        label,
      });
      const checkout = await createConsultationCheckout({
        telegramUserId: String(fromId),
        telegramChatId: String(chatId),
        productCode: productCode as any,
      });
      await ctx.reply(
        `Оплата ${label} готова.\nСума: ${checkout.amountUah} грн.`,
        Markup.inlineKeyboard([[Markup.button.url("💳 Перейти до оплати", checkout.checkoutUrl)]]),
      );
      consultationDebug("menu.checkout_create.success", {
        fromId,
        chatId,
        productCode,
        amountUah: checkout.amountUah,
        orderReference: checkout.orderReference,
      });
    } catch (e) {
      consultationDebug("menu.checkout_create.error", {
        fromId,
        chatId,
        productCode,
        error: e instanceof Error ? e.message : String(e),
      });
      console.error("[consultation] checkout create failed:", e);
      await ctx.reply("Не вдалося створити оплату. Спробуйте ще раз через кілька хвилин.");
    }
  };

  bot.action(CB.s2ClientPay, async (ctx) => {
    await ctx.answerCbQuery();
    await createCheckoutReply(ctx, CONSULTATION_CLIENT_PRODUCT_CODE, "персональної консультації");
  });
  bot.action(CB.s2MasterPay, async (ctx) => {
    await ctx.answerCbQuery();
    await createCheckoutReply(ctx, CONSULTATION_MASTER_PRODUCT_CODE, "консультації для майстрів");
  });

  bot.action(CB.s20, async (ctx) => {
    await ctx.answerCbQuery();
    const body = input.landingUrl
      ? TEXT_S20
      : `${TEXT_S20}\n\n(Посилання на лендинг зʼявиться після налаштування CONSULTATION_LANDING_URL.)`;
    const kb = input.landingUrl
      ? Markup.inlineKeyboard([
          [Markup.button.url("Відкрити лендинг", input.landingUrl)],
          [Markup.button.callback("« Назад до меню", CB.s1)],
        ])
      : backKeyboard();
    await ctx.editMessageText(body, kb);
  });
}
