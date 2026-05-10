import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES,
} from "@/lib/provider-closure";
import { createArtifactBundleTemplate } from "@/scripts/create-artifact-bundle-template";

const ROOT = process.cwd();

const WAR_ROOM_REPORTS = [
  "docs/90-archive/provider-debug/provider-closure-war-room/RESTAURANT_SYNTHETIC_WAR_ROOM_REPORT.md",
  "docs/90-archive/provider-debug/provider-closure-war-room/FLIGHT_SYNTHETIC_WAR_ROOM_REPORT.md",
  "docs/90-archive/provider-debug/provider-closure-war-room/HOTEL_SYNTHETIC_WAR_ROOM_REPORT.md",
] as const;

describe("provider closure war room static guards", () => {
  it("keeps controlled retry or runbook docs for all three verticals", () => {
    const docs = [
      "docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
      "docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
    ];

    for (const relPath of docs) {
      expect(existsSync(path.join(ROOT, relPath)), relPath).toBe(true);
    }
  });

  it("documents the war-room verdict taxonomy and model/env 500 handling", () => {
    const protocol = read(
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
    );

    for (const verdict of [
      "live_closed_safe_boundary",
      "live_blocked_provider_or_network",
      "live_blocked_selector_or_dom",
      "live_blocked_model_or_env",
      "not_live_verified",
      "unsafe_or_disallowed_boundary",
    ]) {
      expect(protocol).toContain(verdict);
    }
    expect(protocol).toContain("OpenAI Responses API 500");
    expect(protocol).toMatch(/model\/env transient/i);
  });

  it("keeps artifact templates available for restaurant, flight, and hotel", () => {
    const restaurant = createArtifactBundleTemplate("restaurant");
    const expedia = createArtifactBundleTemplate("expedia");
    const hotel = createArtifactBundleTemplate("hotel");

    expect(restaurant.templateKind).toBe("restaurant");
    expect(expedia.templateKind).toBe("expedia");
    expect(hotel.templateKind).toBe("hotel");
    expect(JSON.stringify(restaurant)).toContain("workerLogExcerpt");
    expect(JSON.stringify(expedia)).toContain("screenshotPaths");
    expect(JSON.stringify(hotel)).toContain("liveSnapshotPaths");
  });

  it("keeps war-room synthetic fixtures for every vertical and verdict", () => {
    for (const vertical of ["restaurant", "flight", "hotel"] as const) {
      const fixtures = PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES.filter(
        (fixture) => fixture.vertical === vertical,
      );
      expect(fixtures.length, vertical).toBeGreaterThanOrEqual(6);
      expect(fixtures.map((fixture) => fixture.expectedVerdict), vertical).toEqual(
        expect.arrayContaining([
          "live_closed_safe_boundary",
          "live_blocked_provider_or_network",
          "live_blocked_selector_or_dom",
          "live_blocked_model_or_env",
          "not_live_verified",
          "unsafe_or_disallowed_boundary",
        ]),
      );
    }
  });

  it("keeps one markdown war-room report per vertical", () => {
    for (const relPath of WAR_ROOM_REPORTS) {
      expect(existsSync(path.join(ROOT, relPath)), relPath).toBe(true);
      const markdown = read(relPath);
      expect(markdown).toContain("# Provider Closure War Room Report");
      expect(markdown).toContain("## Exact Terminal State");
      expect(markdown).toContain("## Next Single Action");
      expect(markdown).toContain("Cannot claim from a synthetic no-live fixture");
    }
  });

  it("keeps operator docs free of mutating live controls", () => {
    const docs = [
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
      ...WAR_ROOM_REPORTS,
      "docs/10-coordination/goal.md",
    ];

    for (const relPath of docs) {
      if (!existsSync(path.join(ROOT, relPath))) continue;
      const badLines = read(relPath)
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => hasMutatingLiveControl(line))
        .filter(({ line }) => !isHardStopLine(line));

      expect(badLines, relPath).toEqual([]);
    }
  });
});

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function hasMutatingLiveControl(line: string): boolean {
  return [
    /<button\b/i,
    /\bon(?:Click|Submit)\s*=/i,
    /\b(run|start|retry|rerun|re-run)\s+(live|provider|booking|controlled retry)\b/i,
    /\b(live|provider|booking|controlled retry)\s+(run|retry)\s+button\b/i,
    /\bone[-\s]?click\s+live\b/i,
  ].some((pattern) => pattern.test(line));
}

function isHardStopLine(line: string): boolean {
  return /\b(do not|never|no\s+|not\s+|without|forbidden|must not|does not|should not|cannot|only copy|no-live|hard stop|is not involved|does not authorize|never starts|no live|read-only)\b/i.test(
    line,
  );
}
