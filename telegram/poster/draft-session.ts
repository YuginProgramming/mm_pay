export type PosterDraftButtonKey =
  | "consultation"
  | "account"
  | "video_platform";

export type PosterDraftContent =
  | { type: "text"; text: string }
  | { type: "photo"; fileId: string; caption?: string }
  | { type: "video"; fileId: string; caption?: string };

export type PosterDraftState = "idle" | "awaiting_content" | "awaiting_buttons";

export type PosterDraft = {
  state: PosterDraftState;
  content?: PosterDraftContent;
  buttons: PosterDraftButtonKey[];
};

const sessions = new Map<number, PosterDraft>();

function emptyDraft(): PosterDraft {
  return { state: "idle", buttons: [] };
}

export function getPosterDraft(telegramUserId: number): PosterDraft {
  return sessions.get(telegramUserId) ?? emptyDraft();
}

export function startPosterDraft(telegramUserId: number): PosterDraft {
  const draft: PosterDraft = {
    state: "awaiting_content",
    buttons: [],
  };
  sessions.set(telegramUserId, draft);
  return draft;
}

export function setPosterDraftContent(
  telegramUserId: number,
  content: PosterDraftContent,
): PosterDraft {
  const draft = getPosterDraft(telegramUserId);
  draft.content = content;
  draft.state = "awaiting_buttons";
  sessions.set(telegramUserId, draft);
  return draft;
}

export function addPosterDraftButton(
  telegramUserId: number,
  button: PosterDraftButtonKey,
): PosterDraft {
  const draft = getPosterDraft(telegramUserId);
  if (!draft.buttons.includes(button)) {
    draft.buttons.push(button);
  }
  sessions.set(telegramUserId, draft);
  return draft;
}

export function clearPosterDraft(telegramUserId: number): void {
  sessions.delete(telegramUserId);
}
