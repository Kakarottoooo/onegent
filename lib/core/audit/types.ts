/**
 * lib/core/audit · public types
 *
 * AuditLogEntry captures STRUCTURED execution events (who/what/when/why)
 * that a B 端 caller or compliance tool can replay. This is intentionally
 * a narrower, higher-signal stream than agent_logs.message (which holds
 * free-form debug traces from the Autopilot executor).
 *
 * Storage: audit entries live in the SAME agent_logs table as debug logs,
 * distinguished by source="audit" (see audit-log.ts). This avoids a DB
 * migration and lets the Week 3 `GET /api/v1/execution-jobs/[id]/audit`
 * read from an already-populated table. If volume eventually demands a
 * dedicated audit_events table, only audit-log.ts changes — consumers
 * continue to see the same AuditLogEntry type.
 *
 * Semantics: each entry is an INTENT-LEVEL event (the executor decided
 * X because Y). Raw DOM events, network traces, Stagehand step output,
 * etc. are debug — they stay in agent_logs via the existing writeAgentLog
 * path and are NOT returned by queryAudit.
 */

/**
 * Event types emitted by the execution engine. Categorized into two
 * groups:
 *
 *   Lifecycle — where the job is in its overall state machine
 *   Decision  — a specific autonomous choice the executor made (and why)
 *
 * Keep this union tight: each variant should correspond to a real
 * decision point in the executor. Avoid generic "info" / "trace"
 * variants — those belong in debug logs.
 */
export type AuditEventType =
  // ── Lifecycle ──
  | "job_created"
  | "job_started"
  | "step_started"
  | "job_paused_payment"
  | "job_needs_otp"
  | "job_needs_profile_data"
  | "job_ready_for_confirmation"
  | "job_completed"
  | "job_failed"
  | "job_aborted"           // executor stopped early (e.g. consent deadline hit)
  // ── Decision points ──
  | "executor_selected"     // choosing legacy_stagehand / computer_use / manual executor
  | "step_attempt"          // entering a retry iteration; details.attemptNumber set
  | "action_allowed"        // consent validator approved a specific action
  | "action_denied"         // consent validator rejected a specific action
  | "time_adjusted"         // restaurant time slot changed
  | "venue_switched"        // primary venue failed, trying backup
  | "provider_fallback";    // e.g. OpenTable unavailable → switching to Resy

export interface AuditLogEntry {
  /** BookingJob.id — the job this event belongs to. */
  jobId: string;
  /** 0-based index within BookingJob.steps; omit for job-level events. */
  stepIndex?: number;
  /** What kind of event this is — see AuditEventType. */
  type: AuditEventType;
  /** ISO 8601 timestamp. Populated by writeAudit(); callers don't set it. */
  timestamp: string;
  /** One-sentence human-readable summary — surfaced in UI audit tables. */
  message: string;
  /**
   * Structured event data. Shape depends on `type`, e.g.:
   *   time_adjusted:      { fromTime: "19:00", toTime: "19:30" }
   *   venue_switched:     { fromVenue: "Le Bernardin", toVenue: "Eleven Madison" }
   *   provider_fallback:  { fromProvider: "opentable-com", toProvider: "resy-com" }
   *   action_denied:      { action: ConsentAction, reason: string }
   */
  details?: Record<string, unknown>;
}
