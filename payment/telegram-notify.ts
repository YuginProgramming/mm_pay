/**
 * Надсилання повідомлень у Telegram без запуску polling-бота (лише Bot API).
 */
export async function sendTelegramBotMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram-notify] TELEGRAM_BOT_TOKEN is not set");
    return;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("[telegram-notify] sendMessage failed", res.status, body);
  }
}
