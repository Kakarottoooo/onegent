/**
 * lib/core/audit/audit-log · writeAudit + queryAudit
 *
 * Adapter over lib/db's writeAgentLog / getAgentLogs. All audit entries
 * share a fixed source="audit" marker so queryAudit() can filter out
 * the much larger volume of debug traces written by the Autopilot
 * executor via writeAgentLog directly.
 *
 * writeAudit is fire-and-forget with best-effort persistence — failures
 * are swallowed by the underlying writeAgentLog try/catch. Rationale:
 * audit being unavailable should never block the actual booking flow.
 */

import {
  writeAgentLog,
  getAgentLogs,
  type AgentLog,
} from "@/lib/db";
import type { AuditLogEntry, AuditEventType } from "./types";

/**
 * Fixed agent_logs.source value written for every audit entry.
 * queryAudit() filters on this; debug writeAgentLog callers use other
 * source strings (e.g. "stagehand-executor", "start-route").
 */
const AUDIT_SOURCE = "audit";

/**
 * Event types that map to level="warn" (everything else → "info").
 * Used for the existing agent_logs.level filter so operational
 * dashboards can surface failure/denial events without parsing details.
 */
const WARN_EVENT_TYPES: ReadonlySet<AuditEventType> = new Set<AuditEventType>([
  "job_failed",
  "job_aborted",
  "action_denied",
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Persist one structured audit event. timestamp is set server-side.
 * Never throws — if the DB write fails, the underlying writeAgentLog
 * swallows the error (see lib/db.ts). Audit must not be a critical path.
 */
export async function writeAudit(
  entry: Omit<AuditLogEntry, "timestamp">,
): Promise<void> {
  const level: AgentLog["level"] = WARN_EVENT_TYPES.has(entry.type)
    ? "warn"
    : "info";

  // Merge stepIndex + caller details into the JSONB column so we can
  // reconstruct the AuditLogEntry on read. `type` lives here too — the
  // top-level message field is free text, type is the machine-readable
  // discriminator queryAudit uses.
  const details: Record<string, unknown> = {
    type: entry.type,
    ...(entry.stepIndex !== undefined ? { stepIndex: entry.stepIndex } : {}),
    ...(entry.details ?? {}),
  };

  await writeAgentLog({
    // We reuse jobId for both session_id and job_id because:
    //   - session_id is NOT NULL in the table but we don't always have
    //     a Clerk session in the audit context (B 端 calls have none).
    //   - jobId is always present on an audit event by contract.
    session_id: entry.jobId,
    job_id: entry.jobId,
    level,
    source: AUDIT_SOURCE,
    message: entry.message,
    details,
  });
}

/**
 * Read all audit entries for a job in reverse chronological order
 * (newest first). Default limit 500 — enough to cover any single job's
 * full decision trail even with aggressive retries.
 *
 * Filters on source="audit" so raw debug traces (from Stagehand,
 * Playwright, etc.) are NOT included.
 */
export async function queryAudit(
  jobId: string,
  opts: { limit?: number } = {},
): Promise<AuditLogEntry[]> {
  const rows = await getAgentLogs({
    jobId,
    source: AUDIT_SOURCE,
    limit: opts.limit ?? 500,
  });
  return rows.map(rowToAuditEntry);
}

// ─── Internal: AgentLog row → AuditLogEntry ──────────────────────────────────

function rowToAuditEntry(row: AgentLog): AuditLogEntry {
  const raw = (row.details ?? {}) as Record<string, unknown>;
  const { type, stepIndex, ...rest } = raw as {
    type?: string;
    stepIndex?: number;
    [key: string]: unknown;
  };

  return {
    jobId: row.job_id ?? row.session_id,
    stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
    // Fallback to "job_started" if a bad row slipped in without a type —
    // better than throwing and breaking the whole query. In practice
    // every writeAudit() invocation sets this.
    type: (type as AuditEventType) ?? "job_started",
    timestamp: row.created_at,
    message: row.message,
    details: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
