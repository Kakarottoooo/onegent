import {
  analyzeProviderClosureArtifact,
  normalizeProviderClosureArtifact,
} from "./analyze";
import { assertProviderClosureArtifactIsSafe } from "./safety";
import {
  cleanStringList,
  firstString,
  isRecord,
  normalizeProviderClosureKind,
  providerClosureKindToCliKind,
  PROVIDER_CLOSURE_HARD_STOPS,
  PROVIDER_CLOSURE_SCHEMA_VERSION,
  ProviderClosureError,
  type NormalizedProviderClosureArtifact,
  type ProviderClosureAnalysis,
  type ProviderClosureArtifact,
  type ProviderClosureKind,
  type ProviderClosureTerminalOutcome,
  readString,
} from "./schema";

export const PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION = 1 as const;
export const PROVIDER_CLOSURE_WAR_ROOM_DEFAULT_MAX_AGE_HOURS = 168;

export type ProviderClosureVertical = "restaurant" | "flight" | "hotel";

export type ProviderClosureWarRoomVerdict =
  | "live_closed_safe_boundary"
  | "live_blocked_provider_or_network"
  | "live_blocked_selector_or_dom"
  | "live_blocked_model_or_env"
  | "not_live_verified"
  | "unsafe_or_disallowed_boundary";

export interface ProviderClosureScreenshotManifest {
  paths?: readonly string[];
  screenshots?: readonly string[];
  liveSnapshots?: readonly string[];
  generatedAt?: string;
  notes?: readonly string[];
}

export interface ProviderClosureWarRoomBundle {
  schemaVersion?: typeof PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION;
  warRoomSchemaVersion?: typeof PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION;
  vertical?: ProviderClosureVertical | "expedia" | "expedia-flight";
  kind?: ProviderClosureKind | "flight" | "expedia";
  synthetic?: boolean;
  fixtureId?: string;
  liveAttempt?: boolean;
  evidenceCapturedAt?: string;
  observedAt?: string;
  capturedAt?: string;
  artifact?: ProviderClosureArtifact | null;
  dbRow?: unknown;
  workerLogExcerpt?: string | null;
  workerLogPath?: string | null;
  screenshotPaths?: readonly string[];
  screenshotManifest?: ProviderClosureScreenshotManifest | null;
  liveSnapshotPaths?: readonly string[];
  benchmarkReportPath?: string | null;
  notes?: readonly string[];
  expectedVerdict?: ProviderClosureWarRoomVerdict;
}

export interface ProviderClosureEvidenceCompleteness {
  hasDbRow: boolean;
  hasJob: boolean;
  hasWorkerLogExcerpt: boolean;
  hasWorkerLogPath: boolean;
  hasScreenshotPaths: boolean;
  hasLiveSnapshotPaths: boolean;
  hasBenchmarkReportPath: boolean;
  hasOperatorNotes: boolean;
  hasMinimumLiveEvidence: boolean;
}

export interface ProviderClosureEvidenceFreshness {
  capturedAt: string | null;
  maxAgeHours: number;
  isFresh: boolean;
  reason: string;
}

export interface ProviderClosureEvidence {
  schemaVersion: typeof PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION;
  vertical: ProviderClosureVertical;
  kind: ProviderClosureKind;
  fixtureId: string | null;
  inputPath: string | null;
  synthetic: boolean;
  liveAttempt: boolean;
  generatedAt: string;
  evidenceCapturedAt: string | null;
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  dbRow: unknown;
  job: unknown;
  workerLogExcerpt: string | null;
  workerLogPath: string | null;
  screenshotPaths: string[];
  liveSnapshotPaths: string[];
  benchmarkReportPath: string | null;
  notes: string[];
  completeness: ProviderClosureEvidenceCompleteness;
  freshness: ProviderClosureEvidenceFreshness;
  normalizedArtifact: NormalizedProviderClosureArtifact;
}

export interface ProviderClosureUnsafeBoundaryFinding {
  label: string;
  excerpt: string;
}

export interface ProviderClosureDemoReadiness {
  canClaimVertical: boolean;
  verdictLabel: string;
  reason: string;
}

export interface ProviderClosureWarRoomResult {
  schemaVersion: typeof PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION;
  generatedAt: string;
  vertical: ProviderClosureVertical;
  kind: ProviderClosureKind;
  verdict: ProviderClosureWarRoomVerdict;
  terminalState: {
    providerOutcome: ProviderClosureTerminalOutcome;
    providerState: string;
    runtimeClass: string;
    status: string;
  };
  evidence: ProviderClosureEvidence;
  closureAnalysis: ProviderClosureAnalysis;
  unsafeFindings: ProviderClosureUnsafeBoundaryFinding[];
  whatHappened: string;
  rootCause: string;
  nextSingleAction: string;
  regressionChecklist: string[];
  demoReadiness: ProviderClosureDemoReadiness;
  hardStops: string[];
}

export interface ProviderClosureWarRoomOptions {
  inputPath?: string | null;
  rawText?: string | null;
  generatedAt?: string;
  maxAgeHours?: number;
}

export const PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL: Record<
  ProviderClosureWarRoomVerdict,
  string
> = {
  live_closed_safe_boundary: "Live attempt reached a safe closure boundary",
  live_blocked_provider_or_network: "Live attempt blocked by provider/network",
  live_blocked_selector_or_dom: "Live attempt blocked by selector/DOM drift",
  live_blocked_model_or_env: "Live attempt blocked by model/env transient",
  not_live_verified: "Not live verified",
  unsafe_or_disallowed_boundary: "Unsafe or disallowed boundary",
};

export function normalizeProviderClosureVertical(
  value: string | undefined,
): ProviderClosureVertical | null {
  const kind = normalizeProviderClosureKind(value);
  if (!kind) return null;
  return kind === "expedia-flight" ? "flight" : kind;
}

export function providerClosureVerticalToKind(
  vertical: ProviderClosureVertical,
): ProviderClosureKind {
  return vertical === "flight" ? "expedia-flight" : vertical;
}

export function providerClosureKindToVertical(
  kind: ProviderClosureKind,
): ProviderClosureVertical {
  return kind === "expedia-flight" ? "flight" : kind;
}

export function analyzeProviderClosureWarRoomBundle(
  payload: unknown,
  expectedVertical: ProviderClosureVertical,
  options: ProviderClosureWarRoomOptions = {},
): ProviderClosureWarRoomResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const evidence = ingestProviderClosureEvidence(payload, expectedVertical, {
    ...options,
    generatedAt,
  });
  const rawText = options.rawText ?? safeStringify(payload);
  const unsafeFindings = findUnsafeBoundaryFindings(rawText);
  const closureAnalysis = analyzeProviderClosureArtifact(
    evidence.normalizedArtifact.raw,
    evidence.kind,
    {
      inputPath: options.inputPath ?? null,
      rawText: safeStringify(evidence.normalizedArtifact.raw),
    },
  );
  const verdict = decideProviderClosureWarRoomVerdict(
    evidence,
    closureAnalysis,
    unsafeFindings,
  );

  return {
    schemaVersion: PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION,
    generatedAt,
    vertical: evidence.vertical,
    kind: evidence.kind,
    verdict,
    terminalState: {
      providerOutcome: closureAnalysis.terminalOutcome,
      providerState: closureAnalysis.providerAnalysis.state,
      runtimeClass: closureAnalysis.runtimeClass,
      status: closureAnalysis.status,
    },
    evidence,
    closureAnalysis,
    unsafeFindings,
    whatHappened: buildWhatHappened(evidence, closureAnalysis, verdict),
    rootCause: rootCauseForVerdict(verdict, closureAnalysis, unsafeFindings),
    nextSingleAction: nextSingleActionForVerdict(
      verdict,
      evidence,
      closureAnalysis,
    ),
    regressionChecklist: regressionChecklistForVerdict(
      verdict,
      evidence.vertical,
      closureAnalysis,
    ),
    demoReadiness: demoReadinessForVerdict(verdict, evidence),
    hardStops: [...PROVIDER_CLOSURE_HARD_STOPS],
  };
}

export function ingestProviderClosureEvidence(
  payload: unknown,
  expectedVertical: ProviderClosureVertical,
  options: ProviderClosureWarRoomOptions = {},
): ProviderClosureEvidence {
  if (!isRecord(payload)) {
    throw new ProviderClosureError(
      "invalid_schema",
      "Provider closure war-room bundle must be a JSON object.",
    );
  }

  const rawText = options.rawText ?? safeStringify(payload);
  assertProviderClosureArtifactIsSafe(rawText);

  const schemaVersion = payload.schemaVersion ?? payload.warRoomSchemaVersion;
  if (
    schemaVersion !== undefined &&
    schemaVersion !== PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION
  ) {
    throw new ProviderClosureError(
      "invalid_schema",
      `Unsupported provider closure war-room schemaVersion: ${String(schemaVersion)}.`,
    );
  }

  const requestedKind = providerClosureVerticalToKind(expectedVertical);
  const declaredVertical = normalizeProviderClosureVertical(
    typeof payload.vertical === "string" ? payload.vertical : undefined,
  );
  const declaredKind = normalizeProviderClosureKind(
    typeof payload.kind === "string" ? payload.kind : undefined,
  );
  const wrapperKind = declaredKind ?? (declaredVertical ? providerClosureVerticalToKind(declaredVertical) : null);
  if (wrapperKind && wrapperKind !== requestedKind) {
    throw new ProviderClosureError(
      "invalid_kind",
      `War-room bundle kind ${wrapperKind} does not match requested vertical ${expectedVertical}.`,
    );
  }

  const artifactPayload = buildArtifactPayload(payload, requestedKind);
  const normalizedArtifact = normalizeProviderClosureArtifact(
    artifactPayload,
    requestedKind,
    {
      inputPath: options.inputPath ?? null,
      rawText: safeStringify(artifactPayload),
    },
  );

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const screenshotPaths = mergeStringLists(
    normalizedArtifact.screenshotPaths,
    readManifestPaths(payload.screenshotManifest, "screenshots"),
    readManifestPaths(payload.screenshotManifest, "paths"),
  );
  const liveSnapshotPaths = mergeStringLists(
    normalizedArtifact.liveSnapshotPaths,
    readManifestPaths(payload.screenshotManifest, "liveSnapshots"),
  );
  const notes = mergeStringLists(
    normalizedArtifact.notes,
    readManifestPaths(payload.screenshotManifest, "notes"),
  );
  const job = normalizedArtifact.job ?? null;
  const dbRow = normalizedArtifact.dbRow;
  const evidenceCapturedAt = firstString(
    readString(payload, "evidenceCapturedAt"),
    readString(payload, "capturedAt"),
    readString(payload, "observedAt"),
    readString(dbRow, "updated_at"),
    readString(dbRow, "updatedAt"),
    readString(dbRow, "created_at"),
    readString(dbRow, "createdAt"),
  );
  const completeness = summarizeEvidenceCompleteness({
    dbRow,
    job,
    workerLogExcerpt: normalizedArtifact.workerLogExcerpt,
    workerLogPath: normalizedArtifact.workerLogPath,
    screenshotPaths,
    liveSnapshotPaths,
    benchmarkReportPath: normalizedArtifact.benchmarkReportPath,
    notes,
  });

  return {
    schemaVersion: PROVIDER_CLOSURE_WAR_ROOM_SCHEMA_VERSION,
    vertical: expectedVertical,
    kind: requestedKind,
    fixtureId: firstString(
      readString(payload, "fixtureId"),
      normalizedArtifact.fixtureId,
    ),
    inputPath: options.inputPath ?? null,
    synthetic: Boolean(payload.synthetic ?? normalizedArtifact.synthetic),
    liveAttempt: payload.liveAttempt === true,
    generatedAt,
    evidenceCapturedAt,
    jobId: firstString(
      normalizedArtifact.job?.id,
      readString(dbRow, "id"),
      readString(dbRow, "job_id"),
      readString(dbRow, "jobId"),
    ),
    taskId: firstString(
      normalizedArtifact.job?.taskId,
      readString(dbRow, "task_id"),
      readString(dbRow, "taskId"),
    ),
    provider:
      firstString(normalizedArtifact.job?.provider, readString(dbRow, "provider")) ??
      "unknown",
    scenario:
      firstString(normalizedArtifact.job?.scenario, readString(dbRow, "scenario")) ??
      "unknown",
    status:
      firstString(normalizedArtifact.job?.status, readString(dbRow, "status")) ??
      "unknown",
    dbRow,
    job,
    workerLogExcerpt: firstString(normalizedArtifact.workerLogExcerpt),
    workerLogPath: firstString(normalizedArtifact.workerLogPath),
    screenshotPaths,
    liveSnapshotPaths,
    benchmarkReportPath: firstString(normalizedArtifact.benchmarkReportPath),
    notes,
    completeness,
    freshness: evaluateEvidenceFreshness(evidenceCapturedAt, generatedAt, {
      maxAgeHours:
        options.maxAgeHours ?? PROVIDER_CLOSURE_WAR_ROOM_DEFAULT_MAX_AGE_HOURS,
    }),
    normalizedArtifact: {
      ...normalizedArtifact,
      screenshotPaths,
      liveSnapshotPaths,
      notes,
    },
  };
}

export function decideProviderClosureWarRoomVerdict(
  evidence: ProviderClosureEvidence,
  analysis: ProviderClosureAnalysis,
  unsafeFindings: readonly ProviderClosureUnsafeBoundaryFinding[] = [],
): ProviderClosureWarRoomVerdict {
  if (unsafeFindings.length > 0 || analysis.terminalOutcome === "unsafe_blocked") {
    return "unsafe_or_disallowed_boundary";
  }

  if (
    !evidence.liveAttempt ||
    !evidence.freshness.isFresh ||
    !evidence.completeness.hasMinimumLiveEvidence ||
    analysis.terminalOutcome === "insufficient_evidence"
  ) {
    return "not_live_verified";
  }

  switch (analysis.terminalOutcome) {
    case "safe_handoff":
    case "login_otp_boundary":
    case "no_availability":
      return "live_closed_safe_boundary";
    case "provider_degraded":
      return "live_blocked_provider_or_network";
    case "selector_drift":
      return "live_blocked_selector_or_dom";
    case "model_env_transient":
      return "live_blocked_model_or_env";
  }
}

export function findUnsafeBoundaryFindings(
  rawText: string,
): ProviderClosureUnsafeBoundaryFinding[] {
  const patterns: Array<{ label: string; rx: RegExp }> = [
    {
      label: "payment or purchase submitted",
      rx: /\b(submitted|clicked|pressed|confirmed|completed)\s+(payment|purchase|checkout|pay now|confirm and pay)\b/i,
    },
    {
      label: "final booking/reservation confirmation clicked",
      rx: /\b(clicked|pressed|submitted|confirmed|completed)\s+(final\s+)?(booking|reservation|reserve|purchase)\s+(confirmation|button|flow|step)\b/i,
    },
    {
      label: "CVV or security-code entry attempted",
      rx: /\b(entered|filled|submitted|typed)\s+(cvv|cvc|security[-\s]?code)\b/i,
    },
    {
      label: "account challenge bypass attempted",
      rx: /\bbypassed\s+(otp|one[-\s]?time code|captcha|login|sign[-\s]?in|phone verification|account check)\b/i,
    },
    {
      label: "verification challenge solved by automation",
      rx: /\b(automation|agent|worker)\s+(solved|handled|completed)\s+(otp|one[-\s]?time code|captcha|phone verification|account verification)\b/i,
    },
  ];

  const findings: ProviderClosureUnsafeBoundaryFinding[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const match = pattern.rx.exec(rawText);
    if (!match) continue;
    const excerpt = excerptAround(rawText, match.index, match[0].length);
    const key = `${pattern.label}|${excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ label: pattern.label, excerpt });
  }
  return findings;
}

export function formatProviderClosureWarRoomPreflightMarkdown(
  vertical: ProviderClosureVertical,
): string {
  const kind = providerClosureVerticalToKind(vertical);
  const cliKind = providerClosureKindToCliKind(kind);
  const artifactName =
    vertical === "flight"
      ? "expedia-retry-artifact-bundle.json"
      : `${vertical}-artifact-bundle.json`;

  return [
    `# Provider Closure War Room Preflight - ${vertical}`,
    "",
    "This is a no-live evidence harness. It does not approve or start provider, OpenAI, browser, worker, or booking automation.",
    "",
    "## Required Local Evidence",
    "",
    "- DB row JSON export from `booking_jobs`.",
    "- Worker log excerpt bounded around the approved attempt id.",
    "- Screenshot manifest or provider screenshot paths.",
    "- Live snapshot paths when available.",
    "- Operator notes naming any visible hard stop.",
    "- `liveAttempt: true` and `evidenceCapturedAt` only for a real human-approved attempt; synthetic fixtures must stay `synthetic: true`.",
    "",
    "## Build A Bundle",
    "",
    "```powershell",
    `npx tsx scripts/create-artifact-bundle-template.ts --kind ${vertical === "flight" ? "expedia" : vertical} > .tmp\\${artifactName}`,
    "```",
    "",
    "Then add the war-room fields around the artifact bundle:",
    "",
    "```json",
    JSON.stringify(
      {
        schemaVersion: 1,
        vertical,
        synthetic: false,
        liveAttempt: true,
        evidenceCapturedAt: "2026-05-04T20:00:00.000Z",
        artifact: "<artifact-bundle-json>",
        screenshotManifest: {
          paths: ["<path-to-provider-screenshot>"],
          liveSnapshots: ["<path-to-live-snapshot-json>"],
        },
      },
      null,
      2,
    ),
    "```",
    "",
    "Analyze and generate the closure report:",
    "",
    "```powershell",
    `npx tsx scripts/provider-closure-war-room.ts analyze --vertical ${vertical} --bundle .tmp\\${artifactName} --markdown`,
    "```",
    "",
    "## Hard Stops",
    "",
    ...PROVIDER_CLOSURE_HARD_STOPS.map((stop) => `- ${stop}`),
    "",
    "## Legacy Analyzer",
    "",
    `Use \`npx tsx scripts/provider-closure.ts report --kind ${cliKind} --artifact <bundle.json> --markdown\` when you only need the lower-level analyzer report.`,
  ].join("\n");
}

export function formatProviderClosureWarRoomReportMarkdown(
  result: ProviderClosureWarRoomResult,
): string {
  const lines: string[] = [];
  lines.push("# Provider Closure War Room Report");
  lines.push("");
  lines.push(`- **Vertical**: \`${result.vertical}\``);
  lines.push(`- **Verdict**: \`${result.verdict}\` (${PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[result.verdict]})`);
  lines.push(`- **Provider outcome**: \`${result.terminalState.providerOutcome}\``);
  lines.push(`- **Provider state**: \`${result.terminalState.providerState}\``);
  lines.push(`- **Runtime class**: \`${result.terminalState.runtimeClass}\``);
  lines.push(`- **Job id**: \`${result.evidence.jobId ?? "(unknown)"}\``);
  if (result.evidence.taskId) {
    lines.push(`- **Task id**: \`${result.evidence.taskId}\``);
  }
  lines.push(`- **Provider**: \`${result.evidence.provider}\``);
  lines.push(`- **Scenario**: \`${result.evidence.scenario}\``);
  lines.push(`- **Status**: \`${result.evidence.status}\``);
  lines.push(`- **Live marker**: \`${result.evidence.liveAttempt ? "present" : "missing"}\``);
  lines.push(`- **Synthetic**: \`${result.evidence.synthetic ? "yes" : "no"}\``);
  lines.push(`- **Freshness**: \`${result.evidence.freshness.reason}\``);
  lines.push("");
  lines.push("## Exact Terminal State");
  lines.push("");
  lines.push(
    `Provider outcome \`${result.terminalState.providerOutcome}\`, provider analyzer state \`${result.terminalState.providerState}\`, runtime class \`${result.terminalState.runtimeClass}\`.`,
  );
  lines.push("");
  lines.push("## Evidence Files");
  lines.push("");
  appendEvidenceFiles(lines, result);
  lines.push("");
  lines.push("## What Happened");
  lines.push("");
  lines.push(result.whatHappened);
  lines.push("");
  lines.push("## Root Cause");
  lines.push("");
  lines.push(result.rootCause);
  lines.push("");
  lines.push("## Next Single Action");
  lines.push("");
  lines.push(result.nextSingleAction);
  lines.push("");
  lines.push("## Regression Checklist");
  lines.push("");
  for (const item of result.regressionChecklist) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Demo Readiness");
  lines.push("");
  lines.push(`- **Can claim this vertical**: \`${result.demoReadiness.canClaimVertical ? "yes" : "no"}\``);
  lines.push(`- **Reason**: ${result.demoReadiness.reason}`);
  lines.push("");
  if (result.unsafeFindings.length > 0) {
    lines.push("## Unsafe Boundary Findings");
    lines.push("");
    for (const finding of result.unsafeFindings) {
      lines.push(`- **${finding.label}**: ${escapeMarkdownLine(finding.excerpt)}`);
    }
    lines.push("");
  }
  lines.push("## Hard Stops");
  lines.push("");
  for (const hardStop of result.hardStops) {
    lines.push(`- ${hardStop}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatProviderClosureWarRoomSummaryMarkdown(
  results: readonly ProviderClosureWarRoomResult[],
): string {
  const lines: string[] = [];
  lines.push("# Provider Closure War Room Summary");
  lines.push("");
  lines.push("This summary is produced from local artifacts only. Synthetic fixtures cannot prove live readiness.");
  lines.push("");
  for (const vertical of ["restaurant", "flight", "hotel"] as const) {
    const verticalResults = results.filter((result) => result.vertical === vertical);
    lines.push(`## ${vertical}`);
    lines.push("");
    if (verticalResults.length === 0) {
      lines.push("- No local artifact results were provided.");
      lines.push("");
      continue;
    }
    const counts = countByVerdict(verticalResults);
    for (const [verdict, count] of Object.entries(counts)) {
      lines.push(`- \`${verdict}\`: ${count}`);
    }
    const claimable = verticalResults.find(
      (result) => result.demoReadiness.canClaimVertical,
    );
    lines.push(
      `- Demo claim: ${claimable ? "yes" : "no"}${claimable ? ` from ${claimable.evidence.jobId ?? claimable.evidence.fixtureId ?? "artifact"}` : ""}`,
    );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function formatProviderClosureDemoVerdictMarkdown(
  results: readonly ProviderClosureWarRoomResult[],
): string {
  const lines: string[] = [];
  lines.push("# Provider Closure Demo Verdict");
  lines.push("");
  lines.push("A vertical is claimable only when a non-synthetic, fresh, minimum-evidence live artifact reaches `live_closed_safe_boundary`.");
  lines.push("");

  let allClaimable = true;
  for (const vertical of ["restaurant", "flight", "hotel"] as const) {
    const claimable = results.find(
      (result) =>
        result.vertical === vertical && result.demoReadiness.canClaimVertical,
    );
    if (!claimable) allClaimable = false;
    const latest = results.find((result) => result.vertical === vertical);
    lines.push(
      `- **${vertical}**: ${claimable ? "claimable" : "not claimable"} - ${claimable?.demoReadiness.reason ?? latest?.demoReadiness.reason ?? "no artifact result"}`,
    );
  }

  lines.push("");
  lines.push(`Overall demo claim: \`${allClaimable ? "ready" : "not_ready"}\``);
  return `${lines.join("\n")}\n`;
}

function buildArtifactPayload(
  payload: Record<string, unknown>,
  kind: ProviderClosureKind,
): Record<string, unknown> {
  const artifact = isRecord(payload.artifact)
    ? { ...payload.artifact }
    : { ...payload };
  const screenshotManifest = isRecord(payload.screenshotManifest)
    ? payload.screenshotManifest
    : null;

  artifact.schemaVersion =
    artifact.schemaVersion ?? PROVIDER_CLOSURE_SCHEMA_VERSION;
  artifact.kind = normalizeProviderClosureKind(
    typeof artifact.kind === "string" ? artifact.kind : undefined,
  ) ?? kind;
  artifact.synthetic = artifact.synthetic ?? payload.synthetic;
  artifact.fixtureId = artifact.fixtureId ?? payload.fixtureId;
  artifact.dbRow = artifact.dbRow ?? payload.dbRow;
  artifact.workerLogExcerpt =
    artifact.workerLogExcerpt ?? payload.workerLogExcerpt;
  artifact.workerLogPath = artifact.workerLogPath ?? payload.workerLogPath;
  artifact.benchmarkReportPath =
    artifact.benchmarkReportPath ?? payload.benchmarkReportPath;
  artifact.screenshotPaths = mergeStringLists(
    artifact.screenshotPaths as readonly string[] | undefined,
    payload.screenshotPaths as readonly string[] | undefined,
    readManifestPaths(screenshotManifest, "paths"),
    readManifestPaths(screenshotManifest, "screenshots"),
  );
  artifact.liveSnapshotPaths = mergeStringLists(
    artifact.liveSnapshotPaths as readonly string[] | undefined,
    payload.liveSnapshotPaths as readonly string[] | undefined,
    readManifestPaths(screenshotManifest, "liveSnapshots"),
  );
  artifact.notes = mergeStringLists(
    artifact.notes as readonly string[] | undefined,
    payload.notes as readonly string[] | undefined,
    readManifestPaths(screenshotManifest, "notes"),
  );

  return artifact;
}

function summarizeEvidenceCompleteness(input: {
  dbRow: unknown;
  job: unknown;
  workerLogExcerpt?: string | null;
  workerLogPath?: string | null;
  screenshotPaths: readonly string[];
  liveSnapshotPaths: readonly string[];
  benchmarkReportPath?: string | null;
  notes: readonly string[];
}): ProviderClosureEvidenceCompleteness {
  const hasDbRow = input.dbRow !== undefined && input.dbRow !== null;
  const hasJob = isRecord(input.job);
  const hasWorkerLogExcerpt = Boolean(firstString(input.workerLogExcerpt));
  const hasWorkerLogPath = Boolean(firstString(input.workerLogPath));
  const hasScreenshotPaths = input.screenshotPaths.length > 0;
  const hasLiveSnapshotPaths = input.liveSnapshotPaths.length > 0;
  const hasBenchmarkReportPath = Boolean(firstString(input.benchmarkReportPath));
  const hasOperatorNotes = input.notes.length > 0;

  return {
    hasDbRow,
    hasJob,
    hasWorkerLogExcerpt,
    hasWorkerLogPath,
    hasScreenshotPaths,
    hasLiveSnapshotPaths,
    hasBenchmarkReportPath,
    hasOperatorNotes,
    hasMinimumLiveEvidence:
      (hasDbRow || hasJob) &&
      hasWorkerLogExcerpt &&
      (hasScreenshotPaths || hasLiveSnapshotPaths),
  };
}

function evaluateEvidenceFreshness(
  capturedAt: string | null,
  generatedAt: string,
  options: { maxAgeHours: number },
): ProviderClosureEvidenceFreshness {
  if (!capturedAt) {
    return {
      capturedAt: null,
      maxAgeHours: options.maxAgeHours,
      isFresh: false,
      reason: "missing evidenceCapturedAt",
    };
  }

  const capturedMs = Date.parse(capturedAt);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(generatedMs)) {
    return {
      capturedAt,
      maxAgeHours: options.maxAgeHours,
      isFresh: false,
      reason: "invalid evidence timestamp",
    };
  }

  const ageHours = (generatedMs - capturedMs) / (1000 * 60 * 60);
  if (ageHours < -1) {
    return {
      capturedAt,
      maxAgeHours: options.maxAgeHours,
      isFresh: false,
      reason: "evidence timestamp is in the future",
    };
  }
  if (ageHours > options.maxAgeHours) {
    return {
      capturedAt,
      maxAgeHours: options.maxAgeHours,
      isFresh: false,
      reason: `stale evidence (${Math.floor(ageHours)}h old)`,
    };
  }
  return {
    capturedAt,
    maxAgeHours: options.maxAgeHours,
    isFresh: true,
    reason: `fresh evidence (${Math.max(0, Math.floor(ageHours))}h old)`,
  };
}

function buildWhatHappened(
  evidence: ProviderClosureEvidence,
  analysis: ProviderClosureAnalysis,
  verdict: ProviderClosureWarRoomVerdict,
): string {
  return [
    `${evidence.vertical} evidence normalized to job ${evidence.jobId ?? "(unknown)"} with provider ${evidence.provider}.`,
    `The domain analyzer returned ${analysis.providerAnalysis.state}; runtime-forensics returned ${analysis.runtimeClass}.`,
    `The war-room verdict is ${verdict}.`,
  ].join(" ");
}

function rootCauseForVerdict(
  verdict: ProviderClosureWarRoomVerdict,
  analysis: ProviderClosureAnalysis,
  unsafeFindings: readonly ProviderClosureUnsafeBoundaryFinding[],
): string {
  switch (verdict) {
    case "live_closed_safe_boundary":
      return `The attempt reached an accepted safe boundary: ${analysis.outcomeLabel}.`;
    case "live_blocked_provider_or_network":
      return "Provider or network instability blocked the attempt before selector conclusions are reliable.";
    case "live_blocked_selector_or_dom":
      return "Provider DOM, selector, card matching, or boundary detection drift blocked closure.";
    case "live_blocked_model_or_env":
      return "OpenAI/model/runtime environment failed independently of provider selectors.";
    case "unsafe_or_disallowed_boundary":
      return unsafeFindings.length > 0
        ? `A disallowed automation boundary was detected: ${unsafeFindings[0].label}.`
        : "The analyzer classified the artifact as an unsafe or blocked boundary.";
    case "not_live_verified":
      return "The bundle lacks a fresh, non-placeholder live evidence chain or enough DB/log/screenshot evidence to prove a live closure result.";
  }
}

function nextSingleActionForVerdict(
  verdict: ProviderClosureWarRoomVerdict,
  evidence: ProviderClosureEvidence,
  analysis: ProviderClosureAnalysis,
): string {
  const commandKind = providerClosureKindToCliKind(evidence.kind);
  switch (verdict) {
    case "live_closed_safe_boundary":
      return "Record this artifact as the closure result for the vertical and do not repeat the same case without a new human-approved reason.";
    case "live_blocked_provider_or_network":
      return "Preserve DB/log/screenshot evidence and wait for provider/network health before any single human-approved follow-up attempt.";
    case "live_blocked_selector_or_dom":
      return "Patch only the smallest selector or DOM-boundary gap proven by screenshots, then add a synthetic regression fixture before any future live attempt.";
    case "live_blocked_model_or_env":
      return "Check model/OpenAI/env health and keep provider selectors unchanged unless a separate artifact proves provider drift.";
    case "unsafe_or_disallowed_boundary":
      return "Stop and open a safety root-cause review. Do not retry or continue the provider flow from this artifact.";
    case "not_live_verified":
      if (!evidence.freshness.isFresh || !evidence.completeness.hasMinimumLiveEvidence) {
        return `Collect DB row JSON, bounded worker log excerpt, screenshot paths, live snapshot paths, and a fresh evidenceCapturedAt, then rerun: npx tsx scripts/provider-closure-war-room.ts analyze --vertical ${evidence.vertical} --bundle <bundle.json> --markdown`;
      }
      return analysis.exactNextStep.replace("scripts/provider-closure.ts", `scripts/provider-closure-war-room.ts analyze --vertical ${evidence.vertical} --bundle`);
  }
}

function regressionChecklistForVerdict(
  verdict: ProviderClosureWarRoomVerdict,
  vertical: ProviderClosureVertical,
  analysis: ProviderClosureAnalysis,
): string[] {
  const common = [
    "Keep the artifact bundle as a no-live fixture or report input with PII/secrets removed.",
    "Verify DB row, worker log excerpt, screenshot paths, and live snapshot paths agree.",
    "Run targeted analyzer tests for this vertical before any patch handoff.",
  ];

  switch (verdict) {
    case "live_closed_safe_boundary":
      return [
        ...common,
        "Add the report link to the closure handoff and mark the same exact case as not worth repeating.",
      ];
    case "live_blocked_provider_or_network":
      return [
        ...common,
        "Add or update a provider/network-degraded fixture if this class is not already covered.",
        "Do not add selector patches from provider/network evidence alone.",
      ];
    case "live_blocked_selector_or_dom":
      return [
        ...common,
        `Add a ${vertical} selector/DOM drift fixture that reproduces ${analysis.providerAnalysis.state}.`,
        "Patch the smallest provider-specific analyzer/runtime gap only after screenshot confirmation.",
      ];
    case "live_blocked_model_or_env":
      return [
        ...common,
        "Keep OpenAI Responses API 500 and model/env outages classified away from provider failures.",
        "Do not patch provider selectors from model/env evidence alone.",
      ];
    case "unsafe_or_disallowed_boundary":
      return [
        ...common,
        "Add a safety regression fixture or static guard for the disallowed boundary.",
        "Do not schedule another provider attempt until a human reviews the safety root cause.",
      ];
    case "not_live_verified":
      return [
        ...common,
        "Do not claim live readiness from synthetic, stale, placeholder, or incomplete evidence.",
        "Collect the missing DB/log/screenshot/snapshot fields before making a closure claim.",
      ];
  }
}

function demoReadinessForVerdict(
  verdict: ProviderClosureWarRoomVerdict,
  evidence: ProviderClosureEvidence,
): ProviderClosureDemoReadiness {
  if (verdict !== "live_closed_safe_boundary") {
    return {
      canClaimVertical: false,
      verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
      reason: `Cannot claim because verdict is ${verdict}.`,
    };
  }
  if (evidence.synthetic) {
    return {
      canClaimVertical: false,
      verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
      reason: "Cannot claim from a synthetic no-live fixture.",
    };
  }
  if (!evidence.liveAttempt) {
    return {
      canClaimVertical: false,
      verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
      reason: "Cannot claim without an explicit liveAttempt marker.",
    };
  }
  if (!evidence.freshness.isFresh) {
    return {
      canClaimVertical: false,
      verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
      reason: `Cannot claim because ${evidence.freshness.reason}.`,
    };
  }
  if (!evidence.completeness.hasMinimumLiveEvidence) {
    return {
      canClaimVertical: false,
      verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
      reason: "Cannot claim until DB/log/screenshot or snapshot evidence is present.",
    };
  }
  return {
    canClaimVertical: true,
    verdictLabel: PROVIDER_CLOSURE_WAR_ROOM_VERDICT_LABEL[verdict],
    reason: "Fresh non-synthetic live evidence reached a safe boundary.",
  };
}

function appendEvidenceFiles(
  lines: string[],
  result: ProviderClosureWarRoomResult,
): void {
  if (result.evidence.inputPath) {
    lines.push(`- Bundle: \`${result.evidence.inputPath}\``);
  }
  if (result.evidence.workerLogPath) {
    lines.push(`- Worker log: \`${result.evidence.workerLogPath}\``);
  }
  if (result.evidence.benchmarkReportPath) {
    lines.push(`- Benchmark report: \`${result.evidence.benchmarkReportPath}\``);
  }
  for (const screenshot of result.evidence.screenshotPaths) {
    lines.push(`- Screenshot: \`${screenshot}\``);
  }
  for (const snapshot of result.evidence.liveSnapshotPaths) {
    lines.push(`- Live snapshot: \`${snapshot}\``);
  }
  if (
    !result.evidence.inputPath &&
    !result.evidence.workerLogPath &&
    !result.evidence.benchmarkReportPath &&
    result.evidence.screenshotPaths.length === 0 &&
    result.evidence.liveSnapshotPaths.length === 0
  ) {
    lines.push("- No file paths were included.");
  }
}

function countByVerdict(
  results: readonly ProviderClosureWarRoomResult[],
): Partial<Record<ProviderClosureWarRoomVerdict, number>> {
  const counts: Partial<Record<ProviderClosureWarRoomVerdict, number>> = {};
  for (const result of results) {
    counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;
  }
  return counts;
}

function readManifestPaths(
  value: unknown,
  key: "paths" | "screenshots" | "liveSnapshots" | "notes",
): string[] {
  if (!isRecord(value)) return [];
  return cleanStringList(value[key] as readonly string[] | undefined);
}

function mergeStringLists(
  ...values: Array<readonly string[] | null | undefined>
): string[] {
  return Array.from(new Set(values.flatMap((value) => cleanStringList(value))));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 100);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function escapeMarkdownLine(text: string): string {
  return text.replace(/`/g, "\\`").replace(/\s+/g, " ").trim();
}
