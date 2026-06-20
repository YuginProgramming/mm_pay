export const POSTER_CREATE_POST_COMMAND = "create_post";

export const POSTER_PROMPT_CONTENT =
  "Надішліть текст, фото або відео для поста.";

export const POSTER_PROMPT_BUTTONS = "Додайте кнопки до повідомлення";

export const POSTER_IDLE_HINT =
  "Оберіть команду «Створити пост» у меню команд.";

export const POSTER_CONTENT_ALREADY_SET_HINT =
  "Контент уже задано. Щоб почати спочатку — знову «Створити пост».";

export const POSTER_UNSUPPORTED_CONTENT_HINT =
  "Цей тип повідомлення поки не підтримується. Надішліть текст, фото або відео.";

export const POSTER_BUTTON_ALREADY_ADDED = "Цю кнопку вже додано.";

export const POSTER_BUTTON_ADDED = "Кнопку додано.";

export const POSTER_PUBLISHED_MASTERS_OK = "Опубліковано у групі Masters.";

export const POSTER_PUBLISHED_PRO_OK = "Опубліковано у групі Pro.";

export const POSTER_PUBLISH_FAILED =
  "Не вдалося опублікувати повідомлення в групі.";

export const POSTER_REPLY_LABEL_ADD_CONSULTATION =
  'Додати кнопку "Записатися на консультацію"';

export const POSTER_REPLY_LABEL_ADD_ACCOUNT =
  'Додати кнопку "Долучитися до спільноти"';

export const POSTER_REPLY_LABEL_ADD_VIDEO =
  'Додати кнопку "Запис на навчання"';

export const POSTER_REPLY_LABEL_PUBLISH_MASTERS = "Опублікувати група Masters";

export const POSTER_REPLY_LABEL_PUBLISH_PRO = "Опублікувати група Pro";

import type { PosterDraftButtonKey } from "./draft-session";

export const POSTER_BUTTON_URLS: Record<
  PosterDraftButtonKey,
  { label: string; url: string }
> = {
  consultation: {
    label: "Записатися на консультацію ⤵️",
    url: "https://t.me/mm_consultation_bot",
  },
  account: {
    label: "Долучитися до спільноти ⤵️",
    url: "https://t.me/multimasking_account_bot",
  },
  video_platform: {
    label: "Запис на навчання ⤵️",
    url: "https://multimasking.kwiga.com/ua",
  },
};
