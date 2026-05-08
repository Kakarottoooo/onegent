import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  buildL2RecoveryResult,
  buildStage0BActivityLabEvidenceReport,
  findStage0BActivityLabResultPaths,
  parseStage0BActivityLabResultJson,
  renderStage0BActivityLabMarkdown,
  STAGE0B_TEST_PLAN,
  TICKETMASTER_SKILL_FORGE_PLAN,
  type L2RecoveryClass,
  type L2RecoveryResult,
  type SkillPatchKind,
  type Stage0bLabProvider,
} from "@/lib/stage0b-skill-runtime";

describe("Stage 0B Activity Lab evidence ingestion", () => {
  it("scans local result.json files and summarizes success, hard stop, degraded, patch, missing evidence, and wrong-target cases", () => {
    const root = mkdtempSync(path.join(tmpdir(), "onegent-stage0b-lab-"));
    const results = [
      run("tm-success", "ticketmaster", "exact_event_ready", planUrl("tmf-08")),
      run("sg-hard-stop", "seatgeek", "user_seat_selection_required", planUrl("sg-01"), {
        hardStops: ["seat_selection_required"],
      }),
      run("tm-degraded", "ticketmaster", "provider_degraded", planUrl("tmf-15"), {
        visibleFacts: { title: "Something went wrong", notes: ["provider returned error page"] },
      }),
      run("tm-patch", "ticketmaster", "skill_patch_needed", planUrl("tmf-12"), {
        proposalKind: "selector_drift",
      }),
      run("sg-missing", "seatgeek", "insufficient_evidence", planUrl("sg-05"), {
        eventCount: 0,
        screenshots: [],
        visibleFacts: {},
      }),
      run("tm-wrong-target", "ticketmaster", "single_candidate_ready", planUrl("tmf-05"), {
        visibleFacts: {
          title: "Disney On Ice",
          candidate_count: 1,
          candidate_labels: ["Wrong target candidate: unrelated stadium tour"],
          notes: ["wrong_target_candidate observed in visible event row"],
        },
      }),
      run("tm-unsafe", "ticketmaster", "exact_event_ready", planUrl("tmf-09"), {
        hardStops: ["final_confirm_button"],
        visibleFacts: {
          title: "Kacey Musgraves",
          notes: ["unsafe_boundary_violation: final confirm button visible before ready classification"],
        },
      }),
    ];

    for (const result of results) writeResult(root, result.run_id, result);

    const report = buildStage0BActivityLabEvidenceReport({ evidenceRoot: root });

    expect(findStage0BActivityLabResultPaths(root)).toHaveLength(7);
    expect(report.summary.totalRuns).toBe(7);
    expect(report.summary.resultFiles).toBe(7);
    expect(report.summary.invalidFiles).toBe(0);
    expect(report.summary.byProvider).toEqual({ ticketmaster: 5, seatgeek: 2 });
    expect(report.summary.byPlanId["tmf-08"]).toBe(1);
    expect(report.summary.byPlanId["sg-01"]).toBe(1);
    expect(report.summary.byClassification.exact_event_ready).toBe(2);
    expect(report.summary.byClassification.user_seat_selection_required).toBe(1);
    expect(report.summary.byClassification.provider_degraded).toBe(1);
    expect(report.summary.byClassification.skill_patch_needed).toBe(1);
    expect(report.summary.byClassification.insufficient_evidence).toBe(1);
    expect(report.summary.safeOutcomesCount).toBe(4);
    expect(report.summary.unsafeBoundaryViolations).toBe(1);
    expect(report.summary.wrongTargetSignalCount).toBe(1);
    expect(report.summary.providerDegradedCount).toBe(1);
    expect(report.summary.skillPatchNeededCount).toBe(1);
    expect(report.summary.insufficientEvidenceCount).toBe(1);
    expect(report.summary.missingEvidenceCount).toBe(1);
    expect(report.patchProposals).toHaveLength(1);
    expect(report.patchProposals[0]).toMatchObject({
      runId: "tm-patch",
      owner: "browser-harness",
      action: expect.stringContaining("selector_drift"),
    });
    expect(report.topBlockersByOwner[0]).toMatchObject({
      owner: "activity-skill-runtime",
      priority: "p0",
    });
    expect(report.nextFiveActions[0]).toMatchObject({
      owner: "activity-skill-runtime",
      priority: "p0",
    });
  });

  it("accepts explicit result paths and top-level plan id metadata when available", () => {
    const root = mkdtempSync(path.join(tmpdir(), "onegent-stage0b-lab-explicit-"));
    const resultPath = writeResult(root, "explicit", run("explicit", "ticketmaster", "provider_listing_needs_choice", planUrl("tmf-01")), {
      plan_id: "manual-plan-id",
    });

    const report = buildStage0BActivityLabEvidenceReport({
      evidenceRoot: "ignored-root",
      resultPaths: [resultPath],
    });

    expect(report.evidenceRoot).toBe("ignored-root");
    expect(report.summary.totalRuns).toBe(1);
    expect(report.summary.byPlanId).toEqual({ "manual-plan-id": 1 });
    expect(report.results[0]?.planIdSource).toBe("explicit");
  });

  it("surfaces malformed result.json files without counting them as runs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "onegent-stage0b-lab-bad-"));
    const runDir = path.join(root, "bad");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "result.json"), "{not json", "utf8");

    const report = buildStage0BActivityLabEvidenceReport({ evidenceRoot: root });

    expect(report.summary.totalRuns).toBe(0);
    expect(report.summary.invalidFiles).toBe(1);
    expect(report.fileErrors[0]?.error).toContain("JSON");
  });

  it("parses a single result JSON and renders markdown for the CLI", () => {
    const result = run("markdown", "seatgeek", "safe_handoff_reached", planUrl("sg-09"));
    const parsed = parseStage0BActivityLabResultJson(JSON.stringify(result), "somewhere/result.json");
    const report = buildStage0BActivityLabEvidenceReport({ results: [parsed.result] });
    const markdown = renderStage0BActivityLabMarkdown(report);

    expect(parsed.result.classification).toBe("safe_handoff_reached");
    expect(parsed.planId).toBe("sg-09");
    expect(markdown).toContain("# Stage 0B Activity Skill Lab Evidence Report");
    expect(markdown).toContain("Safe outcomes: 1");
    expect(markdown).toContain("## Recommended Next 5 Actions");
  });
});

function run(
  runId: string,
  provider: Stage0bLabProvider,
  classification: L2RecoveryClass,
  inputUrl: string,
  overrides: {
    hardStops?: L2RecoveryResult["evidence"]["hard_stops"];
    eventCount?: number;
    screenshots?: string[];
    visibleFacts?: L2RecoveryResult["evidence"]["visible_facts"];
    proposalKind?: SkillPatchKind;
  } = {},
): L2RecoveryResult {
  return buildL2RecoveryResult({
    run_id: runId,
    started_at: "2026-05-08T10:00:00.000Z",
    finished_at: "2026-05-08T10:01:00.000Z",
    provider,
    classification,
    evidence: {
      input_url: inputUrl,
      final_url: inputUrl,
      final_page_type: inputUrl.includes("/event/") || inputUrl.includes("/2026-")
        ? "exact_event"
        : "listing",
      jsonl_path: `.stage0b-evidence/${runId}/events.jsonl`,
      event_count: overrides.eventCount ?? 4,
      screenshot_paths: overrides.screenshots ?? [`.stage0b-evidence/${runId}/screenshots/01.png`],
      visible_facts: overrides.visibleFacts ?? {
        title: runId,
        candidate_count: classification === "provider_listing_needs_choice" ? 3 : 1,
        candidate_labels: [`${runId} candidate`],
      },
      hard_stops: overrides.hardStops ?? [],
    },
    ...(classification === "skill_patch_needed"
      ? {
          skill_patch_proposal: {
            kind: overrides.proposalKind ?? "selector_drift",
            title: `${provider} selector drift`,
            observed_evidence: "candidate extraction changed shape",
            patch_target: "lib/stage0b-skill-runtime/lab-runner.ts",
            proposed_change: "Add reviewed selector fixture before rerun.",
            risk: "medium",
            evidence_event_seqs: [2],
          },
        }
      : {}),
  });
}

function writeResult(
  root: string,
  runId: string,
  result: L2RecoveryResult,
  extra: Record<string, unknown> = {},
): string {
  const runDir = path.join(root, runId);
  mkdirSync(runDir, { recursive: true });
  const resultPath = path.join(runDir, "result.json");
  writeFileSync(resultPath, JSON.stringify({ ...result, ...extra }, null, 2), "utf8");
  return resultPath;
}

function planUrl(id: string): string {
  const entry = [...STAGE0B_TEST_PLAN, ...TICKETMASTER_SKILL_FORGE_PLAN].find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing plan entry ${id}`);
  return entry.url;
}
