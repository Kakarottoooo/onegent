import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessPrivateAlphaSubmission,
  buildPrivateAlphaFixtureSeeds,
  buildPrivateAlphaIntakeReport,
  findForbiddenSignals,
  parsePrivateAlphaInput,
  renderPrivateAlphaMarkdown,
  type PrivateAlphaSubmission,
} from "@/lib/capture/private-alpha";

function baseSubmission(overrides: Partial<PrivateAlphaSubmission> = {}): PrivateAlphaSubmission {
  return {
    submissionId: "ALPHA-001",
    submittedAt: "2026-05-07T12:00:00.000Z",
    sourceType: "text",
    rawInput: "Book The Lion King in New York on June 1",
    expectedTaskType: "activity",
    userGoal: "Find one correct ticketing path and stop before final purchase.",
    travelObject: {
      type: "task_intent",
      scenario: "activity",
      constraints: { event_name: "The Lion King", city: "New York", event_date: "2026-06-01" },
    },
    safeNextAction: "Create a safe activity task and stop before checkout/payment.",
    evidenceLinks: ["docs/40-dogfood/BUG_INBOX.md#dog-005"],
    userValueSignal: "strong",
    ...overrides,
  };
}

describe("private alpha intake contract", () => {
  it("scores complete high-intent real submissions green and emits a benchmark fixture seed", () => {
    const assessment = assessPrivateAlphaSubmission(baseSubmission());

    expect(assessment.readiness).toBe("green");
    expect(assessment.verdict).toBe("ready_for_fixture");
    expect(assessment.scoreTotal).toBe(6);
    expect(assessment.canBecomeBenchmarkFixture).toBe(true);
    expect(assessment.fixtureSeed).toMatchObject({
      id: "alpha-alpha-001",
      sourceShape: "plain_natural_language",
      vertical: "activity",
      dogfoodId: "ALPHA-001",
      safeMiss: false,
    });
  });

  it("keeps synthetic samples yellow even when the score is high", () => {
    const assessment = assessPrivateAlphaSubmission(baseSubmission({ syntheticMarker: true }));
    expect(assessment.readiness).toBe("yellow");
    expect(assessment.qualityFlags).toContain("synthetic_only");
    expect(assessment.canBecomeBenchmarkFixture).toBe(true);
  });

  it("keeps missing user goal submissions in clarification", () => {
    const assessment = assessPrivateAlphaSubmission(baseSubmission({ userGoal: "" }));
    expect(assessment.readiness).toBe("red");
    expect(assessment.verdict).toBe("needs_clarification");
    expect(assessment.missingFields).toContain("userGoal");
    expect(assessment.suggestedFollowUpQuestion).toContain("What would you want");
  });

  it("rejects sensitive submissions instead of turning them into fixtures", () => {
    const assessment = assessPrivateAlphaSubmission(
      baseSubmission({
        rawInput: "Use my card 4111 1111 1111 1111 and CVV 123 to finish checkout",
      }),
    );
    expect(assessment.readiness).toBe("red");
    expect(assessment.verdict).toBe("reject_sensitive");
    expect(assessment.sensitiveContentFindings).toEqual(expect.arrayContaining(["card_number", "cvv_or_security_code"]));
    expect(assessment.recommendedOwner).toBe("product/manual-boundary");
    expect(assessment.fixtureSeed).toBeNull();
  });

  it("detects passwords, OTPs, and provider cookies as forbidden signals", () => {
    expect(findForbiddenSignals("password is abc and OTP is 123456")).toEqual(
      expect.arrayContaining(["password", "verification_code"]),
    );
    expect(findForbiddenSignals("here is my provider cookie dump")).toContain("provider_cookie");
  });

  it("parses the sample no-live fixture file and keeps private alpha non-green from synthetic data", () => {
    const fixturePath = path.join(process.cwd(), "lib/capture/__fixtures__/private-alpha-submissions.json");
    const submissions = parsePrivateAlphaInput(readFileSync(fixturePath, "utf8"), fixturePath);
    const report = buildPrivateAlphaIntakeReport(submissions);

    expect(report.summary.total).toBe(3);
    expect(report.summary.gatePass).toBe(true);
    expect(report.summary.readiness).toBe("yellow");
    expect(report.summary.green).toBe(0);
    expect(report.summary.fixtureSeedCount).toBe(3);
    expect(renderPrivateAlphaMarkdown(report)).toContain("# Private Alpha Intake Report");
  });

  it("parses markdown submissions for pasted agent/founder notes", () => {
    const submissions = parsePrivateAlphaInput(`
## ALPHA-MD-001
- submissionId: ALPHA-MD-001
- submittedAt: 2026-05-07T12:00:00.000Z
- sourceType: url
- expectedTaskType: hotel
- rawInput: https://example.com/hotel plus May 20-24 in NYC
- userGoal: Save the link and preserve the date range.
- safeNextAction: Ask for guests before creating a hotel task.
- evidenceLinks: docs/40-dogfood/CAPTURE_MVP_SEAMS.md
- userValueSignal: medium
- syntheticMarker: true
`, "alpha.md");
    expect(submissions).toHaveLength(1);
    expect(assessPrivateAlphaSubmission(submissions[0]).fixtureSeed).toMatchObject({
      sourceShape: "pasted_url",
      vertical: "hotel",
    });
  });

  it("accepts v3 source aliases and turns safe misses into benchmark seeds", () => {
    const submission = baseSubmission({
      submissionId: "ALPHA-MISS-001",
      sourceType: "screenshot_reference",
      rawInput: "screenshot reference: hotel cards in NYC with no dates visible",
      userGoal: "",
      submittedIntent: "Save the hotel options and ask for missing dates before task creation.",
      travelObject: undefined,
      travelObjectProduced: false,
      taskReadyStatus: "needs_clarification",
      safeNextAction: "Ask for check-in and check-out before creating a hotel task.",
      evidenceLink: "docs/40-dogfood/CAPTURE_MVP_SEAMS.md",
      evidenceLinks: [],
      userValueSignal: "weak",
      expectedTaskType: "hotel",
      failureReason: "missing stay dates",
      owner: "task-readiness",
    });

    const assessment = assessPrivateAlphaSubmission(submission);
    expect(assessment.readiness).toBe("yellow");
    expect(assessment.safeMiss).toBe(true);
    expect(assessment.fixtureSeed).toMatchObject({
      sourceShape: "screenshot_description",
      owner: "task-readiness",
      taskReadyStatus: "needs_clarification",
      safeMiss: true,
    });
    expect(buildPrivateAlphaFixtureSeeds([submission])).toHaveLength(1);
    expect(buildPrivateAlphaFixtureSeeds([submission], { includeSafeMisses: false })).toHaveLength(0);
  });
});
