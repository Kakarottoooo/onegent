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
import { classifyStepResult, isTransientError } from "./parse-decision-log";
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
  /** Optional override; defaults to all NYC seed cases. */
  cases?: RestaurantBenchmarkCase[];
  /** Cap how many cases to dispatch (default 1 — safe smoke test). */
  maxCases?: number;
  /** Free-form notes attached to the run row. */
  notes?: string;
  /** Override base URL for /start fetch (tests + non-localhost dev). */
  baseUrl?: string;
  /** Inject a fetch fn (tests). Defaults to global fetch. */
  fetchFn?: FetchLike;
  /** Max chromium sessions in-flight at any time. Defaults to 5
   *  (empirically safe on a 16GB dev box). */
  batchSize?: number;
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
/**
 * Synthetic guest profile injected into every benchmark booking job. Without
 * this, anonymous benchmark jobs (userId=null) get an empty profile, the
 * stagehand executor reaches the guest form with no fields to fill, and the
 * "default success path" check blocks the run with status=error after 30s+.
 *
 * Card fields are intentionally omitted: dry_run mode stops at the payment
 * boundary anyway, and providers that pre-validate cards would reject this
 * fake number. The contact fields are realistic-but-clearly-test (RFC 2606
 * .test TLD, 555-prefix phone), so any leakage to real venues is benign.
 */
const BENCHMARK_PROFILE = {
  first_name: "Benchmark",
  last_name: "User",
  email: "benchmark@onegent.test",
  phone: "+15555550100",
  address_line1: "1 Test Street",
  city: "New York",
  state: "NY",
  zip: "10001",
  country: "US",
};

export function caseToBookingStep(c: RestaurantBenchmarkCase): BookingJobStep {
  // For no-online venues (e.g. Rao's) we use a sentinel URL the
  // stagehand-executor recognises and short-circuits with a clean
  // deep_link_handoff signal — without it we'd waste 30-60s spinning a
  // Chrome session against an OT search that has no listing.
  let resolvedStartUrl = c.restaurant_url;
  if (!resolvedStartUrl && c.expected_provider === "no_online") {
    resolvedStartUrl = `benchmark://no_online?venue=${encodeURIComponent(c.restaurant_name)}`;
  }

  const fallbackUrl =
    resolvedStartUrl ??
    `https://www.opentable.com/s?term=${encodeURIComponent(c.restaurant_name)}&covers=${c.party_size}&dateTime=${c.date}T${c.time}:00`;

  const body: Record<string, unknown> = {
    restaurantName: c.restaurant_name,
    city: c.city,
    date: c.date,
    time: c.time,
    covers: c.party_size,
    profile: BENCHMARK_PROFILE,
    // Forward fallback_policy to stagehand-executor so the time-slot
    // matcher can honor case constraints (e.g. time_window_minutes=0
    // means "exact time only — no closest-slot fallback").
    fallback_policy: c.fallback_policy,
  };
  if (resolvedStartUrl) body.startUrl = resolvedStartUrl;

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

  // ── Retry on transient infra failures ──────────────────────────────────
  // Neon DB connect timeouts, Chrome CDP target races, dispatcher 409,
  // socket resets — these are infra hiccups, not real "the executor decided
  // to give up" outcomes. Retry once before finalising as executor_error.
  // Track attempt_count in audit (jsonb) — no schema migration needed.
  const previousAudit = (caseRow.audit ?? {}) as {
    attempt_count?: number;
    retry_history?: Array<{ booking_job_id: string; error: string | null; retried_at: string }>;
  };
  const attemptCount = previousAudit.attempt_count ?? 1;
  const MAX_TRANSIENT_RETRIES = 1; // 2 attempts total

  if (
    classification.failure_reason === "executor_error" &&
    isTransientError(step.error) &&
    attemptCount < 1 + MAX_TRANSIENT_RETRIES
  ) {
    const baseUrl = DEFAULT_BASE_URL;
    const fetchFn: FetchLike = (url, init) => fetch(url, init);
    try {
      // Re-dispatch: createBookingJob with new uuid, fire /start, repoint
      // the case row to the new job. Next polling tick will resolve it.
      const newJobId = await dispatchBenchmarkCase({
        caseRow,
        mode: caseRow.mode,
        baseUrl,
        fetchFn,
      });
      console.log(
        `[benchmark] case ${caseRow.case_id} hit transient error (attempt ${attemptCount}); re-dispatched as ${newJobId}: ${(step.error ?? "").slice(0, 80)}`,
      );
      // dispatchBenchmarkCase already set status='running' + bookingJobId=newJobId.
      // We just patch audit with the retry history.
      return updateBenchmarkCase(caseRow.id, {
        audit: {
          ...previousAudit,
          attempt_count: attemptCount + 1,
          retry_history: [
            ...(previousAudit.retry_history ?? []),
            {
              booking_job_id: caseRow.booking_job_id ?? "",
              error: step.error ?? null,
              retried_at: new Date().toISOString(),
            },
          ],
        },
        finalize: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[benchmark] retry dispatch failed for case ${caseRow.case_id}: ${msg}; finalising as executor_error`,
      );
      // Fall through to normal finalise with the original error.
    }
  }

  const createdAt = new Date(job.created_at).getTime();
  const completedAt = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  const durationSeconds = Math.max(0, Math.round((completedAt - createdAt) / 1000));

  return updateBenchmarkCase(caseRow.id, {
    status: classification.status,
    success: classification.success,
    failureReason: classification.failure_reason,
    paymentStopTriggered: classification.payment_stop_triggered,
    humanHandoffRequired: classification.human_handoff_required,
    safeOutcome: classification.safe_outcome,
    fullyAutomatedSuccess: classification.fully_automated_success,
    verifyGateTriggered: classification.verify_gate_triggered,
    deepLinkHandoffTriggered: classification.deep_link_handoff_triggered,
    wrongActionTaken: classification.wrong_action_taken,
    unsupportedPlatformDetected: classification.unsupported_platform_detected,
    durationSeconds,
    audit: {
      ...previousAudit,
      attempt_count: attemptCount,
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

/**
 * Runs the dispatch loop in batches of BATCH_SIZE. Within each batch every
 * case is fire-and-forget'd 500ms apart; the loop then polls until ALL the
 * batch's cases are finalised (status ≠ pending/running) before dispatching
 * the next batch. This caps in-flight chromium sessions at BATCH_SIZE so
 * 50-case runs don't OOM the dev machine.
 *
 * Long-running — caller must NOT await it directly. runRestaurantBenchmark
 * fires it via `void` and returns the run_id immediately so the dashboard
 * can start polling.
 */
async function runBatchDispatcher(input: {
  runId: string;
  caseRows: BenchmarkCaseRow[];
  mode: BenchmarkMode;
  baseUrl: string;
  fetchFn: FetchLike;
  batchSize: number;
}): Promise<void> {
  const { runId, caseRows, mode, baseUrl, fetchFn, batchSize } = input;
  const STAGEHAND_STARTUP_STAGGER_MS = 500;
  const POLL_INTERVAL_MS = 10_000; // dashboard refreshes every 10s anyway
  const MAX_BATCH_WAIT_MS = 8 * 60_000; // 8 min cap per batch — single case usually <2 min

  const batchCount = Math.ceil(caseRows.length / batchSize);
  for (let batchIdx = 0; batchIdx < batchCount; batchIdx += 1) {
    const start = batchIdx * batchSize;
    const batch = caseRows.slice(start, start + batchSize);

    console.log(
      `[benchmark] ${runId} batch ${batchIdx + 1}/${batchCount}: dispatching ${batch.length} cases`,
    );

    // ── Dispatch every case in this batch ───────────────────────────────
    for (let j = 0; j < batch.length; j += 1) {
      try {
        await dispatchBenchmarkCase({ caseRow: batch[j], mode, baseUrl, fetchFn });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateBenchmarkCase(batch[j].id, {
          status: "failed",
          success: false,
          failureReason: "executor_error",
          audit: { reason: `dispatch failed: ${msg}` },
          finalize: true,
        });
      }
      if (j < batch.length - 1) {
        await new Promise((r) => setTimeout(r, STAGEHAND_STARTUP_STAGGER_MS));
      }
    }

    // ── Wait until every case in THIS batch is finalised ─────────────────
    const batchIds = new Set(batch.map((b) => b.id));
    const waitStart = Date.now();
    while (true) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      // resolveBenchmarkRun finalises any case whose booking_job has
      // reached a terminal state. Idempotent — safe to call repeatedly.
      try {
        await resolveBenchmarkRun(runId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[benchmark] ${runId} resolveBenchmarkRun failed: ${msg}`);
      }

      const all = await getBenchmarkCases(runId);
      const stillRunning = all.filter(
        (c) =>
          batchIds.has(c.id) && (c.status === "pending" || c.status === "running"),
      );
      if (stillRunning.length === 0) break;

      if (Date.now() - waitStart > MAX_BATCH_WAIT_MS) {
        // Force-finalise stuck cases as timeout so the next batch can start.
        console.warn(
          `[benchmark] ${runId} batch ${batchIdx + 1} exceeded ${MAX_BATCH_WAIT_MS}ms; finalising ${stillRunning.length} stuck case(s) as timed_out`,
        );
        for (const stuck of stillRunning) {
          await updateBenchmarkCase(stuck.id, {
            status: "timed_out",
            success: false,
            failureReason: "provider_timeout",
            audit: {
              ...((stuck.audit as Record<string, unknown>) ?? {}),
              batch_wait_timeout_ms: MAX_BATCH_WAIT_MS,
            },
            finalize: true,
          });
        }
        break;
      }
    }

    console.log(
      `[benchmark] ${runId} batch ${batchIdx + 1}/${batchCount} complete`,
    );
  }

  // Mark run completed.
  await setBenchmarkRunStatus(runId, "completed", { completed: true });
  console.log(`[benchmark] ${runId} all ${caseRows.length} cases finalised`);
}

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

  // Phase 1 (sync): create every case row up front as 'pending'. This lets
  // the dashboard show "50/50 cases queued, batch 1 dispatching" immediately
  // instead of revealing rows one at a time as they dispatch.
  const caseRows: BenchmarkCaseRow[] = [];
  for (const c of cases) {
    const caseRow = await createBenchmarkCase({
      runId: run.id,
      caseId: c.case_id,
      payload: c,
      mode: input.mode,
    });
    caseRows.push(caseRow);
  }

  // Phase 2 (async, background): dispatch in batches of BATCH_SIZE so we
  // never have more than BATCH_SIZE chromium sessions in flight at once.
  // 5 was empirically validated as the safe ceiling on the dev box.
  const BATCH_SIZE = input.batchSize ?? 5;
  void runBatchDispatcher({
    runId: run.id,
    caseRows,
    mode: input.mode,
    baseUrl,
    fetchFn,
    batchSize: BATCH_SIZE,
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[benchmark] ${run.id} batch dispatcher crashed: ${msg}`);
  });

  const summary = await summarizeBenchmarkRun(run.id);
  return {
    run_id: run.id,
    total: cases.length,
    dispatched: 0,
    status: "running",
    summary,
    message:
      `Queued ${cases.length} cases. Dispatching in batches of ${BATCH_SIZE} ` +
      `(only ${BATCH_SIZE} chromium sessions in-flight at any time). ` +
      `Poll GET /api/internal/benchmark/runs/${run.id} for live progress.`,
  };
}
