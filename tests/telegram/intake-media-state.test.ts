import { describe, expect, it } from "vitest";
import {
  addIntakeMedia,
  createIntakeSession,
} from "../../telegram/consultation/intake-state";

describe("intake media items", () => {
  it("stores message id and chat id for copyMessage relay", () => {
    const session = createIntakeSession({
      consultationId: "client-test",
      telegramUserId: "123",
    });
    const updated = addIntakeMedia(session, {
      kind: "photo",
      fileId: "AgACAgIAAxkBAA",
      messageId: 77,
      chatId: "123",
    });
    expect(updated.mediaItems).toHaveLength(1);
    expect(updated.mediaItems[0]).toEqual({
      kind: "photo",
      fileId: "AgACAgIAAxkBAA",
      messageId: 77,
      chatId: "123",
    });
  });
});
