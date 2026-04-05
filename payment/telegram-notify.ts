import { ensureSparkleButtonLabel } from "../telegram/sparkle-label";

export type TelegramUrlButton = { text: string; url: string };

/**
 * Надсилання повідомлень у Telegram без запуску polling-бота (лише Bot API).
 * `urlButtons` — опційні inline-кнопки з посиланнями (по одній у рядку).
 * Тексти кнопок нормалізуються до шаблону ✨ … ✨ (як у боті).
 */
export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
  urlButtons?: TelegramUrlButton[],
  options?: { parseMode?: "HTML" },
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

  if (urlButtons && urlButtons.length > 0) {
    payload.reply_markup = {
      inline_keyboard: urlButtons.map((b) => [
        { text: ensureSparkleButtonLabel(b.text), url: b.url },
      ]),
    };
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
