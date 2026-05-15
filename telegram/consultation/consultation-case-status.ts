export const ConsultationCaseStatus = {
  AWAITING_DISPLAY_NAME: "AWAITING_DISPLAY_NAME",
  AWAITING_INTAKE: "AWAITING_INTAKE",
  INTAKE_IN_PROGRESS: "INTAKE_IN_PROGRESS",
  ACTIVE_CONVERSATION: "ACTIVE_CONVERSATION",
  WAITING_CLIENT: "WAITING_CLIENT",
  WAITING_MANAGER: "WAITING_MANAGER",
} as const;

export type ConsultationCaseStatusValue =
  (typeof ConsultationCaseStatus)[keyof typeof ConsultationCaseStatus];

/** Client DM must not relay to manager during onboarding (name + intake). */
export function isClientRelayBlockedStatus(status: string): boolean {
  return (
    status === ConsultationCaseStatus.AWAITING_DISPLAY_NAME ||
    status === ConsultationCaseStatus.AWAITING_INTAKE ||
    status === ConsultationCaseStatus.INTAKE_IN_PROGRESS
  );
}
