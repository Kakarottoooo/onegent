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
      severity: "high",
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
    expect(renderStage0PerformanceMarkdown(report)).toContain("| Endpoint | Severity | Field |");
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

  it("recognizes profile blobs, calendar events, and provider artifacts as heavy-field risks", () => {
    expect(detectHeavyFields("bookingProfile preferences calendarEvents providerRuntime artifactPayload")).toEqual(
      expect.arrayContaining(["profile blobs", "calendar full event payloads", "provider runtime artifacts"]),
    );
  });

  it("does not treat generic feedback events as calendar payloads", () => {
    expect(detectHeavyFields(`
      const events = await getAgentFeedbackEvents(sessionId, 200);
      return { totalEvents: events.length, eventCount: events.length };
    `)).not.toContain("calendar full event payloads");
  });

  it("does not count compact endpoint exclusion metadata as returned heavy payload", () => {
    expect(detectHeavyFields(`
      return {
        jobs,
        meta: {
          heavy_fields_excluded: ["steps", "decisionLog", "screenshots", "logs", "profile"]
        }
      };
    `)).toEqual([]);
  });

  it("does not treat compact provider labels as provider runtime artifacts", () => {
    expect(detectHeavyFields("return { id, status, provider, scenario, primary_step_label };")).toEqual([]);
  });

  it("keeps the Stage 0 memory compact summary below medium risk", () => {
    const report = buildStage0PerformanceReport();
    const memoryProbe = report.probes.find((probe) => probe.owner === "memory");

    expect(memoryProbe?.endpoint).toBe("/api/memory/compact");
    expect(memoryProbe?.riskLevel).toBe("low");
    expect(memoryProbe?.heavyFieldsDetected).toEqual([]);
    expect(report.highRiskEndpoints).toBe(0);
    expect(report.mediumRiskEndpoints).toBe(0);
  });

  it("catches heavy profile, event, artifact, log, and screenshot leaks in compact routes", () => {
    const probe = analyzeEndpointSpec(compactSpec, process.cwd(), {
      "compact.ts": `
        return {
          steps,
          decisionLog,
          screenshots,
          logs,
          fullProfile,
          calendarEvents,
          artifactPayload
        };
      `,
    });

    expect(probe.riskLevel).toBe("high");
    expect(probe.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "steps", severity: "high" }),
        expect.objectContaining({ field: "decisionLog", severity: "high" }),
        expect.objectContaining({ field: "screenshots", severity: "high" }),
        expect.objectContaining({ field: "logs", severity: "high" }),
        expect.objectContaining({ field: "profile blobs", severity: "medium" }),
        expect.objectContaining({ field: "calendar full event payloads", severity: "medium" }),
        expect.objectContaining({ field: "provider runtime artifacts", severity: "medium" }),
      ]),
    );
  });
});
