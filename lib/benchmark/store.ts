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
    safe_outcome: Boolean(r.safe_outcome),
    fully_automated_success: Boolean(r.fully_automated_success),
    verify_gate_triggered: Boolean(r.verify_gate_triggered),
    deep_link_handoff_triggered: Boolean(r.deep_link_handoff_triggered),
    wrong_action_taken: Boolean(r.wrong_action_taken),
    unsupported_platform_detected: Boolean(r.unsupported_platform_detected),
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
 * Delete benchmark runs (and their cases via FK cascade). Used by the
 * dashboard "Clear history" button. Refuses to delete runs that are still
 * pending or running — those are either dispatching or have a Chrome
 * session in flight, and dropping them mid-flight leaks orphaned booking
 * jobs.
 *
 * Returns number of run rows deleted.
 */
export async function clearBenchmarkHistory(options?: {
  /** When true, also delete runs whose status is 'pending' or 'running'.
   *  Default false — we never delete in-flight runs without an opt-in. */
  includeInFlight?: boolean;
}): Promise<{ deleted_runs: number; deleted_cases: number }> {
  await ensureBenchmarkTables();
  // Count first so we can tell the caller how much was wiped.
  const countQ = options?.includeInFlight
    ? await sql`SELECT
        (SELECT COUNT(*)::int FROM benchmark_runs) AS run_count,
        (SELECT COUNT(*)::int FROM benchmark_cases) AS case_count`
    : await sql`SELECT
        (SELECT COUNT(*)::int FROM benchmark_runs WHERE status NOT IN ('pending','running')) AS run_count,
        (SELECT COUNT(*)::int FROM benchmark_cases bc
          WHERE EXISTS (
            SELECT 1 FROM benchmark_runs br
            WHERE br.id = bc.run_id AND br.status NOT IN ('pending','running')
          )) AS case_count`;
  const counts = countQ.rows[0] as { run_count: number; case_count: number };
  if (options?.includeInFlight) {
    await sql`DELETE FROM benchmark_runs`;
  } else {
    await sql`DELETE FROM benchmark_runs WHERE status NOT IN ('pending','running')`;
  }
  return {
    deleted_runs: counts.run_count,
    deleted_cases: counts.case_count,
  };
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
  // ─── v1 outcome flags — set by classifier on case finalize ────────────
  safeOutcome?: boolean;
  fullyAutomatedSuccess?: boolean;
  verifyGateTriggered?: boolean;
  deepLinkHandoffTriggered?: boolean;
  wrongActionTaken?: boolean;
  unsupportedPlatformDetected?: boolean;
  // ──────────────────────────────────────────────────────────────────────
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
  if (patch.safeOutcome !== undefined) push("safe_outcome", patch.safeOutcome);
  if (patch.fullyAutomatedSuccess !== undefined)
    push("fully_automated_success", patch.fullyAutomatedSuccess);
  if (patch.verifyGateTriggered !== undefined)
    push("verify_gate_triggered", patch.verifyGateTriggered);
  if (patch.deepLinkHandoffTriggered !== undefined)
    push("deep_link_handoff_triggered", patch.deepLinkHandoffTriggered);
  if (patch.wrongActionTaken !== undefined)
    push("wrong_action_taken", patch.wrongActionTaken);
  if (patch.unsupportedPlatformDetected !== undefined)
    push("unsupported_platform_detected", patch.unsupportedPlatformDetected);
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

  let safe = 0;
  let fully = 0;
  let paymentStop = 0;
  let verifyGate = 0;
  let noAvail = 0;
  let handoff = 0;
  let wrongAction = 0;
  let unsupported = 0;
  let executorErr = 0;

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
    if (c.safe_outcome) safe += 1;
    if (c.fully_automated_success) fully += 1;
    if (c.payment_stop_triggered) paymentStop += 1;
    if (c.verify_gate_triggered) verifyGate += 1;
    if (c.failure_reason === "no_availability") noAvail += 1;
    if (c.deep_link_handoff_triggered) handoff += 1;
    if (c.wrong_action_taken) wrongAction += 1;
    if (c.unsupported_platform_detected) unsupported += 1;
    if (c.failure_reason === "executor_error" || c.failure_reason === "unknown_error")
      executorErr += 1;
  }

  const denom = total === 0 ? 1 : total;
  return {
    run_id: runId,
    total,
    by_status,
    by_failure_reason,
    success_rate: total === 0 ? 0 : successCount / total,
    avg_duration_seconds: durationCount === 0 ? null : durationSum / durationCount,
    safe_outcome_count: safe,
    safe_outcome_rate: safe / denom,
    fully_automated_success_count: fully,
    fully_automated_success_rate: fully / denom,
    payment_stop_count: paymentStop,
    payment_stop_rate: paymentStop / denom,
    verify_gate_count: verifyGate,
    verify_gate_rate: verifyGate / denom,
    no_availability_count: noAvail,
    no_availability_rate: noAvail / denom,
    deep_link_handoff_count: handoff,
    deep_link_handoff_rate: handoff / denom,
    wrong_action_count: wrongAction,
    wrong_action_rate: wrongAction / denom,
    unsupported_platform_count: unsupported,
    unsupported_platform_rate: unsupported / denom,
    executor_error_count: executorErr,
    executor_error_rate: executorErr / denom,
  };
}
