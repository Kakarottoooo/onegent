import { describe, expect, it } from "vitest";
import {
  assessPrivateAlphaSubmission,
  findForbiddenSignals,
  type PrivateAlphaSubmission,
} from "@/lib/capture/private-alpha";

function baseSubmission(overrides: Partial<PrivateAlphaSubmission> = {}): PrivateAlphaSubmission {
  return {
    id: "ALPHA-001",
    syntheticMarker: true,
    submittedAt: "2026-05-07T12:00:00.000Z",
    sourceType: "raw_text",
    rawInput: "Book The Lion King in New York on June 1",
    expectedTaskType: "activity",
    userGoal: "Find one correct ticketing path and stop before final purchase.",
    wouldTrustOnegentToContinue: true,
    wouldPay: true,
    ...overrides,
  };
}

describe("private alpha intake contract", () => {
  it("scores complete high-intent submissions and emits a benchmark fixture seed", () => {
    const assessment = assessPrivateAlphaSubmission(baseSubmission(), {
      understood: true,
      travelObjectCreated: true,
      taskReady: true,
      safeNextAction: true,
      evidenceComplete: true,
    });

    expect(assessment.verdict).toBe("ready_for_fixture");
    expect(assessment.scoreTotal).toBe(6);
    expect(assessment.fixtureSeed).toMatchObject({
      id: "alpha-ALPHA-001",
      sourceShape: "plain_natural_language",
      vertical: "activity",
      dogfoodId: "ALPHA-001",
    });
  });

  it("keeps missing user goal submissions in clarification", () => {
    const assessment = assessPrivateAlphaSubmission(baseSubmission({ userGoal: "" }));
    expect(assessment.verdict).toBe("needs_clarification");
    expect(assessment.missingFields).toContain("userGoal");
    expect(assessment.fixtureSeed).toBeNull();
  });

  it("rejects sensitive submissions instead of turning them into fixtures", () => {
    const assessment = assessPrivateAlphaSubmission(
      baseSubmission({
        rawInput: "Use my card 4111 1111 1111 1111 and CVV 123 to finish checkout",
      }),
    );
    expect(assessment.verdict).toBe("reject_sensitive");
    expect(assessment.forbiddenSignals).toEqual(expect.arrayContaining(["card_number", "cvv_or_security_code"]));
    expect(assessment.suggestedOwner).toBe("product/manual-boundary");
    expect(assessment.fixtureSeed).toBeNull();
  });

  it("detects passwords, OTPs, and provider cookies as forbidden signals", () => {
    expect(findForbiddenSignals("password is abc and OTP is 123456")).toEqual(
      expect.arrayContaining(["password", "verification_code"]),
    );
    expect(findForbiddenSignals("here is my provider cookie dump")).toContain("provider_cookie");
  });
});
