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

export const POSTER_PUBLISHED_OK = "Опубліковано у групі.";

export const POSTER_PUBLISH_FAILED =
  "Не вдалося опублікувати повідомлення в групі.";

export const POSTER_REPLY_LABEL_ADD_CONSULTATION =
  'Додати кнопку "Консультація"';

export const POSTER_REPLY_LABEL_ADD_ACCOUNT =
  'Додати кнопку "Персональний кабінет"';

export const POSTER_REPLY_LABEL_ADD_VIDEO =
  'Додати кнопку "Відеоплатформа"';

export const POSTER_REPLY_LABEL_PUBLISH = "Опублікувати";

import type { PosterDraftButtonKey } from "./draft-session";

export const POSTER_BUTTON_URLS: Record<
  PosterDraftButtonKey,
  { label: string; url: string }
> = {
  consultation: {
    label: "Консультація",
    url: "https://t.me/mm_consultation_bot",
  },
  account: {
    label: "Персональний кабінет",
    url: "https://t.me/multimasking_account_bot",
  },
  video_platform: {
    label: "Відеоплатформа",
    url: "https://multimasking.kwiga.com/ua",
  },
};
