/**
 * Діагностика: чому після оплати WayForPay у повідомленні дві групи (pro), а не одна (masters).
 *
 * Ранг для повідомлення = як у grant після CREATE:
 *   tierRowCount = COUNT(*) WHERE contact_id AND source <> 'payment_hook'
 *   tier = kwigaAudienceRank(true, tierRowCount)
 * Оплати в Telegram не збільшують цей лічильник → masters лишається masters доти, доки KWIGA
 * (kwiga_sync / manual_grant) не дасть 5+ релевантних рядків.
 *
 * Запуск з кореня проєкту:
 *   npx ts-node debug/inspect-payment-success-tier.ts
 *   npx ts-node debug/inspect-payment-success-tier.ts 269694206
 */
import "dotenv/config";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import { computeKwigaRankSnapshot } from "../telegram/profile/kwiga-rank-db";
import { formatKwigaRankLine, kwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";

const DEFAULT_TELEGRAM_ID = "269694206";

type AccessSource = "kwiga_sync" | "manual_grant" | "payment_hook" | string;

function argvTelegramId(): string {
  const a = process.argv[2]?.trim();
  if (a && /^\d+$/.test(a)) return a;
  return DEFAULT_TELEGRAM_ID;
}

function paymentSuccessSummary(tier: ReturnType<typeof kwigaAudienceRank>): string {
  if (tier === "pro") {
    return "Як у боті після оплати: два посилання + дві кнопки (Майстри + Про).";
  }
  return "Як у боті після оплати: одне посилання + одна кнопка (лише Майстри).";
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramId = argvTelegramId();
  const user = await TelegramUser.findOne({ where: { telegramId } });

  if (!user) {
    console.log({ error: "telegram_users не знайдено", telegramId });
    return;
  }

  const snapshot = await computeKwigaRankSnapshot(user);
  const email = user.email?.trim() ?? null;

  const bySource: Record<string, number> = {};
  let rows: ContactProductAccess[] = [];

  if (snapshot.contact) {
    rows = await ContactProductAccess.findAll({
      where: { contactId: snapshot.contact.id },
      order: [["id", "ASC"]],
      attributes: [
        "id",
        "source",
        "externalProductId",
        "isActive",
        "revokedAt",
        "wayforpayOrderReference",
        "titleSnapshot",
        "createdAt",
      ],
    });
    for (const r of rows) {
      const s = r.source as AccessSource;
      bySource[s] = (bySource[s] ?? 0) + 1;
    }
  }

  const tier = kwigaAudienceRank(snapshot.contact !== null, snapshot.accessRowCount);
  const totalAllRows = rows.length;

  console.log("=== inspect-payment-success-tier ===\n");
  console.log({
    telegramId: user.telegramId,
    telegramUserPk: user.id,
    email: email ?? "(немає — грант не знайде контакт)",
    contactId: snapshot.contact?.id ?? null,
    tierRowCountForRankExcludesPaymentHook: snapshot.accessRowCount,
    totalRowsInContactProductAccess: totalAllRows,
    countsBySource: snapshot.contact ? bySource : {},
    rankFromSameRuleAsGrant: tier,
    rankLine: formatKwigaRankLine(tier),
    afterPaymentMessage: paymentSuccessSummary(tier),
    note:
      "Для рангу враховуються лише рядки не з payment_hook. " +
      "Нова оплата в боті додає payment_hook, але не змінює tierRowCount і тип повідомлення після оплати.",
  });

  if (rows.length > 0) {
    console.log("\n--- contact_product_access (хронологічно id) ---");
    for (const r of rows) {
      console.log({
        id: r.id,
        source: r.source,
        externalProductId: r.externalProductId,
        isActive: r.isActive,
        revokedAt: r.revokedAt,
        wayforpayOrderReference: r.wayforpayOrderReference ?? null,
        titleSnapshot: r.titleSnapshot
          ? r.titleSnapshot.length > 60
            ? `${r.titleSnapshot.slice(0, 60)}…`
            : r.titleSnapshot
          : null,
        createdAt: r.createdAt,
      });
    }
  }

  const hookRows = rows.filter((r) => r.source === "payment_hook");
  if (snapshot.contact && hookRows.length >= 1) {
    console.log(
      "\n--- Після ще однієї оплати (payment_hook): tierRowCount не змінюється ---",
    );
    console.log({
      tierRowCountBeforeAndAfterExtraPaymentHook: snapshot.accessRowCount,
      rankStays: tier,
      afterPaymentMessageStays: paymentSuccessSummary(tier),
    });
  }

  if (tier === "pro" && snapshot.accessRowCount >= 5) {
    const tierRowsOnly = rows.filter((r) => r.source !== "payment_hook");
    const fifth = tierRowsOnly[4];
    console.log(
      "\n--- 5-й релевантний рядок (kwiga_sync/manual_grant), умова pro для повідомлення ---",
    );
    console.log(
      fifth
        ? {
            id: fifth.id,
            source: fifth.source,
            wayforpayOrderReference: fifth.wayforpayOrderReference,
            titleSnapshot: fifth.titleSnapshot,
          }
        : "(немає деталей — перевірити через JOIN у БД)",
    );
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
