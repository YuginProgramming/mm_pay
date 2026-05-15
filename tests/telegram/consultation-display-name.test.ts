import { describe, expect, it } from "vitest";
import { isClientRelayBlockedStatus } from "../../telegram/consultation/consultation-case-status";
import { validateDisplayName } from "../../telegram/consultation/display-name-handlers";
import { buildConsultationTopicTitleFromDisplayName } from "../../telegram/consultation/topic-title";

describe("validateDisplayName", () => {
  it("accepts normal name", () => {
    expect(validateDisplayName("Марія Коваленко")).toBe("Марія Коваленко");
  });

  it("rejects too short and commands", () => {
    expect(validateDisplayName("A")).toBeNull();
    expect(validateDisplayName("/start")).toBeNull();
  });
});

describe("buildConsultationTopicTitleFromDisplayName", () => {
  it("includes telegram id prefix and display name", () => {
    expect(buildConsultationTopicTitleFromDisplayName(123, "Марія Коваленко")).toBe(
      "U123 | Марія Коваленко",
    );
  });
});

describe("isClientRelayBlockedStatus", () => {
  it("blocks onboarding statuses", () => {
    expect(isClientRelayBlockedStatus("AWAITING_DISPLAY_NAME")).toBe(true);
    expect(isClientRelayBlockedStatus("AWAITING_INTAKE")).toBe(true);
    expect(isClientRelayBlockedStatus("INTAKE_IN_PROGRESS")).toBe(true);
  });

  it("allows active conversation", () => {
    expect(isClientRelayBlockedStatus("ACTIVE_CONVERSATION")).toBe(false);
  });
});
