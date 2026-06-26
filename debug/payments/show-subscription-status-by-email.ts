/**
 * Subscription status for a bot user resolved by email (internal `user_subscriptions` + auto-renew).
 *
 *   npx ts-node debug/payments/show-subscription-status-by-email.ts user@example.com
 *   npx ts-node debug/payments/show-subscription-status-by-email.ts --email=user@example.com
 *   npm run debug:subscription-status-by-email -- user@example.com
 */
import "dotenv/config";
import { Op } from "sequelize";
import { sequelize } from "../../database/db";
import { normalizeEmail } from "../../database/normalize-email";
import { SubscriptionPlan } from "../../database/SubscriptionPlan";
import { TelegramUser } from "../../database/TelegramUser";
import { UserSubscription } from "../../database/UserSubscription";
import { getSubscriptionStatusForUserId } from "../../payment/subscription-status.service";

function parseEmailArg(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--email=")) {
      return normalizeEmail(arg.slice("--email=".length)) || null;
    }
    if (!arg.startsWith("-")) {
      return normalizeEmail(arg) || null;
    }
  }
  return null;
}

async function findTelegramUserByEmail(email: string): Promise<TelegramUser | null> {
  return TelegramUser.findOne({
    where: {
      email: {
        [Op.iLike]: email,
      },
    },
  });
}

async function main(): Promise<void> {
  const email = parseEmailArg();
  if (!email) {
    console.error(
      "Usage: npx ts-node debug/payments/show-subscription-status-by-email.ts <email>\n" +
        "   or: npx ts-node debug/payments/show-subscription-status-by-email.ts --email=<email>",
    );
    process.exit(1);
  }

  await sequelize.authenticate();

  const user = await findTelegramUserByEmail(email);
  if (!user) {
    console.error("telegram_users: no row for email:", email);
    process.exit(1);
  }

  const userId = String(user.telegramId);
  const status = await getSubscriptionStatusForUserId(userId);

  const latestRow = await UserSubscription.findOne({
    where: { userId },
    order: [["endAt", "DESC"]],
  });

  let dbRow: Record<string, unknown> | null = null;
  if (latestRow) {
    const plan = await SubscriptionPlan.findByPk(latestRow.planId, {
      attributes: ["code"],
    });
    dbRow = {
      id: latestRow.id,
      planId: latestRow.planId,
      planCode: plan?.code ?? null,
      status: latestRow.status,
      startAt: latestRow.startAt?.toISOString() ?? null,
      endAt: latestRow.endAt?.toISOString() ?? null,
      lastPaymentOrderReference: latestRow.lastPaymentOrderReference,
      updatedAt: latestRow.updatedAt?.toISOString() ?? null,
    };
  }

  console.log("=== subscription status by email ===\n");
  console.log(
    JSON.stringify(
      {
        email,
        telegramId: user.telegramId,
        telegramUserPk: user.id,
        userId,
        ...status,
        latestUserSubscriptionRow: dbRow,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sequelize.close();
  });
