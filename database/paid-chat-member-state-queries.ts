import { Op } from "sequelize";
import { PaidChatMemberState } from "./PaidChatMemberState";

const IN_CHAT_STATUSES = ["member", "restricted"] as const;

export async function upsertPaidChatMemberState(args: {
  chatId: number;
  userId: number;
  status: string;
}): Promise<void> {
  const chatId = String(args.chatId);
  const userId = String(args.userId);
  const now = new Date();
  await PaidChatMemberState.upsert({
    chatId,
    userId,
    status: args.status,
    updatedAt: now,
  });
}

/**
 * Telegram ids (рядки), які ми бачили в чаті зі статусом «ще в групі» за останніми chat_member.
 */
export async function findTrackedUsersStillInPaidChat(
  chatId: number,
): Promise<string[]> {
  const id = String(chatId);
  const rows = await PaidChatMemberState.findAll({
    where: {
      chatId: id,
      status: { [Op.in]: [...IN_CHAT_STATUSES] },
    },
    attributes: ["userId"],
  });
  return rows.map((r) => r.userId);
}
