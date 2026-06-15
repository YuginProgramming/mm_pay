import { KWIGA_RETRY_BASE_DELAY_MS, KWIGA_RETRY_MAX_ATTEMPTS } from "./kwiga-config";

export function isRetriableKwigaErrorMessage(msg: string): boolean {
  return (
    /429|5\d\d/.test(msg) ||
    /rate limit exceeded/i.test(msg) ||
    /POST \/contacts\/purchases 422/.test(msg)
  );
}

export async function withKwigaRetry<T>(
  fn: () => Promise<T>,
  attempts = KWIGA_RETRY_MAX_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err);
      const retriable = isRetriableKwigaErrorMessage(msg);
      if (!retriable || i === attempts - 1) break;
      const delayMs = KWIGA_RETRY_BASE_DELAY_MS * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}
