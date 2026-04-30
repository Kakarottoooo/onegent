/**
 * Restaurant booking benchmark runner.
 *
 * Three responsibilities:
 *   1. dispatch — create benchmark_run + benchmark_case rows, build a
 *      BookingJobStep for each case, createBookingJob with the dry_run
 *      autonomy flag, and fire-and-forget POST /api/booking-jobs/[id]/start.
 *   2. resolve  — for cases whose booking_job has reached a terminal state,
 *      classify the outcome (success / failure_reason) by reading
 *      step.decisionLog for the dry_run boundary marker.
 *   3. orchestrate — runRestaurantBenchmark wraps both, returning the
 *      run_id immediately so the caller can poll GET /runs/[id].
 *
 * Safety: every dispatched job carries autonomy_settings.benchmark_dry_run
 * = true (when mode is 'dry_run'). The OpenTable + Resy providers honour
 * this and refuse to click the final submit button.
 */

import { randomUUID } from "node:crypto";
import {
  createBookingJob,
  getBookingJob,
  type BookingJobStep,
} from "@/lib/db";
import { DEFAULT_AUTONOMY, type AgentAutonomySettings } from "@/lib/autonomy";
import {
  createBenchmarkRun,
  createBenchmarkCase,
  updateBenchmarkCase,
  setBenchmarkRunStatus,
  summarizeBenchmarkRun,
  getBenchmarkCases,
  getBenchmarkRun,
} from "./store";
import { getRestaurantBenchmarkCases } from "./restaurant-cases";
import { classifyStepResult } from "./parse-decision-log";
import type {
  BenchmarkMode,
  BenchmarkRunSummary,
  RestaurantBenchmarkCase,
  BenchmarkCaseRow,
  BenchmarkRunRow,
} from "./types";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Optional injection point for tests — overrides global fetch.
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunRestaurantBenchmarkInput {
  /** Friendly label, e.g. "NYC restaurant baseline 2026-04-30". */
  name: string;
  /** dry_run = providers refuse the final submit click. full_commit not allowed. */
  mode: BenchmarkMode;
  /** Optional override; defaults to all 5 NYC seed cases. */
  cases?: RestaurantBenchmarkCase[];
  /** Cap how many cases to dispatch (default 1 — safe smoke test). */
  maxCases?: number;
  /** Free-form notes attached to the run row. */
  notes?: string;
  /** Override base URL for /start fetch (tests + non-localhost dev). */
  baseUrl?: string;
  /** Inject a fetch fn (tests). Defaults to global fetch. */
  fetchFn?: FetchLike;
}

export interface RunRestaurantBenchmarkResult {
  run_id: string;
  total: number;
  dispatched: number;
  status: "running" | "completed" | "errored";
  summary: BenchmarkRunSummary;
  /**
   * Friendly message describing what just happened — surfaced through the
   * API response so the caller sees if cases were dispatched or skipped.
   */
  message?: string;
}

// ─── Step builder ───────────────────────────────────────────────────────────

/**
 * Map a benchmark case to a single restaurant BookingJobStep. Everything
 * runUniversalStep needs (restaurantName, city, date, time, covers) goes
 * into step.body; if the case carries an explicit restaurant_url we also
 * pass it as startUrl so the executor skips the search-by-term phase.
 */
export function caseToBookingStep(c: RestaurantBenchmarkCase): BookingJobStep {
  const fallbackUrl =
    c.restaurant_url ??
    `https://www.opentable.com/s?term=${encodeURIComponent(c.restaurant_name)}&covers=${c.party_size}&dateTime=${c.date}T${c.time}:00`;

  const body: Record<string, unknown> = {
    restaurantName: c.restaurant_name,
    city: c.city,
    date: c.date,
    time: c.time,
    covers: c.party_size,
  };
  if (c.restaurant_url) body.startUrl = c.restaurant_url;

  return {
    type: "restaurant",
    emoji: "🍽️",
    label: `Benchmark: ${c.restaurant_name}`,
    apiEndpoint: "/api/booking-autopilot/universal",
    body,
    fallbackUrl,
    status: "pending",
  };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

interface DispatchInput {
  caseRow: BenchmarkCaseRow;
  mode: BenchmarkMode;
  baseUrl: string;
  fetchFn: FetchLike;
}

/**
 * Create the booking_job for a case + fire-and-forget the /start trigger.
 * Updates the benchmark_case row with the booking_job_id and 'running' status.
 */
export async function dispatchBenchmarkCase(input: DispatchInput): Promise<string> {
  const { caseRow, mode, baseUrl, fetchFn } = input;
  const c = caseRow.task_payload;

  const step = caseToBookingStep(c);
  const jobId = randomUUID();

  const autonomy: AgentAutonomySettings = {
    ...DEFAULT_AUTONOMY,
    benchmark_dry_run: mode === "dry_run",
  };

  await createBookingJob({
    id: jobId,
    // Synthetic session id keyed off the run so jobs are easy to find.
    sessionId: `benchmark_${caseRow.run_id}`,
    // Anonymous: bypass billing quota gate in /start.
    userId: null,
    tripLabel: `Benchmark: ${c.restaurant_name}`,
    steps: [step],
    autonomySettings: autonomy,
  });

  await updateBenchmarkCase(caseRow.id, {
    status: "running",
    bookingJobId: jobId,
    provider: c.expected_provider,
    executor: "stagehand",
  });

  // Fire-and-forget. The /start endpoint is long-running (up to 5 min in
  // legacy in-process mode); we never await it. Resolution happens later
  // when the caller polls GET /runs/[id].
  void fetchFn(`${baseUrl}/api/booking-jobs/${jobId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] /start fetch failed for ${jobId}: ${msg}`);
  });

  return jobId;
}

// ─── Resolve ────────────────────────────────────────────────────────────────

/**
 * If the case is in a terminal-but-unresolved state, read its booking_job
 * and classify the outcome. Idempotent: calling on an already-finalised case
 * is a no-op.
 */
export async function resolveBenchmarkCase(
  caseRow: BenchmarkCaseRow,
): Promise<BenchmarkCaseRow> {
  // Don't re-resolve already-finalised rows.
  if (caseRow.status === "succeeded" || caseRow.status === "failed" || caseRow.status === "skipped") {
    return caseRow;
  }
  if (!caseRow.booking_job_id) {
    return caseRow;
  }

  const job = await getBookingJob(caseRow.booking_job_id);
  if (!job) {
    return updateBenchmarkCase(caseRow.id, {
      status: "failed",
      success: false,
      failureReason: "unknown_error",
      audit: { reason: "booking_job missing — likely deleted" },
      finalize: true,
    });
  }

  // Job still pending or running → nothing to resolve yet.
  if (job.status === "pending" || job.status === "running") {
    return caseRow;
  }

  // Terminal job. Pick the first (and only) step and classify it.
  const step = job.steps?.[0];
  if (!step) {
    return updateBenchmarkCase(caseRow.id, {
      status: "failed",
      success: false,
      failureReason: "unknown_error",
      audit: { reason: "booking_job has no steps", job_status: job.status },
      finalize: true,
    });
  }

  const classification = classifyStepResult({
    status: step.status,
    error: step.error ?? null,
    decisionLog: step.decisionLog ?? null,
  });

  const createdAt = new Date(job.created_at).getTime();
  const completedAt = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  const durationSeconds = Math.max(0, Math.round((completedAt - createdAt) / 1000));

  return updateBenchmarkCase(caseRow.id, {
    status: classification.status,
    success: classification.success,
    failureReason: classification.failure_reason,
    paymentStopTriggered: classification.payment_stop_triggered,
    humanHandoffRequired: classification.human_handoff_required,
    durationSeconds,
    audit: {
      job_status: job.status,
      step_status: step.status,
      step_error: step.error ?? null,
      decision_log_entries: step.decisionLog?.length ?? 0,
    },
    finalize: true,
  });
}

/**
 * Walk every case for a run and resolve those that have reached a terminal
 * state on the booking_jobs side. Idempotent — safe to call repeatedly.
 */
export async function resolveBenchmarkRun(runId: string): Promise<{
  run: BenchmarkRunRow | null;
  cases: BenchmarkCaseRow[];
  summary: BenchmarkRunSummary;
}> {
  const run = await getBenchmarkRun(runId);
  const cases = await getBenchmarkCases(runId);

  const resolved: BenchmarkCaseRow[] = [];
  for (const c of cases) {
    resolved.push(await resolveBenchmarkCase(c));
  }

  // If every case has finalised, mark the run completed.
  const stillRunning = resolved.some((c) => c.status === "pending" || c.status === "running");
  if (!stillRunning && run && run.status !== "completed") {
    await setBenchmarkRunStatus(runId, "completed", { completed: true });
  }

  const summary = await summarizeBenchmarkRun(runId);
  return { run, cases: resolved, summary };
}

// ─── Top-level entry ────────────────────────────────────────────────────────

export async function runRestaurantBenchmark(
  input: RunRestaurantBenchmarkInput,
): Promise<RunRestaurantBenchmarkResult> {
  if (input.mode === "full_commit") {
    throw new Error(
      "full_commit mode is not enabled in this build. Use 'dry_run' — providers honour the dry_run boundary and stop before any reservation-committing click.",
    );
  }

  const allCases = input.cases ?? getRestaurantBenchmarkCases();
  if (allCases.length === 0) {
    throw new Error("No benchmark cases provided");
  }

  // Default to 1 case for safety — the caller must opt in to wider runs.
  const cap = input.maxCases ?? 1;
  const cases = allCases.slice(0, cap);

  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn: FetchLike = input.fetchFn ?? ((url, init) => fetch(url, init));

  const run = await createBenchmarkRun({
    name: input.name,
    city: "New York",
    scenario: "restaurant_booking",
    mode: input.mode,
    notes: input.notes ?? null,
  });
  await setBenchmarkRunStatus(run.id, "running");

  let dispatched = 0;
  for (const c of cases) {
    const caseRow = await createBenchmarkCase({
      runId: run.id,
      caseId: c.case_id,
      payload: c,
      mode: input.mode,
    });
    try {
      await dispatchBenchmarkCase({ caseRow, mode: input.mode, baseUrl, fetchFn });
      dispatched += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateBenchmarkCase(caseRow.id, {
        status: "failed",
        success: false,
        failureReason: "executor_error",
        audit: { reason: `dispatch failed: ${msg}` },
        finalize: true,
      });
    }
  }

  const summary = await summarizeBenchmarkRun(run.id);

  return {
    run_id: run.id,
    total: cases.length,
    dispatched,
    status: "running",
    summary,
    message:
      dispatched > 0
        ? `Dispatched ${dispatched} case(s). Booking jobs are running asynchronously — poll GET /api/internal/benchmark/runs/${run.id} for resolution.`
        : `No cases dispatched.`,
  };
}
