import type {
  ClassificationResult,
  ClassifierConfidence,
  FailureClass,
  ForensicsSeverity,
  JobLikeInput,
} from "@/lib/runtime-forensics/types";

export const PROVIDER_CLOSURE_SCHEMA_VERSION = 1 as const;

export type ProviderClosureKind = "restaurant" | "expedia-flight" | "hotel";

export type ProviderClosureCliKind =
  | ProviderClosureKind
  | "flight"
  | "expedia";

export type ProviderClosureTerminalOutcome =
  | "safe_handoff"
  | "login_otp_boundary"
  | "no_availability"
  | "provider_degraded"
  | "selector_drift"
  | "model_env_transient"
  | "unsafe_blocked"
  | "insufficient_evidence";

export type ProviderClosureSourceKind =
  | "db_row_json"
  | "job_json"
  | "worker_log_excerpt"
  | "worker_log_path"
  | "screenshot_paths"
  | "live_snapshot_paths"
  | "benchmark_report_path"
  | "analyzer_fixture"
  | "operator_notes";

export type ProviderClosureErrorCode =
  | "usage"
  | "invalid_command"
  | "invalid_kind"
  | "missing_file"
  | "invalid_json"
  | "invalid_schema"
  | "empty_artifact"
  | "unsafe_artifact";

export class ProviderClosureError extends Error {
  readonly code: ProviderClosureErrorCode;
  readonly exitCode: number;

  constructor(code: ProviderClosureErrorCode, message: string) {
    super(message);
    this.name = "ProviderClosureError";
    this.code = code;
    this.exitCode = 1;
  }
}

export interface ProviderClosureArtifact {
  schemaVersion?: typeof PROVIDER_CLOSURE_SCHEMA_VERSION;
  kind?: ProviderClosureKind;
  synthetic?: boolean;
  fixtureId?: string;
  templateId?: string;
  templateKind?: string;
  job?: JobLikeInput | null;
  dbRow?: unknown;
  workerLogExcerpt?: string | null;
  workerLogPath?: string | null;
  benchmarkReportPath?: string | null;
  screenshotPaths?: readonly string[];
  liveSnapshotPaths?: readonly string[];
  analyzerFixturePath?: string | null;
  notes?: readonly string[];
}

export interface NormalizedProviderClosureArtifact
  extends ProviderClosureArtifact {
  schemaVersion: typeof PROVIDER_CLOSURE_SCHEMA_VERSION;
  kind: ProviderClosureKind;
  inputPath: string | null;
  raw: Record<string, unknown>;
}

export interface ProviderClosureArtifactPaths {
  workerLogPath: string | null;
  benchmarkReportPath: string | null;
  screenshots: string[];
  liveSnapshots: string[];
  analyzerFixturePath: string | null;
}

export interface ProviderClosureSourceSummary {
  kind: ProviderClosureSourceKind;
  label: string;
  present: boolean;
  detail: string | null;
}

export interface ProviderClosureProviderAnalysis {
  state: string;
  label: string;
  confidence: ClassifierConfidence;
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  summary: string;
  nextAction: string;
  signals: ProviderClosureSignal[];
}

export interface ProviderClosureSignal {
  source: string;
  label: string;
  excerpt: string;
}

export interface ProviderClosureAnalysis {
  schemaVersion: typeof PROVIDER_CLOSURE_SCHEMA_VERSION;
  kind: ProviderClosureKind;
  generatedAt: string;
  terminalOutcome: ProviderClosureTerminalOutcome;
  outcomeLabel: string;
  confidence: ClassifierConfidence;
  jobId: string | null;
  taskId: string | null;
  provider: string;
  scenario: string;
  status: string;
  providerAnalysis: ProviderClosureProviderAnalysis;
  runtimeClassification: ClassificationResult;
  runtimeClass: FailureClass;
  runtimeSeverity: ForensicsSeverity;
  artifactPaths: ProviderClosureArtifactPaths;
  sources: ProviderClosureSourceSummary[];
  summary: string;
  exactNextStep: string;
  recommendedControlledRun: string;
  hardStops: string[];
}

export const PROVIDER_CLOSURE_TERMINAL_OUTCOME_LABEL: Record<
  ProviderClosureTerminalOutcome,
  string
> = {
  safe_handoff: "Safe handoff reached",
  login_otp_boundary: "Login/OTP boundary reached",
  no_availability: "No availability",
  provider_degraded: "Provider/network degraded",
  selector_drift: "Selector/runtime drift",
  model_env_transient: "Model/env transient",
  unsafe_blocked: "Unsafe or blocked state",
  insufficient_evidence: "Insufficient evidence",
};

export const PROVIDER_CLOSURE_HARD_STOPS = [
  "No live provider run from this harness.",
  "No live OpenAI call from this harness.",
  "No provider browser automation from this harness.",
  "No payment, CVV/CVC/security-code, or card-number submission.",
  "No OTP, CAPTCHA, phone-verification, login, or account-check bypass.",
  "No final booking, reserve, purchase, or confirmation click.",
  "No run/retry/live buttons, retry loops, cron jobs, or one-click live controls.",
] as const;

export function normalizeProviderClosureKind(
  value: string | undefined,
): ProviderClosureKind | null {
  const normalized = (value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "restaurant":
      return "restaurant";
    case "flight":
    case "expedia":
    case "expedia-flight":
      return "expedia-flight";
    case "hotel":
      return "hotel";
    default:
      return null;
  }
}

export function providerClosureKindToCliKind(
  kind: ProviderClosureKind,
): "restaurant" | "flight" | "hotel" {
  return kind === "expedia-flight" ? "flight" : kind;
}

export function providerClosureKindToAnalyzerKind(
  kind: ProviderClosureKind,
): "restaurant" | "expedia" | "hotel" {
  return kind === "expedia-flight" ? "expedia" : kind;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cleanStringList(
  value: readonly string[] | null | undefined,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

export function firstString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
