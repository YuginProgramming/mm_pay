import type { Context } from "telegraf";

/** Лише приватний чат з ботом; у групах / супергрупах / каналах — не відповідати вмістом бота. */
export function isPrivateChat(ctx: Pick<Context, "chat">): boolean {
  return ctx.chat?.type === "private";
}
