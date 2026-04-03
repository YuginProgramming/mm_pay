/**
 * Шукає успішні оплати WayForPay у БД: рядки contact_product_access з source=payment_hook.
 *
 * З кореня проєкту:
 *   npx ts-node debug/list-successful-payments.ts
 *   npx ts-node debug/list-successful-payments.ts 50
 */
import "dotenv/config";
import { Op } from "sequelize";
import { Contact } from "../database/Contact";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { defineAssociations } from "../database/associations";
import { sequelize } from "../database/db";

defineAssociations();

function parseLimit(): number {
  const arg = process.argv[2]?.trim();
  if (arg && /^\d+$/.test(arg)) {
    return Math.min(200, Math.max(1, parseInt(arg, 10)));
  }
  return 20;
}

async function main(): Promise<void> {
  await sequelize.authenticate();

  const cfg = sequelize.config;
  console.log(
    `Підключення: ${cfg.database} @ ${cfg.host}:${cfg.port} (користувач: ${cfg.username})\n`,
  );

  const paymentHookTotal = await ContactProductAccess.count({
    where: { source: "payment_hook" },
  });
  const paymentHookWithRef = await ContactProductAccess.count({
    where: {
      source: "payment_hook",
      wayforpayOrderReference: { [Op.not]: null },
    },
  });
  const accessTotal = await ContactProductAccess.count();
  console.log("Зведення contact_product_access:", {
    payment_hook_rows: paymentHookTotal,
    payment_hook_with_wayforpay_ref: paymentHookWithRef,
    all_access_rows: accessTotal,
  });
  console.log("");

  const limit = parseLimit();

  const rows = await ContactProductAccess.findAll({
    where: {
      source: "payment_hook",
      wayforpayOrderReference: { [Op.not]: null },
    },
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "email", "externalId"],
        required: true,
      },
    ],
    order: [["createdAt", "DESC"]],
    limit,
  });

  if (rows.length === 0) {
    if (paymentHookTotal > 0) {
      const orphans = await ContactProductAccess.findAll({
        where: {
          source: "payment_hook",
          wayforpayOrderReference: { [Op.is]: null },
        },
        attributes: ["id", "contactId", "createdAt", "titleSnapshot"],
        limit: 5,
        order: [["createdAt", "DESC"]],
      });
      console.log(
        "Є рядки payment_hook, але без wayforpay_order_reference (некоректні дані або старі тести):",
        orphans.map((r) => ({
          id: r.id,
          contactId: r.contactId,
          createdAt: r.createdAt.toISOString(),
        })),
      );
      return;
    }
    console.log(
      "Немає жодного payment_hook — вебхук WayForPay ще не створив запис оплати в цій БД.\n" +
        "Перевірте: той самий DB_HOST у .env, що на сервері pm2; логи pm2 mm-payment; payment-events.jsonl на сервері.",
    );
    return;
  }

  console.log(`Останні успішні зарахування оплати (до ${limit} рядків):\n`);

  for (const row of rows) {
    const contact = (row as typeof row & { contact?: Contact }).contact;
    console.log({
      accessId: row.id,
      contactId: row.contactId,
      contactEmail: contact?.email ?? "(немає в join)",
      kwigaExternalId: contact?.externalId,
      wayforpayOrderReference: row.wayforpayOrderReference,
      isActive: row.isActive,
      isPaid: row.isPaid,
      titleSnapshot: row.titleSnapshot,
      startAt: row.startAt?.toISOString() ?? null,
      endAt: row.endAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
    console.log("—");
  }

  console.log(`\nВсього показано: ${rows.length}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
