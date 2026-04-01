import { Context } from "telegraf";
import { TelegramUser } from "../database/TelegramUser";

export type StartContext = Context & {
  from: NonNullable<Context["from"]>;
};

export async function trackTelegramUser(ctx: StartContext): Promise<{
  user: TelegramUser;
  isNew: boolean;
}> {
  const from = ctx.from;
  const telegramId = String(from.id);

  const [user, created] = await TelegramUser.findOrCreate({
    where: { telegramId },
    defaults: {
      telegramId,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
      isBot: from.is_bot ?? false,
      isPremium: (from as any).is_premium ?? false,
      addedToAttachmentMenu: (from as any).added_to_attachment_menu ?? false,
      allowsWriteToPm: true,
      lastActivity: new Date(),
      totalInteractions: 1,
      isActive: true,
      awaitingEmail: false,
      emailChangeFrom: null,
      preferences: null,
    },
  });

  if (!created) {
    user.username = from.username ?? user.username;
    user.firstName = from.first_name ?? user.firstName;
    user.lastName = from.last_name ?? user.lastName;
    user.languageCode = from.language_code ?? user.languageCode;
    user.isBot = from.is_bot ?? user.isBot;
    user.isPremium = (from as any).is_premium ?? user.isPremium;
    user.addedToAttachmentMenu =
      (from as any).added_to_attachment_menu ?? user.addedToAttachmentMenu;
    user.lastActivity = new Date();
    user.totalInteractions = (user.totalInteractions ?? 0) + 1;
    user.isActive = true;
    await user.save();
  }

  return { user, isNew: created };
}

export async function getTelegramUserFromContext(
  ctx: Context,
): Promise<TelegramUser | null> {
  if (!ctx.from) {
    return null;
  }

  const telegramId = String(ctx.from.id);
  return TelegramUser.findOne({ where: { telegramId } });
}
