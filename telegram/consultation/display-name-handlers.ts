import { literal, Op } from "sequelize";
import { Telegraf } from "telegraf";
import { ConsultationCase } from "../../database/ConsultationCase";
import {
  CONSULTATION_CLIENT_PRODUCT_CODE,
  CONSULTATION_MASTER_PRODUCT_CODE,
} from "../../payment/consultation-product";
import { CB } from "./callbacks";
import {
  CLIENT_POST_DISPLAY_NAME_TEXT,
  MASTER_POST_DISPLAY_NAME_TEXT,
} from "./content";
import { ConsultationCaseStatus } from "./consultation-case-status";
import { consultationDebug } from "./debug-log";
import { editForumTopic, sendMessageInTopic } from "./forum-api";
import { buildConsultationTopicTitleFromDisplayName } from "./topic-title";

const DISPLAY_NAME_MIN_LEN = 2;
const DISPLAY_NAME_MAX_LEN = 120;

export function validateDisplayName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < DISPLAY_NAME_MIN_LEN || trimmed.length > DISPLAY_NAME_MAX_LEN) {
    return null;
  }
  if (trimmed.startsWith("/")) {
    return null;
  }
  return trimmed;
}

async function findCaseAwaitingDisplayName(
  telegramUserId: string,
): Promise<ConsultationCase | null> {
  return ConsultationCase.findOne({
    where: {
      telegramUserId,
      status: ConsultationCaseStatus.AWAITING_DISPLAY_NAME,
    },
    order: literal("\"updated_at\" DESC"),
  });
}

export async function sendPostDisplayNameFollowUp(input: {
  chatId: string | number;
  productCode: string | null;
  telegram?: Telegraf["telegram"];
}): Promise<void> {
  const send = async (
    text: string,
    extra?: { reply_markup?: { inline_keyboard: unknown[][] } },
  ): Promise<void> => {
    if (input.telegram) {
      await input.telegram.sendMessage(input.chatId, text, extra as any);
      return;
    }
    const token = process.env.CONSULTATION_BOT_TOKEN;
    if (!token) {
      console.error("[consultation] CONSULTATION_BOT_TOKEN is not set");
      return;
    }
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          text,
          ...extra,
        }),
      },
    );
    if (!res.ok) {
      console.error(
        "[consultation] sendPostDisplayNameFollowUp failed",
        res.status,
        await res.text(),
      );
    }
  };

  if (input.productCode === CONSULTATION_MASTER_PRODUCT_CODE) {
    await send(MASTER_POST_DISPLAY_NAME_TEXT);
    return;
  }
  await send(CLIENT_POST_DISPLAY_NAME_TEXT, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📋 Почати анкету", callback_data: CB.intakeStart }],
      ],
    },
  });
}

export function registerDisplayNameHandlers(bot: Telegraf): void {
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message;
    if (!msg || !("text" in msg)) {
      return next();
    }
    if (ctx.chat?.type !== "private" || !ctx.from?.id) {
      return next();
    }

    const telegramUserId = String(ctx.from.id);
    const consultationCase = await findCaseAwaitingDisplayName(telegramUserId);
    if (!consultationCase) {
      return next();
    }

    const displayName = validateDisplayName(msg.text);
    if (!displayName) {
      await ctx.reply(
        "Будь ласка, надішліть імʼя та прізвище текстом (від 2 до 120 символів), без команд.",
      );
      return;
    }

    if (!consultationCase.managerChatId || !consultationCase.messageThreadId) {
      await ctx.reply(
        "Тема консультації ще створюється. Зачекайте хвилину і надішліть імʼя ще раз.",
      );
      return;
    }

    const token = process.env.CONSULTATION_BOT_TOKEN;
    const managerChatId = Number(consultationCase.managerChatId);
    const messageThreadId = Number(consultationCase.messageThreadId);
    if (!token || !Number.isFinite(managerChatId) || !Number.isFinite(messageThreadId)) {
      await ctx.reply("Технічна помилка. Спробуйте пізніше або напишіть у підтримку.");
      return;
    }

    const topicTitle = buildConsultationTopicTitleFromDisplayName(
      telegramUserId,
      displayName,
    );

    try {
      await editForumTopic(token, managerChatId, messageThreadId, topicTitle);
      await sendMessageInTopic(
        token,
        managerChatId,
        messageThreadId,
        `Імʼя клієнта: ${displayName}`,
      );
    } catch (err) {
      consultationDebug("display_name.rename_failed", {
        consultationId: consultationCase.consultationId,
        telegramUserId,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.reply("Не вдалося оновити тему. Спробуйте надіслати імʼя ще раз.");
      return;
    }

    const isMaster =
      consultationCase.productCode === CONSULTATION_MASTER_PRODUCT_CODE;
    const nextStatus = isMaster
      ? ConsultationCaseStatus.ACTIVE_CONVERSATION
      : ConsultationCaseStatus.AWAITING_INTAKE;

    await consultationCase.update({
      displayName,
      status: nextStatus,
    });

    consultationDebug("display_name.collected", {
      consultationId: consultationCase.consultationId,
      telegramUserId,
      productCode: consultationCase.productCode,
      nextStatus,
      topicTitle,
    });

    await ctx.reply(`Дякуємо, ${displayName}!`);
    await sendPostDisplayNameFollowUp({
      chatId: ctx.chat.id,
      productCode: consultationCase.productCode,
      telegram: ctx.telegram,
    });
  });
}

export async function findPaidClientCaseForIntake(
  telegramUserId: string,
): Promise<ConsultationCase | null> {
  return ConsultationCase.findOne({
    where: {
      telegramUserId,
      productCode: CONSULTATION_CLIENT_PRODUCT_CODE,
      messageThreadId: { [Op.ne]: null },
      status: {
        [Op.in]: [
          ConsultationCaseStatus.AWAITING_INTAKE,
          ConsultationCaseStatus.INTAKE_IN_PROGRESS,
        ],
      },
    },
    order: literal("\"updated_at\" DESC"),
  });
}
