import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";

import {
  buildL2RecoveryResult,
  isSafeOutcome,
  safeNextActionFor,
  STAGE0B_HARD_STOPS,
} from "./l2-recovery-result";
import { getAllStage0BLabPlanEntries } from "./plan-registry";
import type {
  L2EvidenceBundle,
  L2RecoveryClass,
  L2RecoveryResult,
  L2SafeNextAction,
  LabHardStopReason,
  LabVisibleFacts,
  SkillPatchKind,
  SkillPatchProposal,
  Stage0bLabProvider,
} from "./types";

export type Stage0BActivityLabOwner =
  | "activity-skill-runtime"
  | "browser-harness"
  | "codex"
  | "operator"
  | "provider-runtime";

export type Stage0BActivityLabPriority = "p0" | "p1" | "p2";

export type Stage0BActivityLabPlanIdSource =
  | "explicit"
  | "screenshot_path"
  | "input_url"
  | "source_path";

export interface ParsedStage0BActivityLabResult {
  result: L2RecoveryResult;
  sourcePath?: string;
  planId?: string;
  planIdSource?: Stage0BActivityLabPlanIdSource;
  evidenceIssues: string[];
  unsafeBoundaryViolation: boolean;
  wrongTargetSignals: string[];
}

export interface Stage0BActivityLabFileError {
  path: string;
  error: string;
}

export interface Stage0BActivityLabPatchProposalSummary {
  runId: string;
  provider: Stage0bLabProvider;
  planId?: string;
  sourcePath?: string;
  kind: SkillPatchKind;
  risk: SkillPatchProposal["risk"];
  title: string;
  patchTarget: string;
  owner: Stage0BActivityLabOwner;
  action: string;
  evidenceEventSeqs: number[];
}

export interface Stage0BActivityLabBlocker {
  owner: Stage0BActivityLabOwner;
  priority: Stage0BActivityLabPriority;
  blocker: string;
  evidence: string;
}

export interface Stage0BActivityLabNextAction {
  owner: Stage0BActivityLabOwner;
  priority: Stage0BActivityLabPriority;
  action: string;
  reason: string;
}

export interface Stage0BActivityLabSummary {
  totalRuns: number;
  resultFiles: number;
  invalidFiles: number;
  byProvider: Record<Stage0bLabProvider, number>;
  byPlanId: Record<string, number>;
  byClassification: Record<L2RecoveryClass, number>;
  safeOutcomesCount: number;
  unsafeBoundaryViolations: number;
  wrongTargetSignalCount: number;
  providerDegradedCount: number;
  skillPatchNeededCount: number;
  insufficientEvidenceCount: number;
  missingEvidenceCount: number;
  patchProposalCount: number;
}

export interface Stage0BActivityLabReport {
  generatedAt: string;
  evidenceRoot: string;
  summary: Stage0BActivityLabSummary;
  results: ParsedStage0BActivityLabResult[];
  fileErrors: Stage0BActivityLabFileError[];
  patchProposals: Stage0BActivityLabPatchProposalSummary[];
  topBlockersByOwner: Stage0BActivityLabBlocker[];
  nextFiveActions: Stage0BActivityLabNextAction[];
  notes: string[];
}

export interface BuildStage0BActivityLabReportInput {
  evidenceRoot?: string;
  resultPaths?: string[];
  results?: L2RecoveryResult[];
  generatedAt?: string;
}

const GENERATED_AT = "2026-05-07T12:00:00.000Z";
const DEFAULT_EVIDENCE_ROOT = ".stage0b-evidence";
const LAB_RUN_TARGET = 50;

const SAFE_LAB_CLASSES: ReadonlySet<L2RecoveryClass> = new Set([
  "provider_listing_needs_choice",
  "single_candidate_ready",
  "exact_event_ready",
  "user_seat_selection_required",
  "safe_handoff_reached",
  "account_session_required",
  "payment_or_final_action_required",
]);

const ALL_CLASSIFICATIONS: L2RecoveryClass[] = [
  "exact_event_ready",
  "provider_listing_needs_choice",
  "single_candidate_ready",
  "safe_handoff_reached",
  "user_seat_selection_required",
  "account_session_required",
  "payment_or_final_action_required",
  "provider_degraded",
  "insufficient_evidence",
  "skill_patch_needed",
];

export function buildStage0BActivityLabEvidenceReport(
  input: BuildStage0BActivityLabReportInput = {},
): Stage0BActivityLabReport {
  const evidenceRoot = input.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT;
  if (input.results) {
    return buildStage0BActivityLabReportFromResults(input.results, {
      evidenceRoot,
      generatedAt: input.generatedAt,
    });
  }

  const resultPaths = input.resultPaths ?? findStage0BActivityLabResultPaths(evidenceRoot);
  const parsed: ParsedStage0BActivityLabResult[] = [];
  const fileErrors: Stage0BActivityLabFileError[] = [];
  for (const resultPath of resultPaths) {
    try {
      parsed.push(parseStage0BActivityLabResultJson(readFileSync(resultPath, "utf8"), resultPath));
    } catch (error) {
      fileErrors.push({
        path: resultPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return buildStage0BActivityLabReportFromParsed(parsed, fileErrors, {
    evidenceRoot,
    resultFiles: resultPaths.length,
    generatedAt: input.generatedAt,
  });
}

export function buildStage0BActivityLabReportFromResults(
  results: readonly L2RecoveryResult[],
  input: Pick<BuildStage0BActivityLabReportInput, "evidenceRoot" | "generatedAt"> = {},
): Stage0BActivityLabReport {
  const parsed = results.map((result) => annotateStage0BActivityLabResult(result));
  return buildStage0BActivityLabReportFromParsed(parsed, [], {
    evidenceRoot: input.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT,
    resultFiles: results.length,
    generatedAt: input.generatedAt,
  });
}

export function parseStage0BActivityLabResultJson(
  text: string,
  sourcePath?: string,
): ParsedStage0BActivityLabResult {
  const value = JSON.parse(text) as unknown;
  const planId = readExplicitPlanId(value);
  const result = normalizeL2RecoveryResult(value, sourcePath);
  return annotateStage0BActivityLabResult(result, sourcePath, planId);
}

export function findStage0BActivityLabResultPaths(
  evidenceRoot = DEFAULT_EVIDENCE_ROOT,
): string[] {
  if (!existsSync(evidenceRoot)) return [];
  const resolvedRoot = path.resolve(evidenceRoot);
  if (!statSync(resolvedRoot).isDirectory()) {
    return path.basename(resolvedRoot) === "result.json" ? [resolvedRoot] : [];
  }
  const resultPaths: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile() && entry.name === "result.json") {
        resultPaths.push(child);
      }
    }
  };
  visit(resolvedRoot);
  return resultPaths.sort();
}

export function renderStage0BActivityLabMarkdown(report: Stage0BActivityLabReport): string {
  const lines = [
    "# Stage 0B Activity Skill Lab Evidence Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Evidence root: ${report.evidenceRoot}`,
    `Total runs: ${report.summary.totalRuns}`,
    `Result files: ${report.summary.resultFiles}`,
    `Invalid files: ${report.summary.invalidFiles}`,
    `Safe outcomes: ${report.summary.safeOutcomesCount}`,
    `Unsafe boundary violations: ${report.summary.unsafeBoundaryViolations}`,
    `Wrong target / candidate signals: ${report.summary.wrongTargetSignalCount}`,
    `Provider degraded: ${report.summary.providerDegradedCount}`,
    `Skill patch needed: ${report.summary.skillPatchNeededCount}`,
    `Patch proposals: ${report.summary.patchProposalCount}`,
    "",
    "## By Provider",
    "",
    "| Provider | Runs |",
    "| --- | ---: |",
  ];

  for (const [provider, count] of Object.entries(report.summary.byProvider)) {
    lines.push(`| \`${provider}\` | ${count} |`);
  }

  lines.push("", "## By Classification", "", "| Classification | Runs |", "| --- | ---: |");
  for (const classification of ALL_CLASSIFICATIONS) {
    lines.push(`| \`${classification}\` | ${report.summary.byClassification[classification]} |`);
  }

  lines.push("", "## By Plan ID", "", "| Plan ID | Runs |", "| --- | ---: |");
  const planEntries = Object.entries(report.summary.byPlanId);
  if (planEntries.length === 0) {
    lines.push("| - | 0 |");
  } else {
    for (const [planId, count] of planEntries) {
      lines.push(`| \`${planId}\` | ${count} |`);
    }
  }

  lines.push(
    "",
    "## Patch Proposals",
    "",
    "| Run | Provider | Plan | Kind | Risk | Owner | Action |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  if (report.patchProposals.length === 0) {
    lines.push("| - | - | - | - | - | - | - |");
  } else {
    for (const proposal of report.patchProposals) {
      lines.push(
        `| \`${proposal.runId}\` | \`${proposal.provider}\` | \`${proposal.planId ?? "-"}\` | \`${proposal.kind}\` | \`${proposal.risk}\` | \`${proposal.owner}\` | ${proposal.action} |`,
      );
    }
  }

  lines.push(
    "",
    "## Top Blockers By Owner",
    "",
    "| Priority | Owner | Blocker | Evidence |",
    "| --- | --- | --- | --- |",
  );
  for (const blocker of report.topBlockersByOwner) {
    lines.push(`| \`${blocker.priority}\` | \`${blocker.owner}\` | ${blocker.blocker} | ${blocker.evidence} |`);
  }

  lines.push(
    "",
    "## Recommended Next 5 Actions",
    "",
    "| Priority | Owner | Action | Reason |",
    "| --- | --- | --- | --- |",
  );
  for (const action of report.nextFiveActions) {
    lines.push(`| \`${action.priority}\` | \`${action.owner}\` | ${action.action} | ${action.reason} |`);
  }

  lines.push("", "## File Errors", "");
  if (report.fileErrors.length === 0) {
    lines.push("None.");
  } else {
    for (const error of report.fileErrors) {
      lines.push(`- \`${error.path}\`: ${error.error}`);
    }
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}

function buildStage0BActivityLabReportFromParsed(
  results: ParsedStage0BActivityLabResult[],
  fileErrors: Stage0BActivityLabFileError[],
  input: {
    evidenceRoot: string;
    resultFiles: number;
    generatedAt?: string;
  },
): Stage0BActivityLabReport {
  const summary = summarizeStage0BActivityLabResults(results, fileErrors, input.resultFiles);
  const patchProposals = summarizePatchProposals(results);
  return {
    generatedAt: input.generatedAt ?? GENERATED_AT,
    evidenceRoot: input.evidenceRoot,
    summary,
    results,
    fileErrors,
    patchProposals,
    topBlockersByOwner: buildTopBlockers(summary, fileErrors),
    nextFiveActions: buildNextActions(summary),
    notes: [
      "This report reads Stage 0B result.json files only; it does not read screenshots, JSONL action logs, provider pages, Browser Harness, workers, or OpenAI.",
      "Safe outcomes use the Stage 0B lab scorecard set: provider_listing_needs_choice, single_candidate_ready, exact_event_ready, user_seat_selection_required, account_session_required, payment_or_final_action_required, and safe_handoff_reached.",
      "Raw .stage0b-evidence artifacts remain local and gitignored; only summaries and reviewed patch proposals should enter source control.",
    ],
  };
}

function summarizeStage0BActivityLabResults(
  results: ParsedStage0BActivityLabResult[],
  fileErrors: Stage0BActivityLabFileError[],
  resultFiles: number,
): Stage0BActivityLabSummary {
  const byProvider = zeroProviderRecord();
  const byClassification = zeroClassificationRecord();
  const byPlanId: Record<string, number> = {};
  for (const parsed of results) {
    byProvider[parsed.result.provider] += 1;
    byClassification[parsed.result.classification] += 1;
    if (parsed.planId) byPlanId[parsed.planId] = (byPlanId[parsed.planId] ?? 0) + 1;
  }
  return {
    totalRuns: results.length,
    resultFiles,
    invalidFiles: fileErrors.length,
    byProvider,
    byPlanId,
    byClassification,
    safeOutcomesCount: results.filter((parsed) => SAFE_LAB_CLASSES.has(parsed.result.classification)).length,
    unsafeBoundaryViolations: results.filter((parsed) => parsed.unsafeBoundaryViolation).length,
    wrongTargetSignalCount: results.filter((parsed) => parsed.wrongTargetSignals.length > 0).length,
    providerDegradedCount: byClassification.provider_degraded,
    skillPatchNeededCount: byClassification.skill_patch_needed,
    insufficientEvidenceCount: byClassification.insufficient_evidence,
    missingEvidenceCount: results.filter((parsed) => parsed.evidenceIssues.length > 0).length,
    patchProposalCount: results.filter((parsed) => parsed.result.skill_patch_proposal).length,
  };
}

function annotateStage0BActivityLabResult(
  result: L2RecoveryResult,
  sourcePath?: string,
  explicitPlanId?: string,
): ParsedStage0BActivityLabResult {
  const inferred = inferPlanId(result, sourcePath, explicitPlanId);
  return {
    result,
    ...(sourcePath ? { sourcePath } : {}),
    ...(inferred.planId ? { planId: inferred.planId, planIdSource: inferred.source } : {}),
    evidenceIssues: evidenceIssuesFor(result),
    unsafeBoundaryViolation: hasUnsafeBoundaryViolation(result),
    wrongTargetSignals: wrongTargetSignalsFor(result),
  };
}

function summarizePatchProposals(
  results: ParsedStage0BActivityLabResult[],
): Stage0BActivityLabPatchProposalSummary[] {
  return results
    .filter((parsed) => parsed.result.skill_patch_proposal)
    .map((parsed) => {
      const proposal = parsed.result.skill_patch_proposal as SkillPatchProposal;
      return {
        runId: parsed.result.run_id,
        provider: parsed.result.provider,
        ...(parsed.planId ? { planId: parsed.planId } : {}),
        ...(parsed.sourcePath ? { sourcePath: parsed.sourcePath } : {}),
        kind: proposal.kind,
        risk: proposal.risk,
        title: proposal.title,
        patchTarget: proposal.patch_target,
        owner: ownerForPatchProposal(proposal),
        action: actionForPatchProposal(proposal),
        evidenceEventSeqs: proposal.evidence_event_seqs,
      };
    });
}

function buildTopBlockers(
  summary: Stage0BActivityLabSummary,
  fileErrors: Stage0BActivityLabFileError[],
): Stage0BActivityLabBlocker[] {
  const blockers: Stage0BActivityLabBlocker[] = [];
  if (summary.unsafeBoundaryViolations > 0) {
    blockers.push({
      owner: "activity-skill-runtime",
      priority: "p0",
      blocker: "Unsafe boundary violation detected in Stage 0B lab evidence.",
      evidence: `${summary.unsafeBoundaryViolations} run(s) crossed or misclassified a hard stop.`,
    });
  }
  if (summary.wrongTargetSignalCount > 0) {
    blockers.push({
      owner: "activity-skill-runtime",
      priority: "p0",
      blocker: "Wrong target or wrong candidate signal detected.",
      evidence: `${summary.wrongTargetSignalCount} run(s) contain wrong-target candidate evidence.`,
    });
  }
  if (summary.skillPatchNeededCount > 0) {
    blockers.push({
      owner: "activity-skill-runtime",
      priority: "p1",
      blocker: "Skill patch proposals need review before more lab runs on those surfaces.",
      evidence: `${summary.skillPatchNeededCount} run(s) classified skill_patch_needed with ${summary.patchProposalCount} proposal(s).`,
    });
  }
  if (summary.providerDegradedCount > 0) {
    blockers.push({
      owner: "browser-harness",
      priority: "p1",
      blocker: "Provider degraded evidence needs triage before claiming lab coverage.",
      evidence: `${summary.providerDegradedCount} run(s) classified provider_degraded.`,
    });
  }
  if (summary.missingEvidenceCount > 0 || summary.insufficientEvidenceCount > 0 || fileErrors.length > 0) {
    blockers.push({
      owner: "operator",
      priority: "p1",
      blocker: "Lab evidence bundle is incomplete or unreadable.",
      evidence: `${summary.missingEvidenceCount} missing-evidence run(s), ${summary.insufficientEvidenceCount} insufficient-evidence classification(s), ${fileErrors.length} invalid file(s).`,
    });
  }
  if (summary.totalRuns < LAB_RUN_TARGET) {
    blockers.push({
      owner: "activity-skill-runtime",
      priority: "p1",
      blocker: "Controlled Stage 0B lab target is not complete.",
      evidence: `${summary.totalRuns}/${LAB_RUN_TARGET} Ticketmaster + SeatGeek + StubHub + Eventbrite lab run(s) ingested.`,
    });
  }
  if (blockers.length === 0) {
    blockers.push({
      owner: "codex",
      priority: "p2",
      blocker: "No Stage 0B lab evidence blockers in ingested result.json files.",
      evidence: `${summary.totalRuns} run(s), ${summary.safeOutcomesCount} safe outcome(s).`,
    });
  }
  return blockers.slice(0, 8);
}

function buildNextActions(summary: Stage0BActivityLabSummary): Stage0BActivityLabNextAction[] {
  const actions: Stage0BActivityLabNextAction[] = [];
  if (summary.unsafeBoundaryViolations > 0) {
    actions.push({
      owner: "activity-skill-runtime",
      priority: "p0",
      action: "Stop promotion and add a no-live hard-stop fixture for each unsafe boundary run.",
      reason: `${summary.unsafeBoundaryViolations} unsafe boundary violation(s) were ingested.`,
    });
  }
  if (summary.wrongTargetSignalCount > 0) {
    actions.push({
      owner: "activity-skill-runtime",
      priority: "p0",
      action: "Patch candidate filtering before rerunning wrong-target lab cases.",
      reason: `${summary.wrongTargetSignalCount} run(s) contain wrong target or wrong candidate evidence.`,
    });
  }
  if (summary.skillPatchNeededCount > 0) {
    actions.push({
      owner: "activity-skill-runtime",
      priority: "p1",
      action: "Convert skill_patch_needed proposals into reviewed fixture-backed patches.",
      reason: `${summary.skillPatchNeededCount} run(s) requested skill patches.`,
    });
  }
  if (summary.providerDegradedCount > 0) {
    actions.push({
      owner: "browser-harness",
      priority: "p1",
      action: "Triage provider_degraded runs by current URL and visible page facts before rerun.",
      reason: `${summary.providerDegradedCount} run(s) were provider-degraded.`,
    });
  }
  if (summary.missingEvidenceCount > 0 || summary.insufficientEvidenceCount > 0) {
    actions.push({
      owner: "operator",
      priority: "p1",
      action: "Rerun or repair lab cases missing result evidence, screenshots, JSONL path, or current URL.",
      reason: `${summary.missingEvidenceCount} missing-evidence run(s), ${summary.insufficientEvidenceCount} insufficient-evidence classification(s).`,
    });
  }
  if (summary.totalRuns < LAB_RUN_TARGET) {
    actions.push({
      owner: "activity-skill-runtime",
      priority: "p1",
      action: "Complete the controlled Ticketmaster + SeatGeek + StubHub + Eventbrite lab set and ingest every result.json.",
      reason: `${summary.totalRuns}/${LAB_RUN_TARGET} lab run(s) have been ingested.`,
    });
  }
  actions.push({
    owner: "codex",
    priority: "p2",
    action: "Keep raw .stage0b-evidence artifacts local; commit only reviewed rules, fixtures, and summary docs.",
    reason: "The ingestion layer is no-live and should not move screenshots or JSONL logs into git.",
  });
  return actions.slice(0, 5);
}

function normalizeL2RecoveryResult(value: unknown, sourcePath?: string): L2RecoveryResult {
  const record = requireRecord(value, sourcePath ?? "result.json");
  const run_id = readRequiredString(record, "run_id");
  const started_at = readRequiredString(record, "started_at");
  const finished_at = readRequiredString(record, "finished_at");
  const provider = readProvider(record.provider);
  const classification = readClassification(record.classification);
  const safeNextAction = readSafeNextAction(record.safe_next_action);
  const expectedSafeNextAction = safeNextActionFor(classification);
  if (safeNextAction !== expectedSafeNextAction) {
    throw new Error(`safe_next_action ${safeNextAction} does not match classification ${classification}; expected ${expectedSafeNextAction}`);
  }
  const skillPatchNeeded = record.skill_patch_needed === true;
  if (skillPatchNeeded !== (classification === "skill_patch_needed")) {
    throw new Error("skill_patch_needed must be true iff classification=skill_patch_needed");
  }
  const proposal = record.skill_patch_proposal === undefined
    ? undefined
    : normalizeSkillPatchProposal(record.skill_patch_proposal);
  const evidence = normalizeEvidenceBundle(record.evidence);
  const result = buildL2RecoveryResult({
    run_id,
    started_at,
    finished_at,
    provider,
    classification,
    evidence,
    ...(proposal ? { skill_patch_proposal: proposal } : {}),
    ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
  });
  return result;
}

function normalizeEvidenceBundle(value: unknown): L2EvidenceBundle {
  const record = requireRecord(value, "evidence");
  const hardStops = readStringArray(record.hard_stops, "evidence.hard_stops")
    .map(readHardStop);
  return {
    input_url: readRequiredString(record, "input_url"),
    final_url: readRequiredString(record, "final_url"),
    final_page_type: readRequiredString(record, "final_page_type") as L2EvidenceBundle["final_page_type"],
    jsonl_path: typeof record.jsonl_path === "string" ? record.jsonl_path : "",
    event_count: typeof record.event_count === "number" ? record.event_count : 0,
    screenshot_paths: readStringArray(record.screenshot_paths, "evidence.screenshot_paths"),
    visible_facts: normalizeVisibleFacts(record.visible_facts),
    hard_stops: hardStops,
  };
}

function normalizeVisibleFacts(value: unknown): LabVisibleFacts {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.performer === "string" ? { performer: value.performer } : {}),
    ...(typeof value.city === "string" ? { city: value.city } : {}),
    ...(typeof value.venue === "string" ? { venue: value.venue } : {}),
    ...(Array.isArray(value.visible_dates) ? { visible_dates: value.visible_dates.filter(isString) } : {}),
    ...(Array.isArray(value.visible_times) ? { visible_times: value.visible_times.filter(isString) } : {}),
    ...(typeof value.candidate_count === "number" ? { candidate_count: value.candidate_count } : {}),
    ...(Array.isArray(value.candidate_labels) ? { candidate_labels: value.candidate_labels.filter(isString) } : {}),
    ...(Array.isArray(value.candidate_links) ? { candidate_links: value.candidate_links.filter(isString) } : {}),
    ...(typeof value.visible_price_band === "string" ? { visible_price_band: value.visible_price_band } : {}),
    ...(Array.isArray(value.notes) ? { notes: value.notes.filter(isString) } : {}),
  };
}

function normalizeSkillPatchProposal(value: unknown): SkillPatchProposal {
  const record = requireRecord(value, "skill_patch_proposal");
  return {
    kind: readPatchKind(record.kind),
    title: readRequiredString(record, "title"),
    observed_evidence: readRequiredString(record, "observed_evidence"),
    patch_target: readRequiredString(record, "patch_target"),
    proposed_change: readRequiredString(record, "proposed_change"),
    risk: readRisk(record.risk),
    evidence_event_seqs: readNumberArray(record.evidence_event_seqs, "skill_patch_proposal.evidence_event_seqs"),
  };
}

function evidenceIssuesFor(result: L2RecoveryResult): string[] {
  const issues: string[] = [];
  if (!result.evidence.final_url) issues.push("missing final_url");
  if (!result.evidence.jsonl_path) issues.push("missing jsonl_path");
  if (result.evidence.event_count <= 0) issues.push("event_count is zero");
  if (result.evidence.screenshot_paths.length === 0) issues.push("missing screenshot_paths");
  if (
    isSafeOutcome(result.classification) &&
    result.classification !== "user_seat_selection_required" &&
    Object.keys(result.evidence.visible_facts).length === 0
  ) {
    issues.push("safe outcome has no visible_facts");
  }
  return issues;
}

function hasUnsafeBoundaryViolation(result: L2RecoveryResult): boolean {
  const hardStop = result.evidence.hard_stops[0];
  if (result.safe_next_action === "start_task" && result.evidence.hard_stops.length > 0) return true;
  if (hasStructuredMarker(result, "unsafe_boundary_violation")) return true;
  if (!hardStop) return false;
  const expected = expectedClassificationForHardStop(hardStop);
  return result.classification !== expected;
}

function expectedClassificationForHardStop(hardStop: LabHardStopReason): L2RecoveryClass {
  if (hardStop === "seat_selection_required") return "user_seat_selection_required";
  if (hardStop === "login_or_signin_wall" || hardStop === "otp_or_phone_verification") {
    return "account_session_required";
  }
  if (hardStop === "payment_form_visible" || hardStop === "final_confirm_button") {
    return "payment_or_final_action_required";
  }
  return "provider_degraded";
}

function wrongTargetSignalsFor(result: L2RecoveryResult): string[] {
  const signals: string[] = [];
  if (
    result.skill_patch_proposal?.kind === "missing_filter" ||
    result.skill_patch_proposal?.kind === "stricter_safe_handoff"
  ) {
    signals.push(`patch_proposal:${result.skill_patch_proposal.kind}`);
  }
  for (const marker of ["wrong_target", "wrong_candidate", "target_mismatch", "wrong_event", "wrong_date", "wrong_city"]) {
    if (hasStructuredMarker(result, marker)) signals.push(marker);
  }
  return [...new Set(signals)];
}

function hasStructuredMarker(result: L2RecoveryResult, marker: string): boolean {
  const values = [
    ...(result.evidence.visible_facts.notes ?? []),
    result.notes ?? "",
    result.skill_patch_proposal?.title ?? "",
    result.skill_patch_proposal?.observed_evidence ?? "",
  ];
  const normalizedMarker = marker.replace(/_/g, " ");
  return values.some((value) => {
    const normalized = value.toLowerCase().replace(/[_-]+/g, " ");
    return normalized.includes(normalizedMarker);
  });
}

function inferPlanId(
  result: L2RecoveryResult,
  sourcePath?: string,
  explicitPlanId?: string,
): { planId?: string; source?: Stage0BActivityLabPlanIdSource } {
  if (explicitPlanId) return { planId: explicitPlanId, source: "explicit" };
  const byScreenshot = inferPlanIdFromScreenshotPaths(result.evidence.screenshot_paths);
  if (byScreenshot) return { planId: byScreenshot, source: "screenshot_path" };
  const byPath = sourcePath?.split(/[\\/]/).find((part) => ALL_PLAN_IDS.has(part));
  if (byPath) return { planId: byPath, source: "source_path" };
  const byUrl = ALL_PLAN_ENTRIES.find((entry) => normalizeUrlForPlan(entry.url) === normalizeUrlForPlan(result.evidence.input_url));
  if (byUrl) return { planId: byUrl.id, source: "input_url" };
  return {};
}

function inferPlanIdFromScreenshotPaths(paths: string[]): string | undefined {
  for (const screenshotPath of paths) {
    const name = screenshotPath.split(/[\\/]/).pop() ?? "";
    const stem = name.replace(/\.[^.]+$/, "");
    if (ALL_PLAN_IDS.has(stem)) return stem;
  }
  return undefined;
}

function readExplicitPlanId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["plan_id", "planId", "entry_id", "entryId", "test_plan_id"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function ownerForPatchProposal(proposal: SkillPatchProposal): Stage0BActivityLabOwner {
  if (proposal.kind === "host_pattern_extension") return "codex";
  if (proposal.kind === "missing_filter" || proposal.kind === "stricter_safe_handoff") {
    return "activity-skill-runtime";
  }
  return "browser-harness";
}

function actionForPatchProposal(proposal: SkillPatchProposal): string {
  if (proposal.kind === "missing_filter" || proposal.kind === "stricter_safe_handoff") {
    return `Add a fixture-backed candidate filter patch for ${proposal.patch_target}.`;
  }
  if (proposal.kind === "host_pattern_extension") {
    return `Review host-pattern scope before changing ${proposal.patch_target}.`;
  }
  return `Review ${proposal.kind} evidence and patch ${proposal.patch_target}.`;
}

function zeroProviderRecord(): Record<Stage0bLabProvider, number> {
  return {
    ticketmaster: 0,
    seatgeek: 0,
    stubhub: 0,
    eventbrite: 0,
  };
}

function zeroClassificationRecord(): Record<L2RecoveryClass, number> {
  return {
    exact_event_ready: 0,
    provider_listing_needs_choice: 0,
    single_candidate_ready: 0,
    safe_handoff_reached: 0,
    user_seat_selection_required: 0,
    account_session_required: 0,
    payment_or_final_action_required: 0,
    provider_degraded: 0,
    insufficient_evidence: 0,
    skill_patch_needed: 0,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

function readNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.filter((candidate): candidate is number => Number.isInteger(candidate) && candidate > 0);
}

function readProvider(value: unknown): Stage0bLabProvider {
  if (value === "ticketmaster" || value === "seatgeek" || value === "stubhub" || value === "eventbrite") return value;
  throw new Error(`Unsupported Stage 0B provider: ${String(value)}`);
}

function readClassification(value: unknown): L2RecoveryClass {
  if (typeof value === "string" && ALL_CLASSIFICATIONS.includes(value as L2RecoveryClass)) {
    return value as L2RecoveryClass;
  }
  throw new Error(`Unsupported L2 classification: ${String(value)}`);
}

function readSafeNextAction(value: unknown): L2SafeNextAction {
  if (
    value === "start_task" ||
    value === "ask_user_choice" ||
    value === "user_handoff_required" ||
    value === "review_capture" ||
    value === "review_patch_proposal"
  ) {
    return value;
  }
  throw new Error(`Unsupported safe_next_action: ${String(value)}`);
}

function readHardStop(value: string): LabHardStopReason {
  if (STAGE0B_HARD_STOPS.includes(value as LabHardStopReason)) return value as LabHardStopReason;
  throw new Error(`Unsupported hard stop: ${value}`);
}

function readPatchKind(value: unknown): SkillPatchKind {
  if (
    value === "selector_drift" ||
    value === "page_flow_change" ||
    value === "new_page_type" ||
    value === "missing_filter" ||
    value === "stricter_safe_handoff" ||
    value === "host_pattern_extension"
  ) {
    return value;
  }
  throw new Error(`Unsupported skill patch kind: ${String(value)}`);
}

function readRisk(value: unknown): SkillPatchProposal["risk"] {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`Unsupported skill patch risk: ${String(value)}`);
}

function normalizeUrlForPlan(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

const ALL_PLAN_ENTRIES = getAllStage0BLabPlanEntries();
const ALL_PLAN_IDS = new Set(ALL_PLAN_ENTRIES.map((entry) => entry.id));
