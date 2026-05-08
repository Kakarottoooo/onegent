import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SKILL_READINESS_FIXTURES,
  buildActivitySkillReadinessReport,
  classifyActivitySkillReadinessInput,
  evaluateActivitySkillFixture,
  renderActivitySkillReadinessMarkdown,
} from "@/lib/activity-skills";

describe("Activity Provider Skill Runtime readiness", () => {
  it("keeps the five-provider Stage 0B no-live gate green while readiness stays lab-yellow", () => {
    const report = buildActivitySkillReadinessReport();

    expect(report.summary.noLiveGatePass).toBe(true);
    expect(report.summary.readiness).toBe("yellow");
    expect(report.summary.totalFixtures).toBe(145);
    expect(report.summary.passedFixtures).toBe(145);
    expect(report.summary.providerCoverage).toEqual({ registered: 5, required: 5 });
    expect(report.providerCoverage.providersWithExactEventReady).toEqual([
      "ticketmaster",
      "seatgeek",
      "eventbrite",
      "axs",
    ]);
    expect(report.summary.exactEventReadyCount).toBe(32);
    expect(report.summary.listingNeedsChoiceCount).toBe(79);
    expect(report.summary.unsafeBoundaryCount).toBe(0);
    expect(report.summary.wrongTargetCount).toBe(0);
    expect(report.summary.hostImpersonationEscapeCount).toBe(0);
    expect(report.summary.patchProposalCandidateCount).toBe(97);
    expect(report.summary.controlledLabRuns).toBe(0);
  });

  it("evaluates every readiness fixture without host impersonation or wrong-target escapes", () => {
    const results = ACTIVITY_SKILL_READINESS_FIXTURES.map(evaluateActivitySkillFixture);
    expect(results).toHaveLength(145);
    expect(results.every((result) => result.pass)).toBe(true);
    expect(results.filter((result) => result.fixture.kind === "impersonation").every((result) => !result.match.hostTrusted)).toBe(true);
    expect(results.filter((result) => result.match.exactEventReady)).toHaveLength(32);
  });

  it("routes multi-URL activity inputs to review instead of silently choosing the first link", () => {
    const match = classifyActivitySkillReadinessInput(
      "Compare Ticketmaster and SeatGeek for this show",
      [
        "https://www.ticketmaster.com/example-show/event/1A005FFF",
        "https://seatgeek.com/example-show-tickets/concert/2026-08-01-8-pm/17999999",
      ],
    );

    expect(match).toMatchObject({
      provider: "unknown",
      pageType: "multi_url_review",
      outcome: "review_required",
      safeNextAction: "review_capture",
      exactEventReady: false,
      patchProposalCandidate: false,
    });
  });

  it("renders a founder-readable readiness report", () => {
    const markdown = renderActivitySkillReadinessMarkdown(buildActivitySkillReadinessReport());
    expect(markdown).toContain("# Activity Provider Skill Readiness");
    expect(markdown).toContain("No-live gate: PASS");
    expect(markdown).toContain("Provider coverage: 5/5");
    expect(markdown).toContain("Controlled lab runs: 0/20");
    expect(markdown).toContain("## Fixture Kinds");
  });
});
