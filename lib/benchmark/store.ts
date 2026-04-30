/**
 * DB persistence layer for benchmark runs / cases.
 *
 * Schema bootstrap lives in lib/db.ts (ensureBenchmarkTables); this module
 * holds the typed query helpers so feature code never has to write raw SQL.
 */

import { randomUUID } from "node:crypto";
import { sql, ensureBenchmarkTables } from "@/lib/db";
import type {
  BenchmarkCaseRow,
  BenchmarkCaseStatus,
  BenchmarkMode,
  BenchmarkRunRow,
  BenchmarkRunStatus,
  BenchmarkRunSummary,
  FailureReason,
  RestaurantBenchmarkCase,
} from "./types";
import { FAILURE_REASONS } from "./types";

// ─── Row → typed object mappers ─────────────────────────────────────────────

function toRunRow(r: Record<string, unknown>): BenchmarkRunRow {
  return {
    id: String(r.id),
    name: String(r.name),
    city: String(r.city),
    scenario: String(r.scenario),
    mode: r.mode as BenchmarkMode,
    total_cases: Number(r.total_cases ?? 0),
    success_cases: Number(r.success_cases ?? 0),
    status: r.status as BenchmarkRunStatus,
    notes: (r.notes as string | null) ?? null,
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    completed_at:
      r.completed_at == null
        ? null
        : r.completed_at instanceof Date
          ? r.completed_at.toISOString()
          : String(r.completed_at),
  };
}

function toCaseRow(r: Record<string, unknown>): BenchmarkCaseRow {
  return {
    id: String(r.id),
    run_id: String(r.run_id),
    case_id: String(r.case_id),
    task_payload: r.task_payload as RestaurantBenchmarkCase,
    mode: r.mode as BenchmarkMode,
    booking_job_id: (r.booking_job_id as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    executor: (r.executor as string | null) ?? null,
    status: r.status as BenchmarkCaseStatus,
    success: Boolean(r.success),
    failure_reason: (r.failure_reason as FailureReason | null) ?? null,
    fallback_attempted: Boolean(r.fallback_attempted),
    fallback_success: Boolean(r.fallback_success),
    payment_stop_triggered: Boolean(r.payment_stop_triggered),
    human_handoff_required: Boolean(r.human_handoff_required),
    duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    audit: (r.audit as Record<string, unknown> | null) ?? null,
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    completed_at:
      r.completed_at == null
        ? null
        : r.completed_at instanceof Date
          ? r.completed_at.toISOString()
          : String(r.completed_at),
  };
}

// ─── Run lifecycle ──────────────────────────────────────────────────────────

export interface CreateBenchmarkRunInput {
  name: string;
  city: string;
  scenario: string;
  mode: BenchmarkMode;
  notes?: string | null;
}

export async function createBenchmarkRun(
  input: CreateBenchmarkRunInput,
): Promise<BenchmarkRunRow> {
  await ensureBenchmarkTables();
  const id = randomUUID();
  const result = await sql`
    INSERT INTO benchmark_runs (id, name, city, scenario, mode, status, notes)
    VALUES (
      ${id},
      ${input.name},
      ${input.city},
      ${input.scenario},
      ${input.mode},
      'pending',
      ${input.notes ?? null}
    )
    RETURNING *
  `;
  return toRunRow(result.rows[0] as Record<string, unknown>);
}

export async function setBenchmarkRunStatus(
  runId: string,
  status: BenchmarkRunStatus,
  options?: { completed?: boolean },
): Promise<void> {
  await ensureBenchmarkTables();
  if (options?.completed) {
    await sql`
      UPDATE benchmark_runs
      SET status = ${status}, completed_at = NOW()
      WHERE id = ${runId}
    `;
  } else {
    await sql`
      UPDATE benchmark_runs
      SET status = ${status}
      WHERE id = ${runId}
    `;
  }
}

export async function getBenchmarkRun(
  runId: string,
): Promise<BenchmarkRunRow | null> {
  await ensureBenchmarkTables();
  const result = await sql`SELECT * FROM benchmark_runs WHERE id = ${runId} LIMIT 1`;
  if (result.rows.length === 0) return null;
  return toRunRow(result.rows[0] as Record<string, unknown>);
}

/**
 * List recent benchmark runs, newest first. Used by the internal dashboard.
 * Default cap of 50 — bumps higher are deliberate (the table grows fast).
 */
export async function listBenchmarkRuns(
  limit = 50,
): Promise<BenchmarkRunRow[]> {
  await ensureBenchmarkTables();
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await sql`
    SELECT * FROM benchmark_runs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return (result.rows as Record<string, unknown>[]).map(toRunRow);
}

// ─── Case lifecycle ─────────────────────────────────────────────────────────

export interface CreateBenchmarkCaseInput {
  runId: string;
  caseId: string;
  payload: RestaurantBenchmarkCase;
  mode: BenchmarkMode;
}

export async function createBenchmarkCase(
  input: CreateBenchmarkCaseInput,
): Promise<BenchmarkCaseRow> {
  await ensureBenchmarkTables();
  const id = randomUUID();
  const result = await sql`
    INSERT INTO benchmark_cases (id, run_id, case_id, task_payload, mode, status)
    VALUES (
      ${id},
      ${input.runId},
      ${input.caseId},
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.mode},
      'pending'
    )
    RETURNING *
  `;
  // total_cases bookkeeping on the run row
  await sql`
    UPDATE benchmark_runs
    SET total_cases = total_cases + 1
    WHERE id = ${input.runId}
  `;
  return toCaseRow(result.rows[0] as Record<string, unknown>);
}

export interface UpdateBenchmarkCaseInput {
  status?: BenchmarkCaseStatus;
  bookingJobId?: string | null;
  provider?: string | null;
  executor?: string | null;
  success?: boolean;
  failureReason?: FailureReason | null;
  fallbackAttempted?: boolean;
  fallbackSuccess?: boolean;
  paymentStopTriggered?: boolean;
  humanHandoffRequired?: boolean;
  durationSeconds?: number | null;
  audit?: Record<string, unknown> | null;
  /** When true, sets completed_at = NOW() and bumps run.success_cases if success. */
  finalize?: boolean;
}

export async function updateBenchmarkCase(
  caseRowId: string,
  patch: UpdateBenchmarkCaseInput,
): Promise<BenchmarkCaseRow> {
  await ensureBenchmarkTables();

  // Validate failure reason against canonical list — guards against typos
  // creeping in over time.
  if (
    patch.failureReason &&
    !FAILURE_REASONS.includes(patch.failureReason)
  ) {
    throw new Error(`Invalid failure_reason: ${patch.failureReason}`);
  }

  // Build SET clauses dynamically. We use sql.query so we can stitch
  // optional columns; the @vercel/postgres tagged template doesn't support
  // optional fragments cleanly.
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (frag: string, value: unknown) => {
    values.push(value);
    sets.push(`${frag} = $${values.length}`);
  };

  if (patch.status !== undefined) push("status", patch.status);
  if (patch.bookingJobId !== undefined) push("booking_job_id", patch.bookingJobId);
  if (patch.provider !== undefined) push("provider", patch.provider);
  if (patch.executor !== undefined) push("executor", patch.executor);
  if (patch.success !== undefined) push("success", patch.success);
  if (patch.failureReason !== undefined) push("failure_reason", patch.failureReason);
  if (patch.fallbackAttempted !== undefined)
    push("fallback_attempted", patch.fallbackAttempted);
  if (patch.fallbackSuccess !== undefined)
    push("fallback_success", patch.fallbackSuccess);
  if (patch.paymentStopTriggered !== undefined)
    push("payment_stop_triggered", patch.paymentStopTriggered);
  if (patch.humanHandoffRequired !== undefined)
    push("human_handoff_required", patch.humanHandoffRequired);
  if (patch.durationSeconds !== undefined)
    push("duration_seconds", patch.durationSeconds);
  if (patch.audit !== undefined) {
    values.push(patch.audit == null ? null : JSON.stringify(patch.audit));
    sets.push(`audit = $${values.length}::jsonb`);
  }
  if (patch.finalize) {
    sets.push(`completed_at = NOW()`);
  }

  if (sets.length === 0) {
    const existing = await sql`SELECT * FROM benchmark_cases WHERE id = ${caseRowId} LIMIT 1`;
    if (existing.rows.length === 0) {
      throw new Error(`benchmark_case ${caseRowId} not found`);
    }
    return toCaseRow(existing.rows[0] as Record<string, unknown>);
  }

  values.push(caseRowId);
  const result = await sql.query(
    `UPDATE benchmark_cases SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (result.rows.length === 0) {
    throw new Error(`benchmark_case ${caseRowId} not found`);
  }

  // success_cases bookkeeping: bump run row when finalising a successful case.
  if (patch.finalize && patch.success === true) {
    const runId = (result.rows[0] as Record<string, unknown>).run_id as string;
    await sql`
      UPDATE benchmark_runs
      SET success_cases = success_cases + 1
      WHERE id = ${runId}
    `;
  }

  return toCaseRow(result.rows[0] as Record<string, unknown>);
}

export async function getBenchmarkCases(runId: string): Promise<BenchmarkCaseRow[]> {
  await ensureBenchmarkTables();
  const result = await sql`
    SELECT * FROM benchmark_cases
    WHERE run_id = ${runId}
    ORDER BY created_at ASC
  `;
  return (result.rows as Record<string, unknown>[]).map(toCaseRow);
}

// ─── Aggregate / summary view ───────────────────────────────────────────────

export async function summarizeBenchmarkRun(
  runId: string,
): Promise<BenchmarkRunSummary> {
  await ensureBenchmarkTables();
  const cases = await getBenchmarkCases(runId);
  const total = cases.length;

  const by_status: Record<BenchmarkCaseStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    timed_out: 0,
  };
  const by_failure_reason: Partial<Record<FailureReason, number>> = {};
  let durationSum = 0;
  let durationCount = 0;
  let successCount = 0;

  for (const c of cases) {
    by_status[c.status] = (by_status[c.status] ?? 0) + 1;
    if (c.failure_reason) {
      by_failure_reason[c.failure_reason] =
        (by_failure_reason[c.failure_reason] ?? 0) + 1;
    }
    if (c.success) successCount += 1;
    if (c.duration_seconds != null) {
      durationSum += c.duration_seconds;
      durationCount += 1;
    }
  }

  return {
    run_id: runId,
    total,
    by_status,
    by_failure_reason,
    success_rate: total === 0 ? 0 : successCount / total,
    avg_duration_seconds: durationCount === 0 ? null : durationSum / durationCount,
  };
}
