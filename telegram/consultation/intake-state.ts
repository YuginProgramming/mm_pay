export type IntakeStatus =
  | "IDLE"
  | "INTAKE_IN_PROGRESS"
  | "INTAKE_AWAIT_Q1"
  | "INTAKE_AWAIT_Q2"
  | "INTAKE_AWAIT_Q3"
  | "INTAKE_AWAIT_Q4_MEDIA"
  | "INTAKE_DONE";

export type IntakeStep = "Q1" | "Q2" | "Q3" | "Q4_MEDIA" | "DONE";

export type IntakeSession = {
  consultationId: string;
  telegramUserId: string;
  status: IntakeStatus;
  step: IntakeStep;
  answers: Record<string, string>;
  mediaFileIds: string[];
  updatedAtIso: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function createIntakeSession(input: {
  consultationId: string;
  telegramUserId: string;
}): IntakeSession {
  return {
    consultationId: input.consultationId,
    telegramUserId: input.telegramUserId,
    status: "INTAKE_IN_PROGRESS",
    step: "Q1",
    answers: {},
    mediaFileIds: [],
    updatedAtIso: nowIso(),
  };
}

export function markAnswer(
  session: IntakeSession,
  questionKey: string,
  answer: string,
): IntakeSession {
  return {
    ...session,
    answers: {
      ...session.answers,
      [questionKey]: answer,
    },
    updatedAtIso: nowIso(),
  };
}

export function addMediaFileId(
  session: IntakeSession,
  fileId: string,
): IntakeSession {
  return {
    ...session,
    mediaFileIds: [...session.mediaFileIds, fileId],
    updatedAtIso: nowIso(),
  };
}

export function moveToStep(
  session: IntakeSession,
  step: IntakeStep,
): IntakeSession {
  const status: IntakeStatus =
    step === "DONE" ? "INTAKE_DONE" : "INTAKE_IN_PROGRESS";
  return {
    ...session,
    step,
    status,
    updatedAtIso: nowIso(),
  };
}
