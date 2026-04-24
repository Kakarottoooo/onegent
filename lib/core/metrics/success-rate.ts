/**
 * lib/core/metrics/success-rate · computeSuccessRate + computeProviderRanking
 *
 * Read-only aggregation over agent_feedback. The underlying table is
 * already populated by lib/db.logAgentFeedback from the C 端 run loop —
 * we just query it with B 端-friendly shaping (per-provider + time window).
 *
 * Queries live here (not in lib/db) because:
 *   - They're high-level analytics, not primitive CRUD
 *   - lib/db's getAgentFeedbackStats returns a monolithic all-stats blob
 *     designed for the Agent Insights panel; B 端 wants fine-grained
 *     single-provider queries
 *   - Modifying getAgentFeedbackStats to accept timeRange breaks its
 *     existing C 端 callers
 *
 * All exports are async SQL queries — safe to call from any route handler.
 */

import { sql } from "@vercel/postgres";
import type {
  MetricsTimeRange,
  ProviderSuccessRate,
  ProviderRankingEntry,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Success rate for a single provider, optionally time-bounded.
 * Returns an all-zero record when no data exists — callers should check
 * totalAttempts before surfacing successRate as evidence (see types.ts).
 */
export async function computeSuccessRate(
  providerId: string,
  timeRange?: MetricsTimeRange,
): Promise<ProviderSuccessRate> {
  const sinceDays = timeRange?.sinceDays;
  const rows = sinceDays
    ? (
        await sql<AggregateRow>`
          SELECT
            provider,
            COUNT(*)::int AS total,
            SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
            SUM(CASE WHEN outcome = 'manual_override' THEN 1 ELSE 0 END)::int AS manual_override,
            SUM(CASE WHEN agent_decision = 'failed' THEN 1 ELSE 0 END)::int AS failed,
            MAX(created_at)::text AS last_event
          FROM agent_feedback
          WHERE provider = ${providerId}
            AND step_type != 'job'
            AND created_at >= NOW() - ${sinceDays} * INTERVAL '1 day'
          GROUP BY provider
        `
      ).rows
    : (
        await sql<AggregateRow>`
          SELECT
            provider,
            COUNT(*)::int AS total,
            SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
            SUM(CASE WHEN outcome = 'manual_override' THEN 1 ELSE 0 END)::int AS manual_override,
            SUM(CASE WHEN agent_decision = 'failed' THEN 1 ELSE 0 END)::int AS failed,
            MAX(created_at)::text AS last_event
          FROM agent_feedback
          WHERE provider = ${providerId}
            AND step_type != 'job'
          GROUP BY provider
        `
      ).rows;

  if (rows.length === 0) {
    return emptyRate(providerId);
  }
  return rowToRate(rows[0]);
}

/**
 * All providers ranked by successRate (descending). The minSampleSize
 * option filters out providers with too little data — important for
 * public-facing pitches so a single lucky 1/1 booking doesn't claim
 * "100% success rate".
 *
 * Default minSampleSize is 0 (include everything) to avoid surprising
 * callers with empty results when data volume is still building up;
 * B 端 /developers landing should pass 5 or 10 explicitly.
 */
export async function computeProviderRanking(
  timeRange?: MetricsTimeRange,
  opts: { minSampleSize?: number } = {},
): Promise<ProviderRankingEntry[]> {
  const sinceDays = timeRange?.sinceDays;
  const rows = sinceDays
    ? (
        await sql<AggregateRow>`
          SELECT
            provider,
            COUNT(*)::int AS total,
            SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
            SUM(CASE WHEN outcome = 'manual_override' THEN 1 ELSE 0 END)::int AS manual_override,
            SUM(CASE WHEN agent_decision = 'failed' THEN 1 ELSE 0 END)::int AS failed,
            MAX(created_at)::text AS last_event
          FROM agent_feedback
          WHERE provider IS NOT NULL
            AND step_type != 'job'
            AND created_at >= NOW() - ${sinceDays} * INTERVAL '1 day'
          GROUP BY provider
        `
      ).rows
    : (
        await sql<AggregateRow>`
          SELECT
            provider,
            COUNT(*)::int AS total,
            SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
            SUM(CASE WHEN outcome = 'manual_override' THEN 1 ELSE 0 END)::int AS manual_override,
            SUM(CASE WHEN agent_decision = 'failed' THEN 1 ELSE 0 END)::int AS failed,
            MAX(created_at)::text AS last_event
          FROM agent_feedback
          WHERE provider IS NOT NULL
            AND step_type != 'job'
          GROUP BY provider
        `
      ).rows;

  const min = opts.minSampleSize ?? 0;
  const rates = rows.map(rowToRate).filter((r) => r.totalAttempts >= min);

  // Sort by successRate desc, break ties by totalAttempts desc
  // (more data beats lucky small samples at the same rate).
  rates.sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return b.totalAttempts - a.totalAttempts;
  });

  return rates.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface AggregateRow {
  provider: string;
  total: number;
  accepted: number;
  manual_override: number;
  failed: number;
  last_event: string | null;
}

function rowToRate(row: AggregateRow): ProviderSuccessRate {
  const total = row.total;
  return {
    providerId: row.provider,
    totalAttempts: total,
    acceptedCount: row.accepted,
    manualOverrideCount: row.manual_override,
    failedCount: row.failed,
    successRate: total > 0 ? row.accepted / total : 0,
    lastEventAt: row.last_event ?? undefined,
  };
}

function emptyRate(providerId: string): ProviderSuccessRate {
  return {
    providerId,
    totalAttempts: 0,
    acceptedCount: 0,
    manualOverrideCount: 0,
    failedCount: 0,
    successRate: 0,
    lastEventAt: undefined,
  };
}
