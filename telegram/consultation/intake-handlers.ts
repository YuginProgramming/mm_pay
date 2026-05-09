import { randomUUID } from "crypto";
import { Op, literal } from "sequelize";
import { Markup, Telegraf } from "telegraf";
import { ConsultationCase } from "../../database/ConsultationCase";
import { ConsultationIntakeSession } from "../../database/ConsultationIntakeSession";
import { TelegramUser } from "../../database/TelegramUser";
import { CONSULTATION_CLIENT_PRODUCT_CODE } from "../../payment/consultation-product";
import { getConsultationAccessState } from "../../payment/consultation-payment.service";
import { CB } from "./callbacks";
import {
  INTAKE_Q1_TEXT,
  INTAKE_Q2_TEXT,
  INTAKE_Q3_TEXT,
  INTAKE_Q4_TEXT,
} from "./content";
import { createForumTopicIdempotent, sendMessageInTopic } from "./forum-api";
import {
  createIntakeSession,
  addMediaFileId,
  markAnswer,
  moveToStep,
  type IntakeSession,
} from "./intake-state";
import { buildConsultationTopicTitle } from "./topic-title";
import { consultationDebug } from "./debug-log";

const intakeSessions = new Map<number, IntakeSession>();

function intakeQ1Keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Тип статури", CB.intakeQ1BodyType)],
    [Markup.button.callback("Пройти діагностику", CB.intakeQ1Diagnostics)],
  ]);
}

function intakeQ4Keyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Завершити анкету", CB.intakeQ4Submit)],
  ]);
}

async function persistSession(session: IntakeSession): Promise<void> {
  await ConsultationIntakeSession.upsert({
    consultationId: session.consultationId,
    telegramUserId: session.telegramUserId,
    status: session.status,
    step: session.step,
    answersJson: session.answers,
    mediaFileIdsJson: session.mediaFileIds,
  });
  consultationDebug("intake.persisted", {
    consultationId: session.consultationId,
    telegramUserId: session.telegramUserId,
    step: session.step,
    status: session.status,
    mediaCount: session.mediaFileIds.length,
    answerKeys: Object.keys(session.answers),
  });
}

async function hasApprovedClientAccess(telegramUserId: string): Promise<boolean> {
  const state = await getConsultationAccessState({
    telegramUserId,
    productCode: CONSULTATION_CLIENT_PRODUCT_CODE,
  });
  return state.status === "approved";
}

export function registerIntakeHandlers(bot: Telegraf): void {
  bot.command("intake_start_test", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const session =
      createIntakeSession({
        consultationId: `manual-${fromId}-${Date.now()}`,
        telegramUserId: String(fromId),
      });
    intakeSessions.set(
      fromId,
      session,
    );
    await persistSession(session);
    await ConsultationCase.upsert({
      consultationId: session.consultationId,
      telegramUserId: String(fromId),
      telegramChatId: String(ctx.chat?.id ?? fromId),
      status: "INTAKE_IN_PROGRESS",
    });
    consultationDebug("intake.session_started", {
      source: "command",
      consultationId: session.consultationId,
      telegramUserId: String(fromId),
      chatId: String(ctx.chat?.id ?? fromId),
    });
    await ctx.reply(INTAKE_Q1_TEXT, intakeQ1Keyboard());
  });

  bot.action(CB.intakeStart, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    if (!fromId) return;
    if (!(await hasApprovedClientAccess(String(fromId)))) {
      consultationDebug("intake.submit_blocked", {
        telegramUserId: String(fromId),
        reason: "payment_identity_mismatch",
      });
      await ctx.reply(
        "Наразі немає підтвердженої оплати консультації для цього Telegram акаунта. " +
          "Перевірте, що ви оплачуєте і проходите анкету в одному й тому ж бот-акаунті.",
      );
      return;
    }
    const session = createIntakeSession({
      consultationId: `pay-${fromId}-${Date.now()}`,
      telegramUserId: String(fromId),
    });
    intakeSessions.set(
      fromId,
      session,
    );
    await persistSession(session);
    await ConsultationCase.upsert({
      consultationId: session.consultationId,
      telegramUserId: String(fromId),
      telegramChatId: String(ctx.chat?.id ?? fromId),
      status: "INTAKE_IN_PROGRESS",
    });
    consultationDebug("intake.session_started", {
      source: "callback",
      consultationId: session.consultationId,
      telegramUserId: String(fromId),
      chatId: String(ctx.chat?.id ?? fromId),
    });
    await ctx.reply(INTAKE_Q1_TEXT, intakeQ1Keyboard());
  });

  bot.action(CB.intakeQ1BodyType, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      consultationDebug("intake.session_missing", {
        action: CB.intakeQ1BodyType,
        fromId: fromId ?? null,
      });
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    const next = moveToStep(markAnswer(session, "q1", "body_type"), "Q2");
    intakeSessions.set(fromId, next);
    await persistSession(next);
    consultationDebug("intake.step_changed", {
      consultationId: next.consultationId,
      telegramUserId: String(fromId),
      step: next.step,
      answerKey: "q1",
      answerValue: "body_type",
    });
    await ctx.reply(`Q1 збережено: тип статури.\n\n${INTAKE_Q2_TEXT}`);
  });

  bot.action(CB.intakeQ1Diagnostics, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      consultationDebug("intake.session_missing", {
        action: CB.intakeQ1Diagnostics,
        fromId: fromId ?? null,
      });
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    const next = moveToStep(markAnswer(session, "q1", "diagnostics"), "Q2");
    intakeSessions.set(fromId, next);
    await persistSession(next);
    consultationDebug("intake.step_changed", {
      consultationId: next.consultationId,
      telegramUserId: String(fromId),
      step: next.step,
      answerKey: "q1",
      answerValue: "diagnostics",
    });
    await ctx.reply(`Q1 збережено: діагностика.\n\n${INTAKE_Q2_TEXT}`);
  });

  bot.on("message", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId) return next();
    const session = intakeSessions.get(fromId);
    if (!session) return next();
    // After intake DONE, relay and other middleware must still run (Telegraf chain).
    if (session.step === "DONE") return next();

    if (session.step === "Q2" && "text" in ctx.message) {
      const next = moveToStep(
        markAnswer(session, "q2_goal", ctx.message.text.trim()),
        "Q3",
      );
      intakeSessions.set(fromId, next);
      await persistSession(next);
      consultationDebug("intake.step_changed", {
        consultationId: next.consultationId,
        telegramUserId: String(fromId),
        step: next.step,
        answerKey: "q2_goal",
      });
      await ctx.reply(INTAKE_Q3_TEXT);
      return;
    }

    if (session.step === "Q3" && "text" in ctx.message) {
      const next = moveToStep(
        markAnswer(session, "q3_problem", ctx.message.text.trim()),
        "Q4_MEDIA",
      );
      intakeSessions.set(fromId, next);
      await persistSession(next);
      consultationDebug("intake.step_changed", {
        consultationId: next.consultationId,
        telegramUserId: String(fromId),
        step: next.step,
        answerKey: "q3_problem",
      });
      await ctx.reply(INTAKE_Q4_TEXT, intakeQ4Keyboard());
      return;
    }

    if (session.step === "Q4_MEDIA") {
      if ("photo" in ctx.message && ctx.message.photo?.length) {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
        if (fileId) {
          const updated = addMediaFileId(session, fileId);
          intakeSessions.set(fromId, updated);
          await persistSession(updated);
          consultationDebug("intake.media_added", {
            consultationId: updated.consultationId,
            telegramUserId: String(fromId),
            mediaType: "photo",
            mediaCount: updated.mediaFileIds.length,
          });
          await ctx.reply("Фото додано. Можна ще файл або натисніть «✅ Завершити анкету».");
          return;
        }
        return next();
      }
      if ("video" in ctx.message && ctx.message.video?.file_id) {
        const updated = addMediaFileId(session, ctx.message.video.file_id);
        intakeSessions.set(fromId, updated);
        await persistSession(updated);
        consultationDebug("intake.media_added", {
          consultationId: updated.consultationId,
          telegramUserId: String(fromId),
          mediaType: "video",
          mediaCount: updated.mediaFileIds.length,
        });
        await ctx.reply("Відео додано. Можна ще файл або натисніть «✅ Завершити анкету».");
        return;
      }
      return next();
    }

    return next();
  });

  bot.action(CB.intakeQ4Submit, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      consultationDebug("intake.session_missing", {
        action: CB.intakeQ4Submit,
        fromId: fromId ?? null,
      });
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    if (session.mediaFileIds.length < 1) {
      consultationDebug("intake.submit_blocked", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        reason: "no_media",
      });
      await ctx.reply("Додайте хоча б одне фото або відео перед завершенням.");
      return;
    }
    if (!(await hasApprovedClientAccess(String(fromId)))) {
      consultationDebug("intake.submit_blocked", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        reason: "payment_identity_mismatch",
      });
      await ctx.reply(
        "Не вдалося завершити анкету: підтверджена оплата не знайдена для цього Telegram акаунта. " +
          "Оплатіть і проходьте анкету з одного й того ж акаунта.",
      );
      return;
    }

    const token = process.env.CONSULTATION_BOT_TOKEN;
    const managerChatIdRaw = process.env.CONSULTATION_MANAGER_CHAT_ID;
    const managerChatId = managerChatIdRaw ? Number(managerChatIdRaw) : NaN;
    if (!token || !Number.isFinite(managerChatId)) {
      consultationDebug("intake.submit_blocked", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        reason: "manager_config_missing",
      });
      await ctx.reply(
        "Анкету збережено, але форум-група не налаштована. Повідомте адміністратора.",
      );
      return;
    }

    let messageThreadIdToUse: number | null = null;
    const existingMappedCase = await ConsultationCase.findOne({
      where: {
        telegramUserId: String(fromId),
        managerChatId: String(managerChatId),
        messageThreadId: { [Op.ne]: null },
      },
      order: literal("\"updated_at\" DESC"),
    });
    if (existingMappedCase?.messageThreadId) {
      messageThreadIdToUse = Number(existingMappedCase.messageThreadId);
      consultationDebug("intake.topic_reused", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        managerChatId,
        messageThreadId: messageThreadIdToUse,
        sourceConsultationId: existingMappedCase.consultationId,
      });
      consultationDebug("topic.reconcile.fixed", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        managerChatId,
        messageThreadId: messageThreadIdToUse,
        source: "intake_submit_reuse_existing",
      });
    } else {
      const user = await TelegramUser.findOne({
        where: { telegramId: String(fromId) },
      });
      const topicName = buildConsultationTopicTitle({
        telegramId: fromId,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        username: user?.username ?? null,
      });
      consultationDebug("topic.create.start", {
        consultationId: session.consultationId,
        telegramUserId: String(fromId),
        managerChatId,
        topicName,
        source: "intake_submit",
      });
      try {
        const { message_thread_id } = await createForumTopicIdempotent({
          token,
          chatId: managerChatId,
          name: topicName,
          consultationId: session.consultationId,
          findExistingThreadId: async () => {
            const existingByConsultationId = await ConsultationCase.findOne({
              where: {
                consultationId: session.consultationId,
                managerChatId: String(managerChatId),
                messageThreadId: { [Op.ne]: null },
              },
            });
            if (!existingByConsultationId?.messageThreadId) {
              return null;
            }
            return Number(existingByConsultationId.messageThreadId);
          },
        });
        messageThreadIdToUse = message_thread_id;
        consultationDebug("topic.create.success", {
          consultationId: session.consultationId,
          telegramUserId: String(fromId),
          managerChatId,
          messageThreadId: message_thread_id,
          topicName,
          source: "intake_submit",
        });
        consultationDebug("intake.topic_created", {
          consultationId: session.consultationId,
          telegramUserId: String(fromId),
          managerChatId,
          messageThreadId: message_thread_id,
          topicName,
        });
      } catch (err) {
        consultationDebug("topic.create.error", {
          consultationId: session.consultationId,
          telegramUserId: String(fromId),
          managerChatId,
          topicName,
          source: "intake_submit",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    const summary = [
      "📋 Intake завершено (client flow)",
      `Consultation ID: ${session.consultationId}`,
      `User ID: ${fromId}`,
      `Q1: ${session.answers.q1 ?? "-"}`,
      `Q2: ${session.answers.q2_goal ?? "-"}`,
      `Q3: ${session.answers.q3_problem ?? "-"}`,
      `Media count: ${session.mediaFileIds.length}`,
      `Media IDs: ${session.mediaFileIds.join(", ")}`,
    ].join("\n");
    if (!messageThreadIdToUse) {
      throw new Error("Failed to resolve manager topic thread id for intake submit.");
    }
    await sendMessageInTopic(token, managerChatId, messageThreadIdToUse, summary);

    const done = moveToStep(session, "DONE");
    intakeSessions.set(fromId, done);
    await persistSession(done);
    await ConsultationCase.update(
      {
        status: "ACTIVE_CONVERSATION",
        managerChatId: String(managerChatId),
        messageThreadId: String(messageThreadIdToUse),
      },
      { where: { consultationId: session.consultationId } },
    );
    consultationDebug("intake.submit_done", {
      consultationId: session.consultationId,
      telegramUserId: String(fromId),
      managerChatId,
      messageThreadId: messageThreadIdToUse,
      mediaCount: done.mediaFileIds.length,
    });

    await ctx.reply("✅ Анкету завершено. Менеджер вже бачить ваш кейс і підключиться в цьому чаті.");
  });
}
