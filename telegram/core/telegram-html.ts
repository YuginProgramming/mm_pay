/** Для sendMessage з parse_mode: HTML (див. Bot API). */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Видимий підпис з клікабельним посиланням без показу raw URL у тексті. */
export function telegramHtmlLink(url: string, visible: string): string {
  const href = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<a href="${href}">${escapeTelegramHtml(visible)}</a>`;
}
