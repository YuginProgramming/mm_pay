/**
 * KWIGA exact end-date for recurring prolong (janitor step after groups reconcile).
 * TA: TZ/kwiga-recurring-prolong.md §7
 *
 * Silent — no Telegram DMs. First-payment offer path is unchanged.
 */
import { findContactByEmailForBot } from "../database/contact-lookup";
import { normalizeEmail } from "../database/normalize-email";
import { syncKwigaContactProductsToDb } from "../database/sync-from-kwiga";
import { TelegramUser } from "../database/TelegramUser";
import {
  fetchKwigaContactProducts,
  putKwigaProductEndDate,
} from "../kwiga/kwiga-api-client";
import { requireKwigaCredentials } from "../kwiga/kwiga-config";
import { effectiveKwigaProductEndAt } from "../kwiga/kwiga-product";

/** Default pause between PUT .../end-date calls (TA D6). */
export const KWIGA_RECURRING_END_DATE_DELAY_MS = 500;

/** Optional rate hygiene: skip PUT if live end already matches target within this window. */
const EQUAL_END_EPSILON_MS = 1000;

export type KwigaRecurringEndDateInput = {
  /** Telegram user id (`subscription_auto.user_id` / metadata.chatId). */
  userId: string;
  /** Same as groups Multimasking `payment_hook.end_at` / `grantEndAt`. */
  targetEndAt: Date;
  /** Pause between product PUTs; default 500 ms. */
  delayMs?: number;
};

export type KwigaRecurringEndDateResult = {
  attempted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export type KwigaRecurringEndDateBatchResult = {
  users: number;
  attempted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endsAlreadyMatch(live: Date | null, target: Date): boolean {
  if (live == null) return false;
  return Math.abs(live.getTime() - target.getTime()) <= EQUAL_END_EPSILON_MS;
}

/**
 * Align all Kwiga products for one recurring user to the groups grant end date.
 * Does not send Telegram messages.
 */
export async function setKwigaExactEndDateForRecurringUser(
  input: KwigaRecurringEndDateInput,
): Promise<KwigaRecurringEndDateResult> {
  const result: KwigaRecurringEndDateResult = {
    attempted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const delayMs =
    input.delayMs != null && input.delayMs >= 0
      ? input.delayMs
      : KWIGA_RECURRING_END_DATE_DELAY_MS;

  try {
    requireKwigaCredentials();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`user#${input.userId}: ${message.slice(0, 200)}`);
    console.warn("[kwiga-recurring-end-date] credentials missing — skip", {
      userId: input.userId,
    });
    return result;
  }

  const telegramUser = await TelegramUser.findOne({
    where: { telegramId: input.userId },
  });
  if (!telegramUser?.email) {
    result.skipped += 1;
    console.warn("[kwiga-recurring-end-date] skip: no telegram email", {
      userId: input.userId,
    });
    return result;
  }

  const contact = await findContactByEmailForBot(
    normalizeEmail(telegramUser.email),
  );
  if (!contact) {
    result.skipped += 1;
    console.warn("[kwiga-recurring-end-date] skip: no local contact", {
      userId: input.userId,
    });
    return result;
  }

  if (contact.externalId == null) {
    result.skipped += 1;
    console.warn("[kwiga-recurring-end-date] skip: contact has no externalId", {
      userId: input.userId,
      contactId: contact.id,
    });
    return result;
  }

  const kwigaContactId = contact.externalId;
  let products;
  try {
    products = await fetchKwigaContactProducts(kwigaContactId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`user#${input.userId}: GET products ${message.slice(0, 180)}`);
    console.error("[kwiga-recurring-end-date] GET products failed", {
      userId: input.userId,
      kwigaContactId,
      message,
    });
    return result;
  }

  if (products.length === 0) {
    result.skipped += 1;
    console.warn("[kwiga-recurring-end-date] skip: no products", {
      userId: input.userId,
      kwigaContactId,
    });
    return result;
  }

  const toUpdate = products.filter(
    (p) => !endsAlreadyMatch(effectiveKwigaProductEndAt(p), input.targetEndAt),
  );
  const alreadyOk = products.length - toUpdate.length;
  result.skipped += alreadyOk;

  for (let i = 0; i < toUpdate.length; i += 1) {
    const product = toUpdate[i];
    result.attempted += 1;
    try {
      await putKwigaProductEndDate({
        kwigaContactId,
        productId: product.id,
        endAt: input.targetEndAt,
      });
      result.updated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `user#${input.userId} product#${product.id}: ${message.slice(0, 180)}`,
      );
      console.error("[kwiga-recurring-end-date] PUT failed", {
        userId: input.userId,
        productId: product.id,
        message,
      });
    }

    if (delayMs > 0 && i < toUpdate.length - 1) {
      await sleep(delayMs);
    }
  }

  if (result.updated > 0) {
    try {
      await syncKwigaContactProductsToDb(kwigaContactId, contact.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `user#${input.userId}: sync ${message.slice(0, 180)}`,
      );
      console.error("[kwiga-recurring-end-date] sync failed (groups access unchanged)", {
        userId: input.userId,
        kwigaContactId,
        message,
      });
    }
  }

  console.log("[kwiga-recurring-end-date] done", {
    userId: input.userId,
    kwigaContactId,
    targetEndAt: input.targetEndAt.toISOString(),
    attempted: result.attempted,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Run exact end-date alignment for every groups-extended user (janitor batch).
 * Sequential users; 500 ms between product PUTs inside each user.
 */
export async function runKwigaRecurringEndDatesOnce(opts: {
  extensions: Array<{ userId: string; targetEndAt: Date }>;
  delayMs?: number;
}): Promise<KwigaRecurringEndDateBatchResult> {
  const batch: KwigaRecurringEndDateBatchResult = {
    users: opts.extensions.length,
    attempted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const ext of opts.extensions) {
    const one = await setKwigaExactEndDateForRecurringUser({
      userId: ext.userId,
      targetEndAt: ext.targetEndAt,
      delayMs: opts.delayMs,
    });
    batch.attempted += one.attempted;
    batch.updated += one.updated;
    batch.skipped += one.skipped;
    batch.errors.push(...one.errors);
  }

  return batch;
}
