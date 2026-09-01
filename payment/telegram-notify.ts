import { ensureSparkleButtonLabel } from "../telegram/core/sparkle-label";

export type TelegramUrlButton = { text: string; url: string };
export type TelegramCallbackButton = { text: string; callbackData: string };

/** Inline keyboard on D-1 charge reminder — opens `/unsubscribe` confirm. */
export const UNSUBSCRIBE_MANAGE_CALLBACK = "unsub_manage";
export const MANAGE_SUBSCRIPTION_BUTTON_TEXT = "Керувати підпискою";

export type SendTelegramBotMessageOptions = {
  parseMode?: "HTML";
  callbackButtons?: TelegramCallbackButton[];
};

/**
 * Надсилання повідомлень у Telegram без запуску polling-бота (лише Bot API).
 * `urlButtons` — опційні inline-кнопки з посиланнями (по одній у рядку).
 * Тексти URL-кнопок нормалізуються до шаблону ✨ … ✨ (як у боті).
 * Callback-кнопки (`options.callbackButtons`) без sparkles.
 */
export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  urlButtons?: TelegramUrlButton[],
  options?: SendTelegramBotMessageOptions,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram-notify] TELEGRAM_BOT_TOKEN is not set");
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (options?.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  const urlRows =
    urlButtons && urlButtons.length > 0
      ? urlButtons.map((b) => [
          { text: ensureSparkleButtonLabel(b.text), url: b.url },
        ])
      : [];
  const callbackRows =
    options?.callbackButtons && options.callbackButtons.length > 0
      ? options.callbackButtons.map((b) => [
          { text: b.text, callback_data: b.callbackData },
        ])
      : [];
  const inlineKeyboard = [...urlRows, ...callbackRows];
  if (inlineKeyboard.length > 0) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("[telegram-notify] sendMessage failed", res.status, body);
  }
}
