import type { Context } from "telegraf";
import type { PosterDraftContent } from "./draft-session";

export function parsePosterDraftContent(
  message: Context["message"],
): PosterDraftContent | null {
  if (!message) {
    return null;
  }

  if ("text" in message && typeof message.text === "string") {
    const text = message.text.trim();
    if (!text) {
      return null;
    }
    return { type: "text", text };
  }

  if ("photo" in message && Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    const caption =
      "caption" in message && typeof message.caption === "string"
        ? message.caption
        : undefined;
    return { type: "photo", fileId: photo.file_id, caption };
  }

  if ("video" in message && message.video) {
    const caption =
      "caption" in message && typeof message.caption === "string"
        ? message.caption
        : undefined;
    return { type: "video", fileId: message.video.file_id, caption };
  }

  return null;
}
