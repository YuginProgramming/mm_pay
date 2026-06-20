import { Markup } from "telegraf";
import {
  POSTER_REPLY_LABEL_ADD_ACCOUNT,
  POSTER_REPLY_LABEL_ADD_CONSULTATION,
  POSTER_REPLY_LABEL_ADD_VIDEO,
  POSTER_REPLY_LABEL_PUBLISH_MASTERS,
  POSTER_REPLY_LABEL_PUBLISH_PRO,
  POSTER_BUTTON_URLS,
} from "./constants";
import type { PosterDraftButtonKey } from "./draft-session";

export const posterReplyKeyboard = Markup.keyboard([
  [POSTER_REPLY_LABEL_ADD_CONSULTATION],
  [POSTER_REPLY_LABEL_ADD_ACCOUNT],
  [POSTER_REPLY_LABEL_ADD_VIDEO],
  [POSTER_REPLY_LABEL_PUBLISH_MASTERS],
  [POSTER_REPLY_LABEL_PUBLISH_PRO],
]).resize();

export const posterReplyKeyboardRemove = Markup.removeKeyboard();

export function buildPosterInlineKeyboard(buttons: PosterDraftButtonKey[]) {
  if (buttons.length === 0) {
    return undefined;
  }
  return Markup.inlineKeyboard(
    buttons.map((key) => [
      Markup.button.url(POSTER_BUTTON_URLS[key].label, POSTER_BUTTON_URLS[key].url),
    ]),
  );
}
