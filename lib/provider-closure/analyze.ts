import {
  analyzeExpediaRetryArtifactBundle,
  type ExpediaRetryAnalysis,
  type ExpediaRetryArtifactBundle,
} from "@/lib/runtime-forensics/expedia-retry-analysis";
import {
  analyzeHotelRetryArtifactBundle,
  type HotelRetryAnalysis,
  type HotelRetryArtifactBundle,
} from "@/lib/runtime-forensics/hotel-retry-analysis";
import {
  analyzeRestaurantArtifactBundle,
  type RestaurantArtifactAnalysis,
  type RestaurantArtifactBundle,
} from "@/lib/runtime-forensics/restaurant-artifact-analysis";
import { classifyJob } from "@/lib/runtime-forensics/classifier";
import type { JobLikeInput, StepLikeInput } from "@/lib/runtime-forensics/types";

import { assertProviderClosureArtifactIsSafe } from "./safety";
import {
  cleanStringList,
  firstString,
  isRecord,
  normalizeProviderClosureKind,
  PROVIDER_CLOSURE_HARD_STOPS,
  PROVIDER_CLOSURE_SCHEMA_VERSION,
  PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL,
  ProviderClosureError,
  type NormalizedProviderClosureArtifact,
  type ProviderClosureAnalysis,
  type ProviderClosureArtifact,
  type ProviderClosureKind,
  type ProviderClosureProviderAnalysis,
  type ProviderClosureSignal,
  type ProviderClosureSourceSummary,
  type ProviderClosureTerminalOutcome,
  readString,
} from "./schema";

type DomainAnalysis =
  | RestaurantArtifactAnalysis
  | ExpediaRetryAnalysis
  | HotelRetryAnalysis;

export function normalizeProviderClosureArtifact(
  payload: unknown,
  expectedKind?: ProviderClosureKind,
  options: { inputPath?: string | null; rawText?: string | null } = {},
): NormalizedProviderClosureArtifact {
  if (!isRecord(payload)) {
    throw new ProviderClosureError(
      "invalid_schema",
      "Provider closure artifact must be a JSON object.",
    );
  }
  if (Object.keys(payload).length === 0) {
    throw new ProviderClosureError("empty_artifact", "Artifact is empty.");
  }

  const rawText = options.rawText ?? JSON.stringify(payload);
  assertProviderClosureArtifactIsSafe(rawText);

  const schemaVersion = payload.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== PROVIDER_CLOSURE_SCHEMA_VERSION) {
    throw new ProviderClosureError(
      "invalid_schema",
      `Unsupported provider closure schemaVersion: ${String(schemaVersion)}.`,
    );
  }

  const payloadKind = normalizeProviderClosureKind(
    typeof payload.kind === "string" ? payload.kind : undefined,
  );
  const templateKind = normalizeProviderClosureKind(
    typeof payload.templateKind === "string" ? payload.templateKind : undefined,
  );
  const kind = payloadKind ?? expectedKind ?? templateKind;
  if (!kind) {
    throw new ProviderClosureError(
      "invalid_kind",
      "Provider closure kind is required. Use restaurant, flight, or hotel.",
    );
  }
  if (expectedKind && kind !== expectedKind) {
    throw new ProviderClosureError(
      "invalid_kind",
      `Artifact kind ${kind} does not match requested kind ${expectedKind}.`,
    );
  }

  const artifact = payload as ProviderClosureArtifact;
  if (!hasAnyEvidenceSource(artifact)) {
    throw new ProviderClosureError(
      "invalid_schema",
      "Artifact must include at least one evidence source: job, dbRow, workerLogExcerpt, artifact paths, or notes.",
    );
  }

  return {
    ...artifact,
    schemaVersion: PROVIDER_CLOSURE_SCHEMA_VERSION,
    kind,
    inputPath: options.inputPath ?? null,
    analyzerFixturePath:
      firstString(artifact.analyzerFixturePath, options.inputPath) ?? null,
    raw: payload,
  };
}

export function analyzeProviderClosureArtifact(
  payload: unknown,
  expectedKind: ProviderClosureKind,
  options: { inputPath?: string | null; rawText?: string | null } = {},
): ProviderClosureAnalysis {
  const artifact = normalizeProviderClosureArtifact(payload, expectedKind, options);
  const providerAnalysis = runDomainAnalyzer(artifact);
  const runtimeJob = buildRuntimeClassifierJob(artifact);
  const runtimeClassification = classifyJob(runtimeJob);
  const terminalOutcome = normalizeTerminalOutcome(
    artifact.kind,
    providerAnalysis,
    runtimeClassification.primaryClass,
  );
  const confidence = combineConfidence(
    providerAnalysis.confidence,
    runtimeClassification.confidence,
  );
  const artifactPaths = {
    workerLogPath: firstString(artifact.workerLogPath) ?? null,
    benchmarkReportPath: firstString(artifact.benchmarkReportPath) ?? null,
    screenshots: cleanStringList(artifact.screenshotPaths),
    liveSnapshots: cleanStringList(artifact.liveSnapshotPaths),
    analyzerFixturePath: firstString(artifact.analyzerFixturePath) ?? null,
  };
  const job = artifact.job ?? null;
  const dbRow = artifact.dbRow;
  const jobId = firstString(providerAnalysis.jobId, job?.id, readString(dbRow, "id"));
  const taskId = firstString(
    providerAnalysis.taskId,
    job?.taskId,
    readString(dbRow, "task_id"),
    readString(dbRow, "taskId"),
  );
  const provider = firstString(providerAnalysis.provider, job?.provider, readString(dbRow, "provider")) ?? "unknown";
  const scenario = firstString(providerAnalysis.scenario, job?.scenario, readString(dbRow, "scenario")) ?? "unknown";
  const status = firstString(providerAnalysis.status, job?.status, readString(dbRow, "status")) ?? "unknown";
  const summary = buildClosureSummary(artifact.kind, terminalOutcome, providerAnalysis);

  return {
    schemaVersion: PROVIDER_CLOSURE_SCHEMA_VERSION,
    kind: artifact.kind,
    generatedAt: new Date().toISOString(),
    terminalOutcome,
    outcomeLabel: PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL[terminalOutcome],
    confidence,
    jobId,
    taskId,
    provider,
    scenario,
    status,
    providerAnalysis,
    runtimeClassification,
    runtimeClass: runtimeClassification.primaryClass,
    runtimeSeverity: runtimeClassification.severity,
    artifactPaths,
    sources: summarizeSources(artifact),
    summary,
    exactNextStep: exactNextStepForOutcome(artifact.kind, terminalOutcome),
    recommendedControlledRun: recommendNextControlledRun(
      artifact.kind,
      terminalOutcome,
    ),
    hardStops: [...PROVIDER_CLOSURE_HARD_STOPS],
  };
}

function runDomainAnalyzer(
  artifact: NormalizedProviderClosureArtifact,
): ProviderClosureProviderAnalysis {
  let analysis: DomainAnalysis;
  switch (artifact.kind) {
    case "restaurant":
      analysis = analyzeRestaurantArtifactBundle(
        artifact as RestaurantArtifactBundle,
      );
      break;
    case "expedia-flight":
      analysis = analyzeExpediaRetryArtifactBundle(
        artifact as ExpediaRetryArtifactBundle,
      );
      break;
    case "hotel":
      analysis = analyzeHotelRetryArtifactBundle(artifact as HotelRetryArtifactBundle);
      break;
  }

  return {
    state: analysis.state,
    label: analysis.label,
    confidence: analysis.confidence,
    jobId: analysis.jobId,
    taskId: analysis.taskId,
    provider: analysis.provider,
    scenario: analysis.scenario,
    status: analysis.status,
    summary: analysis.summary,
    nextAction: analysis.nextAction,
    signals: analysis.signals.map((signal) => ({
      source: signal.sourceLabel,
      label: signal.label,
      excerpt: signal.excerpt,
    })),
  };
}

function normalizeTerminalOutcome(
  kind: ProviderClosureKind,
  analysis: ProviderClosureProviderAnalysis,
  runtimeClass: string,
): ProviderClosureTerminalOutcome {
  if (analysis.state === "safety_boundary_violation") return "unsafe_blocked";
  if (runtimeClass === "model_or_env_blocked") return "model_env_transient";

  if (kind === "restaurant") {
    switch (analysis.state) {
      case "safe_manual_review_reached":
        return "safe_handoff";
      case "resy_otp_login_boundary":
      case "opentable_phone_otp_handoff":
        return "login_otp_boundary";
      case "resy_no_availability":
        return "no_availability";
      case "provider_network_degraded":
        return "provider_degraded";
      case "resy_modal_disabled_details_api_failed":
      case "opentable_form_incomplete":
        return "selector_drift";
      default:
        break;
    }
  }

  if (kind === "expedia-flight") {
    switch (analysis.state) {
      case "checkout_manual_review_reached":
        return "safe_handoff";
      case "model_or_env_transient":
        return "model_env_transient";
      case "network_provider_failure":
        return "provider_degraded";
      case "provider_no_availability":
        return "no_availability";
      case "card_scan_failed_before_fallback":
      case "fallback_attempted_no_match":
      case "fallback_matched_no_checkout":
        return "selector_drift";
      default:
        break;
    }
  }

  if (kind === "hotel") {
    switch (analysis.state) {
      case "payment_manual_review_reached":
      case "guest_details_manual_review_reached":
      case "room_selection_manual_review_reached":
        return "safe_handoff";
      case "login_or_captcha_boundary":
        return "login_otp_boundary";
      case "profile_gating":
        return "unsafe_blocked";
      case "model_env_transient":
        return "model_env_transient";
      case "network_provider_failure":
        return "provider_degraded";
      case "provider_no_availability":
        return "no_availability";
      case "provider_selector_drift":
      case "room_selection_drift":
        return "selector_drift";
      default:
        break;
    }
  }

  switch (runtimeClass) {
    case "checkout_reached_manual_review":
      return "safe_handoff";
    case "otp_or_login_required":
      return "login_otp_boundary";
    case "provider_no_availability":
      return "no_availability";
    case "network_or_provider_5xx":
      return "provider_degraded";
    case "provider_form_incomplete":
    case "legacy_shape_missing_source":
      return "selector_drift";
    default:
      return "insufficient_evidence";
  }
}

function buildRuntimeClassifierJob(
  artifact: NormalizedProviderClosureArtifact,
): JobLikeInput {
  const job = isRecord(artifact.job) ? artifact.job : {};
  const dbRow = artifact.dbRow;
  const steps = normalizeSteps(job.steps);
  const firstStep = steps[0];
  const decisionLog =
    normalizeDecisionLog(job.decisionLog) ??
    normalizeDecisionLog(readNested(firstStep, ["decisionLog"])) ??
    normalizeDecisionLog(readNested(firstStep, ["body", "decisionLog"]));

  return {
    ...job,
    id: firstString(readString(job, "id"), readString(dbRow, "id")),
    taskId: firstString(
      readString(job, "taskId"),
      readString(dbRow, "task_id"),
      readString(dbRow, "taskId"),
    ),
    provider: firstString(readString(job, "provider"), readString(dbRow, "provider")),
    scenario: firstString(
      readString(job, "scenario"),
      readString(readNested(firstStep, ["body"]), "scenario"),
      readString(dbRow, "scenario"),
    ),
    status: firstString(readString(job, "status"), readString(dbRow, "status")),
    errorMessage: firstString(
      readString(job, "errorMessage"),
      readString(firstStep, "error"),
      readString(dbRow, "error"),
    ),
    terminalReason: firstString(
      readString(job, "terminalReason"),
      readString(firstStep, "terminalReason"),
      readString(dbRow, "terminalReason"),
    ),
    terminalCode: firstString(
      readString(job, "terminalCode"),
      readString(firstStep, "terminalCode"),
      readString(dbRow, "terminalCode"),
    ),
    steps,
    decisionLog,
    params: readRecord(readNested(job, ["params"])) ?? readRecord(readNested(firstStep, ["body", "params"])),
    rawWorkerLogExcerpt: firstString(
      readString(job, "rawWorkerLogExcerpt"),
      artifact.workerLogExcerpt,
    ),
  };
}

function normalizeSteps(value: unknown): StepLikeInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((step) => {
    const body = readNested(step, ["body"]);
    const source = firstString(
      readString(step, "__source"),
      readString(body, "__source"),
    );
    return {
      ...step,
      __source: source,
      type: firstString(readString(step, "type"), readString(body, "scenario")),
      error: readString(step, "error"),
      name: readString(step, "name"),
    };
  });
}

function normalizeDecisionLog(value: unknown): JobLikeInput["decisionLog"] {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord);
}

function readNested(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function combineConfidence(
  providerConfidence: "high" | "medium" | "low",
  runtimeConfidence: "high" | "medium" | "low",
): "high" | "medium" | "low" {
  if (providerConfidence === "high" || runtimeConfidence === "high") {
    return "high";
  }
  if (providerConfidence === "medium" || runtimeConfidence === "medium") {
    return "medium";
  }
  return "low";
}

function summarizeSources(
  artifact: NormalizedProviderClosureArtifact,
): ProviderClosureSourceSummary[] {
  const screenshots = cleanStringList(artifact.screenshotPaths);
  const snapshots = cleanStringList(artifact.liveSnapshotPaths);
  const notes = cleanStringList(artifact.notes);
  return [
    {
      kind: "job_json",
      label: "Job JSON",
      present: isRecord(artifact.job),
      detail: artifact.job?.id ?? null,
    },
    {
      kind: "db_row_json",
      label: "DB row JSON",
      present: artifact.dbRow !== undefined && artifact.dbRow !== null,
      detail: readString(artifact.dbRow, "id"),
    },
    {
      kind: "worker_log_excerpt",
      label: "Worker log excerpt",
      present: typeof artifact.workerLogExcerpt === "string" && artifact.workerLogExcerpt.trim().length > 0,
      detail: artifact.workerLogExcerpt ? `${artifact.workerLogExcerpt.length} chars` : null,
    },
    {
      kind: "worker_log_path",
      label: "Worker log path",
      present: Boolean(firstString(artifact.workerLogPath)),
      detail: firstString(artifact.workerLogPath),
    },
    {
      kind: "screenshot_paths",
      label: "Screenshot paths",
      present: screenshots.length > 0,
      detail: screenshots.length > 0 ? `${screenshots.length} path(s)` : null,
    },
    {
      kind: "live_snapshot_paths",
      label: "Live snapshot paths",
      present: snapshots.length > 0,
      detail: snapshots.length > 0 ? `${snapshots.length} path(s)` : null,
    },
    {
      kind: "benchmark_report_path",
      label: "Benchmark report path",
      present: Boolean(firstString(artifact.benchmarkReportPath)),
      detail: firstString(artifact.benchmarkReportPath),
    },
    {
      kind: "analyzer_fixture",
      label: "Analyzer fixture",
      present: Boolean(firstString(artifact.analyzerFixturePath)),
      detail: firstString(artifact.analyzerFixturePath),
    },
    {
      kind: "operator_notes",
      label: "Operator notes",
      present: notes.length > 0,
      detail: notes.length > 0 ? `${notes.length} note(s)` : null,
    },
  ];
}

function buildClosureSummary(
  kind: ProviderClosureKind,
  outcome: ProviderClosureTerminalOutcome,
  analysis: ProviderClosureProviderAnalysis,
): string {
  return `${kind} closure outcome is ${PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL[outcome]} from provider state ${analysis.state}: ${analysis.summary}`;
}

function exactNextStepForOutcome(
  kind: ProviderClosureKind,
  outcome: ProviderClosureTerminalOutcome,
): string {
  const commandKind = kind === "expedia-flight" ? "flight" : kind;
  switch (outcome) {
    case "safe_handoff":
      return "Record this as safe closure progress, preserve the artifact bundle, and do not run another live attempt for the same evidence.";
    case "login_otp_boundary":
      return "Stop at the provider boundary. A human may handle login/OTP/CAPTCHA/phone verification manually, but the agent must not bypass or automate it.";
    case "no_availability":
      return "Record no availability only if screenshots/logs agree. Pick a fresh approved candidate before any future controlled live run.";
    case "provider_degraded":
      return "Do not patch selectors. Preserve evidence, wait for provider/model/network stability, then rerun this report from a new artifact if a human approves another single attempt.";
    case "selector_drift":
      return "Patch the smallest provider-specific selector/runtime gap using DB/log/screenshot evidence, then add or update a synthetic fixture before any live retry.";
    case "model_env_transient":
      return "Do not patch provider code. Verify OpenAI/model/env health and rerun only after a human approves one exact command.";
    case "unsafe_blocked":
      return "Stop. Do not retry. Open a safety root-cause review from the DB/log/screenshot bundle before any further provider work.";
    case "insufficient_evidence":
      return `Collect DB row JSON, bounded worker log excerpt, screenshot paths, and live snapshot paths, then rerun: npx tsx scripts/provider-closure.ts analyze --kind ${commandKind} --artifact <bundle.json>`;
  }
}

function recommendNextControlledRun(
  kind: ProviderClosureKind,
  outcome: ProviderClosureTerminalOutcome,
): string {
  if (outcome === "safe_handoff" || outcome === "login_otp_boundary") {
    return "No immediate controlled live run is recommended from this artifact; it already reached an acceptable safe boundary.";
  }
  if (outcome === "unsafe_blocked") {
    return "No live run is recommended. Resolve the safety/root-cause issue first.";
  }
  if (outcome === "model_env_transient" || outcome === "provider_degraded") {
    return "No provider retry is recommended until model/env/provider health is confirmed outside the live flow.";
  }
  if (kind === "restaurant") {
    return "Next candidate, if a human approves: one probe-positive Resy/OpenTable case selected by the restaurant readiness flow.";
  }
  if (kind === "expedia-flight") {
    return "Next candidate, if a human approves: the single Expedia MCO to BNA controlled retry from the runbook, not a broad flight suite.";
  }
  return "Next candidate, if a human approves: the single Booking.com YOTEL controlled retry from the hotel runbook, not Hotels.com or Expedia hotel.";
}

function hasAnyEvidenceSource(artifact: ProviderClosureArtifact): boolean {
  return (
    isRecord(artifact.job) ||
    artifact.dbRow !== undefined ||
    Boolean(firstString(artifact.workerLogExcerpt)) ||
    Boolean(firstString(artifact.workerLogPath)) ||
    Boolean(firstString(artifact.benchmarkReportPath)) ||
    cleanStringList(artifact.screenshotPaths).length > 0 ||
    cleanStringList(artifact.liveSnapshotPaths).length > 0 ||
    cleanStringList(artifact.notes).length > 0
  );
}
