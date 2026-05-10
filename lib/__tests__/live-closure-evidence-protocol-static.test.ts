import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARTIFACT_BUNDLE_TEMPLATE_KINDS,
  createArtifactBundleTemplate,
} from "@/scripts/create-artifact-bundle-template";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("live closure evidence protocol static guards", () => {
  it("keeps controlled retry and evidence runbooks for every closure vertical", () => {
    const requiredDocs = [
      {
        vertical: "restaurant",
        path: "docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
        terms: ["Resy", "docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md"],
      },
      {
        vertical: "restaurant evidence",
        path: "docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
        terms: ["Resy", "OpenTable", "analyze-restaurant-artifact.ts"],
      },
      {
        vertical: "flight",
        path: "docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
        terms: ["Expedia", "controlled retry", "analyze-expedia-retry-artifact"],
      },
      {
        vertical: "hotel",
        path: "docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
        terms: ["Booking.com", "controlled retry", "analyze-provider-artifact.ts --kind hotel"],
      },
      {
        vertical: "unified closure",
        path: "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
        terms: ["restaurant", "flight", "hotel"],
      },
    ];

    for (const doc of requiredDocs) {
      expect(existsSync(path.join(ROOT, doc.path)), doc.path).toBe(true);
      const text = read(doc.path);
      for (const term of doc.terms) {
        expect(text, `${doc.vertical} doc must mention ${term}`).toContain(term);
      }
    }
  });

  it("keeps operator evidence docs free of mutating live controls", () => {
    const operatorDocs = [
      "docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md",
      "docs/90-archive/phase2-product-areas/LIVE_ARTIFACT_BRIDGE.md",
      "docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
      "docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
      "docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md",
    ];

    for (const relPath of operatorDocs) {
      const badLines = read(relPath)
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => hasMutatingLiveControl(line))
        .filter(({ line }) => !isHardStopLine(line));

      expect(badLines, relPath).toEqual([]);
    }

    const protocol = read("docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md");
    expect(protocol).toContain("Do not add run/retry/live buttons");
  });

  it("keeps artifact templates for restaurant, flight, and hotel evidence", () => {
    expect(ARTIFACT_BUNDLE_TEMPLATE_KINDS).toEqual([
      "restaurant",
      "expedia",
      "hotel",
    ]);

    const restaurant = createArtifactBundleTemplate("restaurant");
    const flight = createArtifactBundleTemplate("expedia");
    const hotel = createArtifactBundleTemplate("hotel");

    expect(restaurant).toMatchObject({
      synthetic: true,
      templateKind: "restaurant",
    });
    expect(getJob(flight)).toMatchObject({
      provider: "<provider: expedia>",
      scenario: "flight",
    });
    expect(hotel).toMatchObject({
      synthetic: true,
      templateKind: "hotel",
    });
  });

  it("documents OpenAI Responses API 500 as model/env transient, not provider 5xx", () => {
    const protocol = read("docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md");

    expect(protocol).toContain("OpenAI Responses API 500");
    expect(protocol).toContain("model/env transient");
    expect(protocol).toMatch(/not as a\s+provider 5xx/);
  });
});

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
  return /\b(do not|never|no\s+|not\s+|without|forbidden|must not|does not|should not|cannot|only copy|no-live|hard stop|is not involved|does not authorize)\b/i.test(
    line,
  );
}

function getJob(value: Record<string, unknown>): Record<string, unknown> {
  const job = value.job;
  expect(typeof job).toBe("object");
  expect(job).not.toBeNull();
  expect(Array.isArray(job)).toBe(false);
  return job as Record<string, unknown>;
}
