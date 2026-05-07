import { randomUUID } from "crypto";
import { Markup, Telegraf } from "telegraf";
import { ConsultationCase } from "../../database/ConsultationCase";
import { ConsultationIntakeSession } from "../../database/ConsultationIntakeSession";
import { TelegramUser } from "../../database/TelegramUser";
import { CB } from "./callbacks";
import {
  INTAKE_Q1_TEXT,
  INTAKE_Q2_TEXT,
  INTAKE_Q3_TEXT,
  INTAKE_Q4_TEXT,
} from "./content";
import { createForumTopic, sendMessageInTopic } from "./forum-api";
import {
  createIntakeSession,
  addMediaFileId,
  markAnswer,
  moveToStep,
  type IntakeSession,
} from "./intake-state";
import { buildConsultationTopicTitle } from "./topic-title";

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
    await ctx.reply(INTAKE_Q1_TEXT, intakeQ1Keyboard());
  });

  bot.action(CB.intakeStart, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    if (!fromId) return;
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
    await ctx.reply(INTAKE_Q1_TEXT, intakeQ1Keyboard());
  });

  bot.action(CB.intakeQ1BodyType, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    const next = moveToStep(markAnswer(session, "q1", "body_type"), "Q2");
    intakeSessions.set(fromId, next);
    await persistSession(next);
    await ctx.reply(`Q1 збережено: тип статури.\n\n${INTAKE_Q2_TEXT}`);
  });

  bot.action(CB.intakeQ1Diagnostics, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    const next = moveToStep(markAnswer(session, "q1", "diagnostics"), "Q2");
    intakeSessions.set(fromId, next);
    await persistSession(next);
    await ctx.reply(`Q1 збережено: діагностика.\n\n${INTAKE_Q2_TEXT}`);
  });

  bot.on("message", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const session = intakeSessions.get(fromId);
    if (!session) return;

    if (session.step === "Q2" && "text" in ctx.message) {
      const next = moveToStep(
        markAnswer(session, "q2_goal", ctx.message.text.trim()),
        "Q3",
      );
      intakeSessions.set(fromId, next);
      await persistSession(next);
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
      await ctx.reply(INTAKE_Q4_TEXT, intakeQ4Keyboard());
      return;
    }

    if (session.step === "Q4_MEDIA") {
      if ("photo" in ctx.message && ctx.message.photo?.length) {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
        if (fileId) {
          const next = addMediaFileId(session, fileId);
          intakeSessions.set(fromId, next);
          await persistSession(next);
          await ctx.reply("Фото додано. Можна ще файл або натисніть «✅ Завершити анкету».");
        }
        return;
      }
      if ("video" in ctx.message && ctx.message.video?.file_id) {
        const next = addMediaFileId(session, ctx.message.video.file_id);
        intakeSessions.set(fromId, next);
        await persistSession(next);
        await ctx.reply("Відео додано. Можна ще файл або натисніть «✅ Завершити анкету».");
        return;
      }
    }
  });

  bot.action(CB.intakeQ4Submit, async (ctx) => {
    await ctx.answerCbQuery();
    const fromId = ctx.from?.id;
    const session = fromId ? intakeSessions.get(fromId) : undefined;
    if (!fromId || !session) {
      await ctx.reply("Intake сесія не знайдена. Натисніть /intake_start_test.");
      return;
    }
    if (session.mediaFileIds.length < 1) {
      await ctx.reply("Додайте хоча б одне фото або відео перед завершенням.");
      return;
    }

    const token = process.env.CONSULTATION_BOT_TOKEN;
    const managerChatIdRaw = process.env.CONSULTATION_MANAGER_CHAT_ID;
    const managerChatId = managerChatIdRaw ? Number(managerChatIdRaw) : NaN;
    if (!token || !Number.isFinite(managerChatId)) {
      await ctx.reply(
        "Анкету збережено, але форум-група не налаштована. Повідомте адміністратора.",
      );
      return;
    }

    const user = await TelegramUser.findOne({
      where: { telegramId: String(fromId) },
    });
    const topicName = buildConsultationTopicTitle({
      telegramId: fromId,
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      username: user?.username ?? null,
    });
    const { message_thread_id } = await createForumTopic(token, managerChatId, topicName);

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
    await sendMessageInTopic(token, managerChatId, message_thread_id, summary);

    const done = moveToStep(session, "DONE");
    intakeSessions.set(fromId, done);
    await persistSession(done);
    await ConsultationCase.update(
      {
        status: "ACTIVE_CONVERSATION",
        managerChatId: String(managerChatId),
        messageThreadId: String(message_thread_id),
      },
      { where: { consultationId: session.consultationId } },
    );

    await ctx.reply("✅ Анкету завершено. Менеджер вже бачить ваш кейс і підключиться в цьому чаті.");
  });
}
