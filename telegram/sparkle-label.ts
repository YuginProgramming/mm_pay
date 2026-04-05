/** Підпис inline-кнопки з «зірочками» з боків (як у референсі UI). */
export function sparkleLabel(text: string): string {
  return `✨ ${text} ✨`;
}

/** Для Bot API / змішаних викликів: не обгортає повторно, якщо вже у форматі ✨ … ✨. */
export function ensureSparkleButtonLabel(text: string): string {
  const t = text.trim();
  if (t.startsWith("✨") && t.endsWith("✨") && t.length >= 4) {
    return text;
  }
  return sparkleLabel(t);
}
