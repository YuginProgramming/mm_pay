/**
 * Звіт по користувачах з рангом **prospectives** (контакт у KWIGA є, 0 релевантних рядків доступу
 * без payment_hook): чи можуть вони технічно пройти оплату WayForPay у боті.
 *
 * Для grant потрібні: email у telegram_users, рядок у contacts з тим самим email, згода з правилами
 * для показу рахунку (див. /payment + rules).
 *
 * Запуск:
 *   npx ts-node debug/list-prospectives-payment-readiness.ts
 *   npx ts-node debug/list-prospectives-payment-readiness.ts --refresh-ranks
 *
 * --refresh-ranks — спочатку перерахувати та записати kwigaAudienceRank у telegram_users
 * (як sync-telegram-kwiga-ranks), потім фільтр prospectives уже й по колонці + верифікація.
 */
import "dotenv/config";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/kwiga-rank-db";
import { hasAcceptedCurrentRules } from "../telegram/rules";

const ADMIN_CONTACT_URL = "https://t.me/YevhenDudar";

async function main(): Promise<void> {
  await sequelize.authenticate();

  const refresh = process.argv.includes("--refresh-ranks");
  const users = await TelegramUser.findAll({ order: [["id", "ASC"]] });

  type Row = {
    telegramId: string;
    email: string | null;
    computedRank: string;
    storedRank: string | null;
    rankMatch: boolean;
    contactId: number | null;
    tierRowCount: number;
    rulesAccepted: boolean;
    canShowPaymentMenu: boolean;
    grantAfterPaymentOk: boolean;
    notes: string;
  };

  const rows: Row[] = [];

  for (const u of users) {
    const snapshot = await computeKwigaRankSnapshot(u);
    if (refresh) {
      await persistKwigaRankSnapshot(u, snapshot);
    }
    if (snapshot.rank !== "prospectives") continue;

    const email = u.email?.trim() ?? null;
    const rulesAccepted = await hasAcceptedCurrentRules(u.telegramId);
    const hasContact = snapshot.contact !== null;

    const canShowPaymentMenu = rulesAccepted;
    const grantAfterPaymentOk = Boolean(email && hasContact);

    const notesParts: string[] = [];
    if (!email) {
      notesParts.push("немає email — після оплати grant не знайде контакт");
    }
    if (!hasContact) {
      notesParts.push("немає contacts за email — некоректно для prospectives");
    }
    if (!rulesAccepted) {
      notesParts.push("правила не прийняті — рахунок WayForPay у боті не показується до «Погоджуюсь»");
    }
    if (!refresh && u.kwigaAudienceRank !== snapshot.rank) {
      notesParts.push("кеш рангу на рядку застарів (запустіть з --refresh-ranks або відкрийте /profile)");
    }

    rows.push({
      telegramId: u.telegramId,
      email,
      computedRank: snapshot.rank,
      storedRank: u.kwigaAudienceRank,
      rankMatch: refresh || u.kwigaAudienceRank === snapshot.rank,
      contactId: snapshot.contact?.id ?? null,
      tierRowCount: snapshot.accessRowCount,
      rulesAccepted,
      canShowPaymentMenu,
      grantAfterPaymentOk,
      notes: notesParts.length ? notesParts.join("; ") : "OK — оплата та зарахування доступні за поточних правил бота",
    });
  }

  const okGrant = rows.filter((r) => r.grantAfterPaymentOk).length;
  const okMenu = rows.filter((r) => r.canShowPaymentMenu).length;
  const fullyOk = rows.filter((r) => r.grantAfterPaymentOk && r.canShowPaymentMenu).length;

  console.log("=== Prospectives — готовність до оплати (MULTIMASKING / WayForPay) ===\n");
  console.log(`Усього prospectives (за live-розрахунком): ${rows.length}`);
  console.log(`Можуть отримати рахунок (правила прийняті): ${okMenu} / ${rows.length}`);
  console.log(`Після оплати grant технічно можливий (email + contact): ${okGrant} / ${rows.length}`);
  console.log(`Обидві умови: ${fullyOk} / ${rows.length}`);
  console.log(
    "\nПояснення: prospectives = контакт у KWIGA є, але ще немає записів продукту (kwiga_sync/manual_grant). " +
      "Оплата в Telegram не підвищує ранг до pro, але має створити payment_hook і активний доступ.\n",
  );
  console.log("Якщо користувач бачить блокування «немає відеокурсів» — перевірте інший бот/текст; " +
    `у цьому репо такого фільтра немає. Адмін: ${ADMIN_CONTACT_URL}\n`);

  for (const r of rows) {
    console.log(JSON.stringify(r, null, 0));
  }

  if (rows.length === 0) {
    console.log("\n(Немає користувачів prospectives у цій БД.)");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
