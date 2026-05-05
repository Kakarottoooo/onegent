import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analyzeProviderClosureWarRoomBundle,
  findUnsafeBoundaryFindings,
  formatProviderClosureDemoVerdictMarkdown,
  formatProviderClosureWarRoomReportMarkdown,
  PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES,
  type ProviderClosureWarRoomBundle,
} from "@/lib/provider-closure";
import {
  analyzeProviderClosureWarRoomFile,
  parseProviderClosureWarRoomCliArgs,
  runProviderClosureWarRoomCli,
} from "@/scripts/provider-closure-war-room";

const GENERATED_AT = "2026-05-04T22:00:00.000Z";

describe("provider closure war room", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "provider-war-room-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("covers every major terminal verdict across all three verticals", () => {
    const byVertical = new Map<string, Set<string>>();

    for (const fixture of PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES) {
      const result = analyzeProviderClosureWarRoomBundle(
        fixture,
        fixture.vertical,
        { generatedAt: GENERATED_AT },
      );

      expect(result.verdict, fixture.fixtureId).toBe(fixture.expectedVerdict);
      expect(result.evidence.completeness.hasDbRow, fixture.fixtureId).toBe(true);
      expect(result.evidence.completeness.hasWorkerLogExcerpt, fixture.fixtureId).toBe(true);
      expect(result.evidence.screenshotPaths.length, fixture.fixtureId).toBeGreaterThan(0);
      expect(result.nextSingleAction.length, fixture.fixtureId).toBeGreaterThan(0);
      expect(result.regressionChecklist.length, fixture.fixtureId).toBeGreaterThanOrEqual(4);

      const set = byVertical.get(fixture.vertical) ?? new Set<string>();
      set.add(result.verdict);
      byVertical.set(fixture.vertical, set);
    }

    for (const vertical of ["restaurant", "flight", "hotel"]) {
      expect(Array.from(byVertical.get(vertical) ?? []), vertical).toEqual(
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

  it("gives unsafe boundaries highest classification precedence", () => {
    const safeFixture = fixture("flight", "live_closed_safe_boundary");
    const result = analyzeProviderClosureWarRoomBundle(
      {
        ...safeFixture,
        artifact: {
          ...safeFixture.artifact,
          workerLogExcerpt:
            "Checkout reached; safe handoff; automation submitted final purchase confirmation step.",
        },
      },
      "flight",
      { generatedAt: GENERATED_AT },
    );

    expect(result.verdict).toBe("unsafe_or_disallowed_boundary");
    expect(result.unsafeFindings[0]?.label).toMatch(/final|payment|purchase/i);
    expect(result.nextSingleAction).toContain("safety");
  });

  it("treats missing or insufficient evidence as not live verified", () => {
    const result = analyzeProviderClosureWarRoomBundle(
      {
        schemaVersion: 1,
        vertical: "restaurant",
        synthetic: true,
        fixtureId: "fixture-war-room-missing-evidence",
        liveAttempt: true,
        evidenceCapturedAt: "2026-05-04T20:30:00.000Z",
        notes: ["Synthetic missing evidence fixture."],
      },
      "restaurant",
      { generatedAt: GENERATED_AT },
    );

    expect(result.verdict).toBe("not_live_verified");
    expect(result.evidence.completeness.hasMinimumLiveEvidence).toBe(false);
    expect(result.rootCause).toContain("lacks");
  });

  it("treats stale evidence as not live verified", () => {
    const result = analyzeProviderClosureWarRoomBundle(
      fixture("restaurant", "not_live_verified", "stale"),
      "restaurant",
      { generatedAt: GENERATED_AT },
    );

    expect(result.verdict).toBe("not_live_verified");
    expect(result.evidence.freshness.reason).toContain("stale");
  });

  it("does not overclaim demo readiness from synthetic safe fixtures", () => {
    const fixtureResult = analyzeProviderClosureWarRoomBundle(
      fixture("hotel", "live_closed_safe_boundary"),
      "hotel",
      { generatedAt: GENERATED_AT },
    );
    expect(fixtureResult.verdict).toBe("live_closed_safe_boundary");
    expect(fixtureResult.demoReadiness.canClaimVertical).toBe(false);
    expect(fixtureResult.demoReadiness.reason).toContain("synthetic");

    const liveResult = analyzeProviderClosureWarRoomBundle(
      makeNonSynthetic(fixture("hotel", "live_closed_safe_boundary")),
      "hotel",
      { generatedAt: GENERATED_AT },
    );
    expect(liveResult.demoReadiness.canClaimVertical).toBe(true);
  });

  it("renders a markdown report with the closed-loop operator fields", () => {
    const result = analyzeProviderClosureWarRoomBundle(
      fixture("flight", "live_blocked_selector_or_dom"),
      "flight",
      { generatedAt: GENERATED_AT },
    );
    const markdown = formatProviderClosureWarRoomReportMarkdown(result);

    expect(markdown).toContain("# Provider Closure War Room Report");
    expect(markdown).toContain("## Exact Terminal State");
    expect(markdown).toContain("## Evidence Files");
    expect(markdown).toContain("## Root Cause");
    expect(markdown).toContain("## Next Single Action");
    expect(markdown).toContain("## Regression Checklist");
    expect(markdown).toContain("## Demo Readiness");
  });

  it("parses and runs the no-live CLI commands", async () => {
    expect(
      parseProviderClosureWarRoomCliArgs([
        "preflight",
        "--vertical",
        "restaurant",
      ]),
    ).toEqual({ command: "preflight", vertical: "restaurant" });
    expect(
      parseProviderClosureWarRoomCliArgs([
        "analyze",
        "--vertical=flight",
        "--bundle",
        "bundle.json",
        "--markdown",
      ]),
    ).toMatchObject({
      command: "analyze",
      vertical: "flight",
      bundlePath: "bundle.json",
      markdown: true,
    });
    expect(parseProviderClosureWarRoomCliArgs(["summarize", "--all"])).toEqual({
      command: "summarize",
      all: true,
    });

    const bundlePath = await writeJson(
      "flight-war-room.json",
      fixture("flight", "live_blocked_selector_or_dom"),
    );
    const result = await analyzeProviderClosureWarRoomFile(
      {
        vertical: "flight",
        bundlePath,
      },
      { generatedAt: GENERATED_AT },
    );
    expect(result.verdict).toBe("live_blocked_selector_or_dom");

    const markdownOutput: string[] = [];
    expect(
      await runProviderClosureWarRoomCli(
        [
          "analyze",
          "--vertical",
          "flight",
          "--bundle",
          bundlePath,
          "--markdown",
        ],
        {
          generatedAt: GENERATED_AT,
          writeOutput: (text) => markdownOutput.push(text),
          writeError: () => {
            throw new Error("should not write error");
          },
        },
      ),
    ).toBe(0);
    expect(markdownOutput.join("\n")).toContain(
      "# Provider Closure War Room Report",
    );

    const jsonOutput: string[] = [];
    expect(
      await runProviderClosureWarRoomCli(
        ["analyze", "--vertical", "flight", "--bundle", bundlePath],
        {
          generatedAt: GENERATED_AT,
          writeOutput: (text) => jsonOutput.push(text),
          writeError: () => {
            throw new Error("should not write error");
          },
        },
      ),
    ).toBe(0);
    const parsed = JSON.parse(jsonOutput.join("\n"));
    expect(parsed.evidence.workerLogExcerpt).toMatch(/^\[present:/);
    expect(JSON.stringify(parsed)).not.toContain("Flight-card DOM scan failed");
  });

  it("CLI missing bundle handling is clean and non-live", async () => {
    const errors: string[] = [];
    const exitCode = await runProviderClosureWarRoomCli(
      ["analyze", "--vertical", "hotel", "--bundle", "missing.json"],
      {
        cwd: tmpRoot,
        writeOutput: () => {
          throw new Error("should not write output");
        },
        writeError: (text) => errors.push(text),
      },
    );

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("War-room bundle not found");
    expect(errors.join("\n")).toContain("never starts");
  });

  it("demo verdict refuses synthetic bundled fixtures", () => {
    const results = PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES.map((item) =>
      analyzeProviderClosureWarRoomBundle(item, item.vertical, {
        generatedAt: GENERATED_AT,
      }),
    );
    const markdown = formatProviderClosureDemoVerdictMarkdown(results);

    expect(markdown).toContain("Overall demo claim: `not_ready`");
    expect(markdown).toContain("restaurant**: not claimable");
    expect(markdown).toContain("flight**: not claimable");
    expect(markdown).toContain("hotel**: not claimable");
  });

  it("detects disallowed boundary language without requiring secret values", () => {
    const findings = findUnsafeBoundaryFindings(
      "worker clicked final booking button after reaching checkout",
    );
    expect(findings.map((finding) => finding.label)).toContain(
      "final booking/reservation confirmation clicked",
    );
  });

  async function writeJson(name: string, value: unknown): Promise<string> {
    const file = path.join(tmpRoot, name);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return file;
  }
});

function fixture(
  vertical: "restaurant" | "flight" | "hotel",
  verdict:
    | "live_closed_safe_boundary"
    | "live_blocked_provider_or_network"
    | "live_blocked_selector_or_dom"
    | "live_blocked_model_or_env"
    | "not_live_verified"
    | "unsafe_or_disallowed_boundary",
  variant?: "stale",
): ProviderClosureWarRoomBundle {
  const match = PROVIDER_CLOSURE_WAR_ROOM_SYNTHETIC_FIXTURES.find(
    (item) =>
      item.vertical === vertical &&
      item.expectedVerdict === verdict &&
      (!variant || item.fixtureId.includes(variant)),
  );
  if (!match) {
    throw new Error(`Missing fixture for ${vertical} ${verdict} ${variant ?? ""}`);
  }
  return match;
}

function makeNonSynthetic(
  bundle: ProviderClosureWarRoomBundle,
): ProviderClosureWarRoomBundle {
  const artifact = bundle.artifact
    ? {
        ...bundle.artifact,
        synthetic: false,
      }
    : null;
  return {
    ...bundle,
    synthetic: false,
    liveAttempt: true,
    artifact,
  };
}
