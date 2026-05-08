import { describe, expect, it } from "vitest";
import {
  buildStage0OperatorReport,
  renderStage0OperatorMarkdown,
} from "@/lib/internal-benchmark/stage0-operator-report";

describe("Stage 0 operator report", () => {
  it("combines capture, internal, and layered no-live benchmark summaries", () => {
    const report = buildStage0OperatorReport({
      captureCount: 200,
      internalCount: 200,
      layeredCount: 50,
    });

    expect(report.capture.summary.total).toBe(200);
    expect(report.internalBenchmark.summary.total).toBe(200);
    expect(report.layeredBenchmark.summary.total).toBe(50);
    expect(report.activitySkillReadiness.summary.totalFixtures).toBe(145);
    expect(report.activitySkillReadiness.summary.noLiveGatePass).toBe(true);
    expect(report.activitySkillReadiness.summary.controlledLabRuns).toBe(0);
    expect(report.privateAlpha.summary.total).toBe(3);
    expect(report.agentIntake.summary.total).toBe(5);
    expect(report.performance.totalEndpoints).toBeGreaterThan(0);
    expect(report.capture.summary.routingMismatchCount).toBe(0);
    expect(report.verdict).toBe("yellow");
    expect(report.verdictReason).toContain("private alpha");
    expect(report.capture.artifactGapClosures.every((closure) => closure.outcome === "closed")).toBe(true);
    expect(report.topBlockersByOwner.length).toBeGreaterThan(0);
    expect(report.nextFiveActions).toHaveLength(5);
    expect(report.topNextActions.length).toBeGreaterThan(0);
    expect(report.topNextActions[0].owner).toBeTruthy();
  });

  it("keeps private-alpha green blocked by evidence rather than docs or fixtures", () => {
    const report = buildStage0OperatorReport({ captureCount: 50, internalCount: 50, layeredCount: 20 });
    expect(report.verdict).not.toBe("green");
    expect(report.privateAlpha.summary.readiness).toBe("yellow");
    expect(report.notes.join(" ")).toContain("green requires real private-alpha evidence");
  });

  it("renders founder-readable markdown with blockers and owners", () => {
    const markdown = renderStage0OperatorMarkdown(
      buildStage0OperatorReport({ captureCount: 50, internalCount: 50, layeredCount: 20 }),
    );
    expect(markdown).toContain("# Stage 0 Operator Report");
    expect(markdown).toContain("## Capture Benchmark");
    expect(markdown).toContain("## Activity Skill Runtime");
    expect(markdown).toContain("## Private Alpha Intake");
    expect(markdown).toContain("## Agent Intake");
    expect(markdown).toContain("## Performance Measurement");
    expect(markdown).toContain("## Top Blockers By Owner");
    expect(markdown).toContain("## Next 5 Actions");
    expect(markdown).toContain("## Top 10 Next Engineering Actions");
    expect(markdown).toContain("Dogfood-only");
  });
});
