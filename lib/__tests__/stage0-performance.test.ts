import { describe, expect, it } from "vitest";
import {
  analyzeEndpointSpec,
  buildStage0PerformanceReport,
  detectHeavyFields,
  renderStage0PerformanceMarkdown,
  type Stage0PerformanceEndpointSpec,
} from "@/lib/internal-benchmark/stage0-performance";

const compactSpec: Stage0PerformanceEndpointSpec = {
  label: "compact task list",
  endpoint: "/api/booking-jobs/compact-list",
  sourcePaths: ["compact.ts"],
  owner: "task-workspace",
  suggestedNextPatch: "Keep compact.",
};

describe("Stage 0 performance measurement", () => {
  it("detects heavy fields that should not appear in compact shell endpoints", () => {
    const probe = analyzeEndpointSpec(compactSpec, process.cwd(), {
      "compact.ts": "return { id, status, steps, decisionLog, screenshots, logs };",
    });

    expect(probe.heavyFieldsDetected).toEqual(
      expect.arrayContaining(["steps", "decisionLog", "screenshots", "logs"]),
    );
    expect(probe.findings[0]).toMatchObject({
      sourcePath: "compact.ts",
      owner: "task-workspace",
    });
    expect(probe.riskLevel).toBe("high");
  });

  it("keeps compact-only read models low risk", () => {
    const probe = analyzeEndpointSpec(compactSpec, process.cwd(), {
      "compact.ts": "return { id, status, created_at, updated_at, title };",
    });

    expect(probe.heavyFieldsDetected).toEqual([]);
    expect(probe.riskLevel).toBe("low");
  });

  it("builds a no-live static report without requiring a dev server", () => {
    const report = buildStage0PerformanceReport({
      specs: [compactSpec],
      sourceOverrides: { "compact.ts": "return { id, status, messages }; " },
    });

    expect(report.mode).toBe("stage0-static");
    expect(report.totalEndpoints).toBe(1);
    expect(report.probes[0].durationEstimateMs).toBeNull();
    expect(renderStage0PerformanceMarkdown(report)).toContain("## Findings");
  });

  it("does not flag explicit compact exclusion metadata as payload risk", () => {
    const probe = analyzeEndpointSpec(compactSpec, process.cwd(), {
      "compact.ts": `return { meta: { heavy_fields_excluded: [
        "steps",
        "decisionLog",
        "screenshots",
        "logs"
      ] } };`,
    });

    expect(probe.heavyFieldsDetected).toEqual([]);
    expect(probe.riskLevel).toBe("low");
  });

  it("recognizes profile, calendar events, and provider artifacts as heavy-field risks", () => {
    expect(detectHeavyFields("profile preferences calendarEvents provider artifact")).toEqual(
      expect.arrayContaining(["profile blobs", "calendar full event payloads", "provider runtime artifacts"]),
    );
  });
});
