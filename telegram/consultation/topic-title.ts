type TopicTitleInput = {
  telegramId: string | number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function compactSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLen: number): string {
  return value.length <= maxLen ? value : value.slice(0, maxLen);
}

export function buildConsultationTopicTitle(input: TopicTitleInput): string {
  const tgId = String(input.telegramId).trim();
  const prefix = `U${tgId}`;

  const first = clean(input.firstName);
  const last = clean(input.lastName);
  const username = clean(input.username).replace(/^@+/, "");

  let identity = "";
  if (first || last) {
    identity = compactSpaces(`${first} ${last}`);
  } else if (username) {
    identity = `@${username}`;
  } else {
    identity = `tg_${tgId}`;
  }

  // Telegram topic names have length limits; keep safe cap.
  return truncate(`${prefix} | ${identity}`, 120);
}
