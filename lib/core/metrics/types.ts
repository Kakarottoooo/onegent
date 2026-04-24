/**
 * lib/core/metrics · public types
 *
 * Aggregation layer over agent_feedback. Reads only — writes still go
 * through lib/db.logAgentFeedback (the per-event recorder). These types
 * are shaped for B 端 consumers (REST API / /developers page / pitch
 * dashboards) who need single-provider + time-windowed queries, which
 * the existing C 端 getAgentFeedbackStats doesn't support.
 *
 * Why this doesn't go through lib/db:
 *   - lib/db is an atomic CRUD helper layer; metrics is high-level analytics
 *   - getAgentFeedbackStats returns a single monolithic "all stats" blob
 *     designed for the Agent Insights panel; B 端 wants fine-grained queries
 *   - Changing getAgentFeedbackStats to accept a timeRange would break
 *     existing callers that don't know about it
 */

// ─── Query inputs ────────────────────────────────────────────────────────────

/**
 * Optional time window for a metrics query. Omit / pass empty for all-time.
 * Intentionally simple — "last N days" covers 95% of B 端 questions.
 * For point-in-time or custom ranges we add them here (not a new interface).
 */
export interface MetricsTimeRange {
  /** Include only events created within the last N days. */
  sinceDays?: number;
}

// ─── Result types ────────────────────────────────────────────────────────────

/**
 * Success rate for ONE provider (e.g. "opentable-com"), for the chosen
 * time window. totalAttempts === 0 means no data yet — successRate is 0
 * in that case (never NaN). Callers should gate UI on totalAttempts
 * before citing successRate as evidence ("based on 2 bookings" is
 * misleading regardless of rate).
 */
export interface ProviderSuccessRate {
  providerId: string;

  /** Total feedback rows for this provider in the window. */
  totalAttempts: number;
  /** Subset where outcome === "accepted" (user opened the agent's link). */
  acceptedCount: number;
  /** Subset where outcome === "manual_override" (user used a manual link). */
  manualOverrideCount: number;
  /** Subset where agent_decision === "failed" (executor couldn't complete). */
  failedCount: number;

  /**
   * acceptedCount / totalAttempts, in [0, 1].
   * 0 when totalAttempts === 0 (defined this way to avoid NaN downstream).
   */
  successRate: number;

  /** ISO timestamp of the most recent feedback row — undefined if none. */
  lastEventAt?: string;
}

/** One row in the provider-ranking table, including its rank. */
export interface ProviderRankingEntry extends ProviderSuccessRate {
  /** 1-based rank in the ordered list (1 = best). */
  rank: number;
}
