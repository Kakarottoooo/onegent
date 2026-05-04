/**
 * Runtime Forensics — type contracts.
 *
 * V1 is artifact-based: the parser ingests duck-typed `JobLikeInput`
 * objects assembled by the loader from filesystem sources
 * (benchmark/runs/*.json, worker/.debug-screenshots/<provider>/<run>/
 * summary.json, optional ./codex-worker.log excerpt). DB live lookup
 * is explicitly out-of-scope for V1 — codex's domain when added.
 *
 * The duck typing means: the parser does NOT depend on the canonical
 * Postgres schema. Any source that produces a JobLikeInput-shaped
 * object can feed the same classifier.
 *
 * Pure types module — zero runtime code, zero IO. Imported by
 * client + server + tests alike.
 */

export const RUNTIME_FORENSICS_SCHEMA_VERSION = 1 as const;

/* ─── Failure taxonomy ────────────────────────────────────────────── */

/**
 * The 8 failure classifications the workbench surfaces. Order
 * matches the spec; severity assignments below are tuned per
 * founder's lock-in (`legacy_shape_missing_source` is P0).
 */
export type FailureClass =
  | "legacy_shape_missing_source"
  | "provider_no_availability"
  | "provider_form_incomplete"
  | "otp_or_login_required"
  | "checkout_reached_manual_review"
  | "model_or_env_blocked"
  | "network_or_provider_5xx"
  | "unknown";

/** Severity of a classified failure. P0 blocks; P3 is informational. */
export type ForensicsSeverity = "p0" | "p1" | "p2" | "p3" | "info";

/** Confidence the classifier has in its primary verdict. */
export type ClassifierConfidence = "high" | "medium" | "low";

/** UI-friendly label for each failure class. */
export const FAILURE_CLASS_LABEL: Record<FailureClass, string> = {
  legacy_shape_missing_source: "Legacy-shape step (missing __source marker)",
  provider_no_availability: "Provider returned no availability",
  provider_form_incomplete: "Provider form fill incomplete",
  otp_or_login_required: "OTP / login required (expected boundary)",
  checkout_reached_manual_review: "Reached checkout — manual review required",
  model_or_env_blocked: "Model / environment blocked",
  network_or_provider_5xx: "Network or provider 5xx error",
  unknown: "Unknown — needs human triage",
};

/** Severity mapping. Used by classifier + UI verdict cards. */
export const FAILURE_CLASS_SEVERITY: Record<FailureClass, ForensicsSeverity> = {
  legacy_shape_missing_source: "p0",
  provider_no_availability: "info",
  provider_form_incomplete: "p1",
  otp_or_login_required: "info",
  checkout_reached_manual_review: "info",
  model_or_env_blocked: "p1",
  network_or_provider_5xx: "p2",
  unknown: "p2",
};

/** Tone hint for dashboard rendering. */
export const FAILURE_CLASS_TONE: Record<
  FailureClass,
  "bad" | "warn" | "good" | "neutral"
> = {
  legacy_shape_missing_source: "bad", // P0 — red
  provider_no_availability: "neutral",
  provider_form_incomplete: "warn",
  otp_or_login_required: "neutral",
  checkout_reached_manual_review: "good",
  model_or_env_blocked: "warn",
  network_or_provider_5xx: "warn",
  unknown: "warn",
};

/** Display label for severity. */
export const FORENSICS_SEVERITY_LABEL: Record<ForensicsSeverity, string> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
  info: "INFO",
};

/* ─── Input duck types ────────────────────────────────────────────── */

/**
 * A booking-job-like input. Every field is optional to maximize the
 * range of sources we can ingest (DB row, benchmark report row,
 * worker log excerpt, screenshot summary.json). The classifier
 * tolerates missing fields gracefully.
 *
 * NOTE: this is intentionally NOT imported from `lib/db.ts`. Codex
 * owns the canonical schema; this duck type lets us evolve the
 * forensics module without coupling.
 */
export interface JobLikeInput {
  /** Booking-job UUID if known. */
  id?: string | null;
  /** Parent task UUID if known. */
  taskId?: string | null;
  /** Free-form session id (resy session, OAuth session, etc.). */
  sessionId?: string | null;
  /** Lower-case provider name: "resy" / "opentable" / "expedia" / "booking-com" / "hotels-com". */
  provider?: string | null;
  /** Free-form scenario id (e.g. "R-003" for restaurant fixtures). */
  scenario?: string | null;
  /**
   * Job status string. Accepts whatever upstream supplied; the
   * classifier doesn't insist on a specific enum. Common values:
   * "pending" / "running" / "ready_for_confirmation" / "failed" /
   * "succeeded" / "cancelled".
   */
  status?: string | null;
  /** Top-level error message if the job terminated. */
  errorMessage?: string | null;
  /** Higher-level terminal reason (often a category). */
  terminalReason?: string | null;
  /** Machine-readable terminal code (e.g. "PROVIDER_NO_SLOT"). */
  terminalCode?: string | null;
  /** ISO timestamps if known. */
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Steps the job ran. Order: oldest first. */
  steps?: StepLikeInput[] | null;
  /** Decision-log entries. */
  decisionLog?: DecisionLogEntryLike[] | null;
  /** Original params blob — used for provider-specific quirks. */
  params?: Record<string, unknown> | null;
  /**
   * A raw multi-line string excerpt from the worker log
   * (codex-worker.log) that may match patterns the structured
   * fields don't capture. Optional. Bounded by loader.
   */
  rawWorkerLogExcerpt?: string | null;
  /** Whether debug screenshots are present for this job's session. */
  rawScreenshotsAvailable?: boolean;
  /** Optional screenshot summary if loader read summary.json. */
  rawScreenshotSummary?: unknown;
  /** Free-form notes the loader / parser may attach. */
  loaderNotes?: string[];
}

/** A single execution step. Duck-typed against the canonical schema. */
export interface StepLikeInput {
  name?: string | null;
  type?: string | null;
  error?: string | null;
  timestamp?: string | null;
  /**
   * The `__source` marker field. Presence indicates the step came
   * from a normalized executor pipeline (lib/core/execution or
   * lib/execution-v2). Absence on a step that hit the worker
   * means the worker received a legacy-shape step — a P0 bug.
   */
  __source?: string | null;
  result?: unknown;
  /** Anything else the source attached. */
  meta?: Record<string, unknown>;
}

/** A single decision-log entry. */
export interface DecisionLogEntryLike {
  at?: string | null;
  level?: string | null;
  event?: string | null;
  data?: unknown;
  message?: string | null;
}

/* ─── Classifier output ───────────────────────────────────────────── */

/** A single signal that contributed to the classifier verdict. */
export interface ClassifierSignal {
  /** Where the signal came from. */
  source:
    | "error_message"
    | "terminal_reason"
    | "terminal_code"
    | "step_error"
    | "decision_log"
    | "raw_worker_log"
    | "step_shape_audit"
    | "status_field";
  /** A short human label ("phrase: missing __source marker"). */
  label: string;
  /** Optional excerpt from the source field, truncated to ~200 chars. */
  excerpt?: string;
  /** Which class this signal supports. */
  supportsClass: FailureClass;
  /** Weight in the [0, 1] range. */
  weight: number;
}

/** Outcome of the classifier on one job. */
export interface ClassificationResult {
  primaryClass: FailureClass;
  severity: ForensicsSeverity;
  confidence: ClassifierConfidence;
  /** All signals matched, ordered by descending weight. */
  signals: ClassifierSignal[];
  /** Aggregated weight per class for transparency. */
  perClassWeights: Partial<Record<FailureClass, number>>;
  /**
   * Alternative classes that also matched, sorted by weight
   * descending. Excludes the primary class.
   */
  alternatives: Array<{ class: FailureClass; weight: number }>;
}

/* ─── Step-shape audit ────────────────────────────────────────────── */

/** A single per-step audit row. */
export interface StepShapeAuditRow {
  index: number;
  name: string;
  hasSourceMarker: boolean;
  /** "lib/core/execution" / "lib/execution-v2" / undefined / "unknown". */
  sourceMarker?: string;
  /** Whether the step's error mentions legacy-shape patterns. */
  errorMentionsLegacyShape: boolean;
  /** Snippet of the step error (≤200 chars). */
  errorExcerpt?: string;
}

/** Summary of step-shape across the whole job. */
export interface StepShapeAuditResult {
  totalSteps: number;
  stepsWithSourceMarker: number;
  stepsMissingSourceMarker: number;
  /** True if any step indicates the legacy-shape worker bug. */
  hasLegacyShapeBug: boolean;
  /** Per-step audit detail. */
  rows: StepShapeAuditRow[];
  /** Excerpt of any "Worker received legacy-shape step" matches. */
  legacyShapeQuotes: string[];
}

/* ─── Decision log summary ────────────────────────────────────────── */

/** Compact view of decision-log entries. */
export interface DecisionLogSummary {
  totalEntries: number;
  byLevel: Partial<Record<string, number>>;
  /** Top events seen, with count. */
  topEvents: Array<{ event: string; count: number }>;
  /** First 6 + last 6 entries (or fewer if total < 12), in chronological order. */
  excerpts: DecisionLogEntryLike[];
  /** Any phrases of interest that match known signal patterns. */
  notableSignals: string[];
}

/* ─── ForensicsReport (the unit the dashboard renders) ─────────────── */

/**
 * The full forensics report for one booking job. Consumed by the
 * dashboard + the markdown bug-report formatter.
 */
export interface ForensicsReport {
  schemaVersion: typeof RUNTIME_FORENSICS_SCHEMA_VERSION;
  /** Source label: "benchmark-run" / "screenshot-summary" / "worker-log" / "merged". */
  inputSource: string;
  /** Generated timestamp. */
  generatedAt: string;
  /** Echo of the duck-typed input fields (sanitized). */
  jobId: string | null;
  taskId: string | null;
  sessionId: string | null;
  provider: string;
  scenario: string;
  status: string;
  rawTerminalReason: string | null;
  rawTerminalCode: string | null;
  rawErrorMessage: string | null;
  /** When the job last updated, if known. */
  updatedAt: string | null;
  /** Core analytic outputs. */
  classification: ClassificationResult;
  stepShape: StepShapeAuditResult;
  decisionLogSummary: DecisionLogSummary;
  /**
   * Cross-reference hints for the dashboard to render links.
   * Filled by the loader from filesystem state, not by the parser.
   */
  hints: ForensicsHints;
  /** Loader-attached notes about source completeness. */
  notes: string[];
  /**
   * True when this report was loaded from a static fixture file
   * under `lib/runtime-forensics/__fixtures__/`. Dashboards must
   * visibly tag these rows `[FIXTURE]` so operators do not mistake
   * fixtures for real evidence. Defaults to false.
   */
  isFixture: boolean;
}

/** Cross-reference + side-band info the loader hands the parser. */
export interface ForensicsHints {
  hasScreenshots: boolean;
  screenshotsRel?: string; // relative under worker/.debug-screenshots/
  benchmarkReportFile?: string; // filename under benchmark/runs/
  taskPagePath?: string; // /tasks/<taskId> if known
}

/** Compact summary used in the dashboard table. */
export interface ForensicsSummary {
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  primaryClass: FailureClass;
  severity: ForensicsSeverity;
  hasLegacyShapeBug: boolean;
  ageSeconds: number | null;
  updatedAt: string | null;
  inputSource: string;
  /**
   * Mirrors `ForensicsReport.isFixture`. Defaults to false on real
   * artifacts. Dashboards render a `[FIXTURE]` tag when true.
   */
  isFixture: boolean;
}

/* ─── Filter input shape (for API + dashboard) ────────────────────── */

export interface ForensicsListFilter {
  jobId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  provider?: string | null;
  status?: string | null;
  primaryClass?: FailureClass | null;
}

/* ─── Errors ──────────────────────────────────────────────────────── */

export class RuntimeForensicsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeForensicsParseError";
  }
}

export class RuntimeForensicsLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeForensicsLoaderError";
  }
}
