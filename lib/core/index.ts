/**
 * lib/core · channel-agnostic execution engine public API
 *
 * Single import point for callers (Next.js routes, future /api/v1/ REST
 * endpoints, MCP connector, direct library use). Downstream callers
 * should `import { x } from "@/lib/core"` rather than reaching into
 * subdirectories — this keeps the boundary between "public API" and
 * "internal wiring" sharp.
 *
 * Stability: names exported here are the B 端 contract. Breaking changes
 * require a major version bump and a migration note in PROJECT_SUMMARY.md.
 * Names NOT exported here are internal and may change at any time.
 */

// ─── Execution ───────────────────────────────────────────────────────────────

export { runExecutionJob } from "./execution/executor";
export { runExecutionJobWithRecovery } from "./execution/recovery";
export { createJob, getJob, completeJob } from "./execution/job-manager";

export type {
  ExecutionJobRequest,
  ExecutionJobResult,
  ExecutionJobStatus,
  ExecutionParams,
  ExecutionScenario,
  RestaurantBookingParams,
  HotelBookingParams,
  FlightBookingParams,
  ActivityBookingParams,
  ClientMetadata,
} from "./execution/types";
export type { ExecutionContext } from "./execution/executor";
export type { CreateJobMeta } from "./execution/job-manager";

// ─── Consent ─────────────────────────────────────────────────────────────────

export { DEFAULT_CONSENT_POLICY } from "./consent/default-policy";
export { validateConsent } from "./consent/validator";
export type {
  ConsentPolicy,
  ConsentAction,
  ValidationResult,
} from "./consent/types";

// ─── Audit ───────────────────────────────────────────────────────────────────

export { writeAudit, queryAudit } from "./audit/audit-log";
export type { AuditLogEntry, AuditEventType } from "./audit/types";

// ─── Metrics ─────────────────────────────────────────────────────────────────

export {
  computeSuccessRate,
  computeProviderRanking,
} from "./metrics/success-rate";
export type {
  MetricsTimeRange,
  ProviderSuccessRate,
  ProviderRankingEntry,
} from "./metrics/types";
