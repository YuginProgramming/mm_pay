/**
 * Очищає оплату та «логи» в БД для тестового masters-користувача (email `MASTERS_DEBUG_TEST_EMAIL`,
 * telegram id з app_settings `debug_telegram_user_id_masters` або DEBUG_MASTERS_TG_USER_ID / аргумент),
 * щоб знову пройти сценарій у боті (оплата, вебхуки) без ручного SQL.
 *
 * Що видаляє:
 *   - contact_product_access: source payment_hook і manual_grant для контакта цього email
 *   - pending_wayforpay_orders (chat_id = telegram id)
 *   - wayforpay_webhook_events (metadata_chat_id = telegram id)
 *   - wayforpay_failure_notices для order_reference з pending/webhook цього користувача
 *   - paid_chat_member_state (user_id = telegram id)
 *   - paid_chat_janitor_alert_log (telegram_id)
 *   - email_change_logs (telegram_id)
 *
 * Не видаляє: telegram_users, contacts, kwiga_sync (див. debug/clean-telegram-user-to-masters.ts --strip-kwiga-sync).
 *
 * Після чистки перераховує ранг KWIGA у telegram_users (наступний /profile знову насінняє manual_grant
 * для masters debug email через ensureMastersDebugRankDataForUser).
 *
 * Запуск:
 *   npx ts-node debug/clean-masters-debug-user-retest.ts
 *   npx ts-node debug/clean-masters-debug-user-retest.ts 208159926
 */
import "dotenv/config";
import { Op } from "sequelize";
import {
  findContactByEmailForBot,
  MASTERS_DEBUG_TEST_EMAIL,
} from "../database/contact-lookup";
import { ContactProductAccess } from "../database/ContactProductAccess";
import { EmailChangeLog } from "../database/EmailChangeLog";
import { PaidChatMemberState } from "../database/PaidChatMemberState";
import { PaidChatJanitorAlertLog } from "../database/PaidChatJanitorAlertLog";
import { PendingWayforpayOrder } from "../database/PendingWayforpayOrder";
import { sequelize } from "../database/db";
import { TelegramUser } from "../database/TelegramUser";
import { WayforpayFailureNotice } from "../database/WayforpayFailureNotice";
import { WayforpayWebhookEvent } from "../database/WayforpayWebhookEvent";
import { normalizeEmail } from "../database/normalize-email";
import {
  computeKwigaRankSnapshot,
  persistKwigaRankSnapshot,
} from "../telegram/profile/kwiga-rank-db";
import { resolveMastersDebugTelegramUserId } from "./resolve-debug-telegram-id";

async function main(): Promise<void> {
  await sequelize.authenticate();

  const telegramIdStr = await resolveMastersDebugTelegramUserId(
    2,
    "npx ts-node debug/clean-masters-debug-user-retest.ts [telegram_id]",
  );

  const tgUser = await TelegramUser.findOne({
    where: { telegramId: telegramIdStr },
  });
  if (!tgUser) {
    console.error("Немає telegram_users з telegram_id =", telegramIdStr);
    process.exit(1);
  }

  const emailNormalized = normalizeEmail(tgUser.email?.trim() ?? "");
  const expected = normalizeEmail(MASTERS_DEBUG_TEST_EMAIL);
  if (!emailNormalized || emailNormalized !== expected) {
    console.warn(
      `Очікувався email тест-користувача ${MASTERS_DEBUG_TEST_EMAIL}, зараз у БД: ${tgUser.email ?? "(null)"}. ` +
        "Продовжуємо чистку за поточним email (контакт і access — за нього).",
    );
  }

  const emailForContact = emailNormalized ?? expected;
  const contact = await findContactByEmailForBot(emailForContact);

  const result: Record<string, number | string> = { telegram_id: telegramIdStr };

  const pendingRows = await PendingWayforpayOrder.findAll({
    where: { chatId: telegramIdStr },
  });
  const webhookRows = await WayforpayWebhookEvent.findAll({
    where: { metadataChatId: telegramIdStr },
  });
  const orderRefs = [
    ...new Set([
      ...pendingRows.map((p) => p.orderReference),
      ...webhookRows.map((w) => w.orderReference),
    ]),
  ];

  if (orderRefs.length > 0) {
    result.wayforpay_failure_notices = await WayforpayFailureNotice.destroy({
      where: { orderReference: { [Op.in]: orderRefs } },
    });
  } else {
    result.wayforpay_failure_notices = 0;
  }

  result.pending_wayforpay_orders = await PendingWayforpayOrder.destroy({
    where: { chatId: telegramIdStr },
  });
  result.wayforpay_webhook_events = await WayforpayWebhookEvent.destroy({
    where: { metadataChatId: telegramIdStr },
  });

  if (contact) {
    result.contact_product_access_payment_hook_manual = await ContactProductAccess.destroy({
      where: {
        contactId: contact.id,
        source: { [Op.in]: ["payment_hook", "manual_grant"] },
      },
    });
    result.contact_id = contact.id;
  } else {
    result.contact_product_access_payment_hook_manual =
      "(немає контакта для email — пропущено)";
  }

  result.paid_chat_member_state = await PaidChatMemberState.destroy({
    where: { userId: telegramIdStr },
  });
  result.paid_chat_janitor_alert_log = await PaidChatJanitorAlertLog.destroy({
    where: { telegramId: telegramIdStr },
  });
  result.email_change_logs = await EmailChangeLog.destroy({
    where: { telegramId: telegramIdStr },
  });

  await tgUser.reload();
  const snapshot = await computeKwigaRankSnapshot(tgUser, {
    bypassMonotonic: true,
  });
  await persistKwigaRankSnapshot(tgUser, snapshot);

  console.log("OK — очищено дані оплат/логів для masters debug користувача");
  console.log({
    email: tgUser.email,
    kwigaAudienceRank: snapshot.rank,
    kwigaAccessRowCount: snapshot.accessRowCount,
    destroyed: result,
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sequelize.close());
