/**
 * Прописує в telegram_users.preferences категорію KWIGA (ранг) для кожного користувача
 * за тією ж логікою, що й kwigaAudienceRank / профіль бота:
 *
 *   - немає email або немає контакту в contacts → no_kwiga_contact
 *   - контакт є, 0 рядків у contact_product_access → prospectives
 *   - 1–4 рядки (усі часові, включно з відкликаними) → masters
 *   - 5+ → pro
 *
 * У preferences записуються:
 *   kwigaAudienceRank, kwigaAccessRowCount, kwigaRankSyncedAt
 *
 * Запуск з кореня проєкту:
 *   npx ts-node debug/sync-telegram-kwiga-ranks.ts
 *   npx ts-node debug/sync-telegram-kwiga-ranks.ts --dry-run
 */
import "dotenv/config";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import { type KwigaAudienceRank, kwigaAudienceRank } from "../telegram/kwiga-user-rank";

const PREFS_RANK_KEY = "kwigaAudienceRank";
const PREFS_COUNT_KEY = "kwigaAccessRowCount";
const PREFS_SYNCED_KEY = "kwigaRankSyncedAt";

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function basePrefs(
  prefs: Record<string, unknown> | null,
): Record<string, unknown> {
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
    return { ...prefs };
  }
  return {};
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  const dry = isDryRun();
  if (dry) {
    console.log("DRY-RUN — оновлення БД не виконується");
  }

  const users = await TelegramUser.findAll({ order: [["id", "ASC"]] });
  let updated = 0;
  const summary: Record<KwigaAudienceRank, number> = {
    no_kwiga_contact: 0,
    prospectives: 0,
    masters: 0,
    pro: 0,
  };

  for (const user of users) {
    const email = user.email?.trim() ?? null;
    let hasContact = false;
    let accessRowCount = 0;

    if (email) {
      const contact = await Contact.findOne({ where: { email } });
      if (contact) {
        hasContact = true;
        accessRowCount = await ContactProductAccess.count({
          where: { contactId: contact.id },
        });
      }
    }

    const rank = kwigaAudienceRank(hasContact, accessRowCount);
    summary[rank] += 1;

    const nextPrefs = {
      ...basePrefs(user.preferences as Record<string, unknown> | null),
      [PREFS_RANK_KEY]: rank,
      [PREFS_COUNT_KEY]: accessRowCount,
      [PREFS_SYNCED_KEY]: new Date().toISOString(),
    };

    const prev = user.preferences as Record<string, unknown> | null;
    const prevRank = prev?.[PREFS_RANK_KEY];
    const prevCount = prev?.[PREFS_COUNT_KEY];
    const changed =
      prevRank !== rank || prevCount !== accessRowCount;

    if (dry) {
      if (changed) {
        console.log(
          `id=${user.id} telegram_id=${user.telegramId} email=${email ?? "—"} → ${rank} (access rows=${accessRowCount})`,
        );
      }
    } else {
      await user.update({ preferences: nextPrefs });
      updated += 1;
    }
  }

  console.log("Підсумок за рангами:", summary);
  if (!dry) {
    console.log(`OK — оновлено рядків telegram_users: ${updated}`);
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
