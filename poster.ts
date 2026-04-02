import "dotenv/config";
import { Context, Markup, Telegraf } from "telegraf";
import { sparkleLabel } from "./telegram/sparkle-label";

const token = process.env.TELEGRAM_BOT_TOKEN_POSTER;
const targetGroupId = process.env.TARGET_GROUP_ID;
const accountBotUrl = "https://t.me/multimasking_account_bot";

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN_POSTER is not set. Please add it to your environment (e.g. .env).",
  );
}

if (!targetGroupId) {
  throw new Error(
    "TARGET_GROUP_ID is not set. Please add it to your environment (e.g. .env).",
  );
}

const bot = new Telegraf<Context>(token);
const consultationButtonExtra = Markup.inlineKeyboard([
  Markup.button.url(sparkleLabel("🧠 замовити консультацію"), accountBotUrl),
]);

bot.start(async (ctx) => {
  await ctx.reply("Send me any message, and I will publish it to the group.");
});

// Publish incoming content in the target group as bot-sent messages.
bot.on("message", async (ctx) => {
  if (!ctx.chat || !ctx.message) {
    return;
  }

  // Prevent loops when message comes from the target group itself.
  if (String((ctx.chat as any).id) === targetGroupId) {
    return;
  }

  try {
    const message = ctx.message as any;

    if ("text" in message && typeof message.text === "string") {
      await ctx.telegram.sendMessage(
        targetGroupId,
        message.text,
        consultationButtonExtra,
      );
    } else if ("photo" in message && Array.isArray(message.photo)) {
      const photo = message.photo[message.photo.length - 1];
      await ctx.telegram.sendPhoto(targetGroupId, photo.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("video" in message) {
      await ctx.telegram.sendVideo(targetGroupId, message.video.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("document" in message) {
      await ctx.telegram.sendDocument(targetGroupId, message.document.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("audio" in message) {
      await ctx.telegram.sendAudio(targetGroupId, message.audio.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("voice" in message) {
      await ctx.telegram.sendVoice(targetGroupId, message.voice.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("animation" in message) {
      await ctx.telegram.sendAnimation(targetGroupId, message.animation.file_id, {
        caption: message.caption,
        reply_markup: consultationButtonExtra.reply_markup,
      });
    } else if ("video_note" in message) {
      await ctx.telegram.sendVideoNote(
        targetGroupId,
        message.video_note.file_id,
        consultationButtonExtra,
      );
    } else if ("sticker" in message) {
      await ctx.telegram.sendSticker(
        targetGroupId,
        message.sticker.file_id,
        consultationButtonExtra,
      );
    } else if ("location" in message) {
      await ctx.telegram.sendLocation(
        targetGroupId,
        message.location.latitude,
        message.location.longitude,
        consultationButtonExtra,
      );
    } else if ("venue" in message) {
      await ctx.telegram.sendVenue(
        targetGroupId,
        message.venue.location.latitude,
        message.venue.location.longitude,
        message.venue.title,
        message.venue.address,
        consultationButtonExtra,
      );
    } else if ("contact" in message) {
      await ctx.telegram.sendContact(
        targetGroupId,
        message.contact.phone_number,
        message.contact.first_name,
        consultationButtonExtra,
      );
    } else {
      // Keep bot stable for unsupported message kinds.
      await ctx.reply("Цей тип повідомлення поки не підтримується для публікації.");
      return;
    }

    if (ctx.chat.type === "private") {
      await ctx.reply("Опубліковано у групі.");
    }
  } catch (error) {
    console.error("Error publishing message to target group:", error);
    if (ctx.chat.type === "private") {
      await ctx.reply("Не вдалося опублікувати повідомлення в групі.");
    }
  }
});

export async function launchPosterBot(): Promise<void> {
  await bot.launch();
  console.log("Poster bot started. Publishing messages to target group...");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

void (async () => {
  await launchPosterBot();
})();