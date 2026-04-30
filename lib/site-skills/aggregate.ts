/**
 * Aggregator: scan finalised benchmark_cases, group by (provider, task_type),
 * upsert into provider_skills.
 *
 * Today this is the only data source. Production booking_jobs will be added
 * in a follow-up: that requires extracting `provider` from step.body /
 * decisionLog entries (which is fuzzy), so we stage it after the benchmark
 * pipeline has been running long enough to anchor the schema.
 *
 * Pure logic: a `aggregateFromCases(cases)` function that takes already-
 * read benchmark cases and returns the upsert payload. The DB write is a
 * separate function so the pure aggregation step is unit-testable without
 * Postgres.
 */

import { sql, ensureProviderSkillsTable } from "@/lib/db";
import type { BenchmarkCaseRow, FailureReason } from "@/lib/benchmark/types";
import type {
  FailureBuckets,
  ProviderSkillRow,
  ProviderSkillSummary,
  TrackedTaskType,
} from "./types";

// ─── Pure aggregation ───────────────────────────────────────────────────────

interface Bucket {
  provider: string;
  task_type: TrackedTaskType;
  sample_count: number;
  success_count: number;
  failure_buckets: FailureBuckets;
  duration_sum: number;
  duration_count: number;
  last_seen_at: string;
}

/** Group key for a (provider, task_type) pair. */
function bucketKey(provider: string, task_type: TrackedTaskType): string {
  return `${provider}::${task_type}`;
}

/**
 * Pure: take an array of finalised benchmark cases and return one bucket per
 * (provider, task_type). Cases without a provider (skipped / pending /
 * dry_run_blocked) are dropped — they'd skew success_rate downward without
 * informing it.
 */
export function aggregateFromCases(
  cases: BenchmarkCaseRow[],
): Map<string, Bucket> {
  const out = new Map<string, Bucket>();

  for (const c of cases) {
    if (!c.provider) continue;
    if (c.status !== "succeeded" && c.status !== "failed" && c.status !== "timed_out") {
      // Skip pending / running / skipped — only finalised attempts inform aggregates.
      continue;
    }

    const task_type: TrackedTaskType = "restaurant_booking"; // benchmark scope
    const key = bucketKey(c.provider, task_type);
    let b = out.get(key);
    if (!b) {
      b = {
        provider: c.provider,
        task_type,
        sample_count: 0,
        success_count: 0,
        failure_buckets: {},
        duration_sum: 0,
        duration_count: 0,
        last_seen_at: c.completed_at ?? c.created_at,
      };
      out.set(key, b);
    }

    b.sample_count += 1;
    if (c.success) b.success_count += 1;
    if (c.failure_reason) {
      b.failure_buckets[c.failure_reason] =
        (b.failure_buckets[c.failure_reason] ?? 0) + 1;
    }
    if (c.duration_seconds != null) {
      b.duration_sum += c.duration_seconds;
      b.duration_count += 1;
    }
    const ts = c.completed_at ?? c.created_at;
    if (ts > b.last_seen_at) b.last_seen_at = ts;
  }

  return out;
}

// ─── DB I/O ─────────────────────────────────────────────────────────────────

/**
 * Upsert one bucket into provider_skills. Replaces the row's stats wholesale
 * — this matches the "rebuild from scratch every refresh" strategy. If we
 * later do incremental aggregation we'll switch to delta merging.
 */
export async function upsertProviderSkill(b: Bucket): Promise<void> {
  await ensureProviderSkillsTable();
  const avg = b.duration_count === 0 ? null : b.duration_sum / b.duration_count;
  await sql`
    INSERT INTO provider_skills (
      provider, task_type, sample_count, success_count,
      failure_buckets, avg_duration_s, last_seen_at, updated_at
    )
    VALUES (
      ${b.provider}, ${b.task_type}, ${b.sample_count}, ${b.success_count},
      ${JSON.stringify(b.failure_buckets)}::jsonb,
      ${avg},
      ${b.last_seen_at},
      NOW()
    )
    ON CONFLICT (provider, task_type) DO UPDATE SET
      sample_count    = EXCLUDED.sample_count,
      success_count   = EXCLUDED.success_count,
      failure_buckets = EXCLUDED.failure_buckets,
      avg_duration_s  = EXCLUDED.avg_duration_s,
      last_seen_at    = EXCLUDED.last_seen_at,
      updated_at      = NOW()
  `;
}

/**
 * Refresh everything: read all finalised benchmark_cases, aggregate, upsert.
 * Idempotent — running twice produces the same provider_skills rows.
 *
 * Returns a summary for the API response.
 */
export interface RefreshResult {
  cases_scanned: number;
  rows_upserted: number;
  duration_ms: number;
}

export async function refreshProviderSkills(): Promise<RefreshResult> {
  await ensureProviderSkillsTable();
  const t0 = Date.now();

  const result = await sql`
    SELECT * FROM benchmark_cases
    WHERE status IN ('succeeded', 'failed', 'timed_out')
      AND provider IS NOT NULL
  `;

  const cases: BenchmarkCaseRow[] = (result.rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    run_id: String(r.run_id),
    case_id: String(r.case_id),
    task_payload: r.task_payload as BenchmarkCaseRow["task_payload"],
    mode: r.mode as BenchmarkCaseRow["mode"],
    booking_job_id: (r.booking_job_id as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    executor: (r.executor as string | null) ?? null,
    status: r.status as BenchmarkCaseRow["status"],
    success: Boolean(r.success),
    failure_reason: (r.failure_reason as FailureReason | null) ?? null,
    fallback_attempted: Boolean(r.fallback_attempted),
    fallback_success: Boolean(r.fallback_success),
    payment_stop_triggered: Boolean(r.payment_stop_triggered),
    human_handoff_required: Boolean(r.human_handoff_required),
    duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    audit: (r.audit as Record<string, unknown> | null) ?? null,
    created_at:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    completed_at:
      r.completed_at == null
        ? null
        : r.completed_at instanceof Date
          ? r.completed_at.toISOString()
          : String(r.completed_at),
  }));

  const buckets = aggregateFromCases(cases);
  for (const b of buckets.values()) {
    await upsertProviderSkill(b);
  }

  return {
    cases_scanned: cases.length,
    rows_upserted: buckets.size,
    duration_ms: Date.now() - t0,
  };
}

// ─── Read helpers ───────────────────────────────────────────────────────────

function rowToSkill(r: Record<string, unknown>): ProviderSkillRow {
  return {
    provider: String(r.provider),
    task_type: r.task_type as TrackedTaskType,
    sample_count: Number(r.sample_count ?? 0),
    success_count: Number(r.success_count ?? 0),
    failure_buckets: (r.failure_buckets as FailureBuckets) ?? {},
    avg_duration_s: r.avg_duration_s == null ? null : Number(r.avg_duration_s),
    last_seen_at:
      r.last_seen_at == null
        ? null
        : r.last_seen_at instanceof Date
          ? r.last_seen_at.toISOString()
          : String(r.last_seen_at),
    updated_at:
      r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export function summarise(row: ProviderSkillRow): ProviderSkillSummary {
  const success_rate = row.sample_count === 0 ? null : row.success_count / row.sample_count;
  const top_failure_reason: FailureReason | null = (() => {
    const entries = Object.entries(row.failure_buckets);
    if (entries.length === 0) return null;
    entries.sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));
    return entries[0][0] as FailureReason;
  })();
  return { ...row, success_rate, top_failure_reason };
}

export async function listProviderSkills(): Promise<ProviderSkillSummary[]> {
  await ensureProviderSkillsTable();
  const result = await sql`
    SELECT * FROM provider_skills
    ORDER BY task_type ASC, success_count DESC, sample_count DESC
  `;
  return (result.rows as Record<string, unknown>[]).map(rowToSkill).map(summarise);
}
