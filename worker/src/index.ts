/**
 * @onegent/worker — Booking-autopilot poll loop.
 *
 * Polls `booking_jobs` for status='pending', claims via FOR UPDATE SKIP
 * LOCKED, executes via lib/core's runExecutionJobWithRecovery, and writes
 * status back. Bounded in-process concurrency (MAX_CONCURRENT_JOBS, default
 * 2) keeps a single 1GB Railway container under control; horizontal scale
 * is "add another Railway service".
 *
 * Worker only handles jobs whose every step body carries the
 * `__source === "lib/core/execution"` marker. Legacy-shape jobs stay on
 * Vercel (the /api/booking-jobs/[id]/start route in the Next.js app).
 * Vercel's USE_WORKER_FOR env var enforces the gate by short-circuiting
 * to enqueue when all step types match.
 */
import { sql } from "@vercel/postgres";
import { hostname } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Local-dev convenience: hydrate process.env from ../.env.local ──────────
// In Docker / Railway this file doesn't exist — we silently fall through to
// whatever the container injected.
const localEnvPath = resolve(process.cwd(), "..", ".env.local");
if (existsSync(localEnvPath)) {
  for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// Imports below this line — must come AFTER env hydration so any module-level
// env reads (lib/db.ts uses POSTGRES_URL via @vercel/postgres) see the values.
import {
  getJobsWithPendingRetries,
  updateBookingJobStatus,
  updateBookingJobSteps,
  type BookingJob,
  type BookingJobStep,
  type DecisionLogEntry,
} from "@/lib/db";
import { runExecutionJobWithRecovery } from "@/lib/core/execution/recovery";
import type {
  ExecutionJobRequest,
  ExecutionParams,
  ExecutionScenario,
} from "@/lib/core/execution/types";
import type { ConsentPolicy } from "@/lib/core/consent/types";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "5000", 10);
const MAX_CONCURRENT_JOBS = parseInt(
  process.env.MAX_CONCURRENT_JOBS ?? "2",
  10,
);
const STEP_TIMEOUT_MS = parseInt(
  process.env.STEP_TIMEOUT_MS ?? `${10 * 60 * 1000}`, // 10 min default
  10,
);
const RETRY_SCAN_INTERVAL_MS = parseInt(
  process.env.RETRY_SCAN_INTERVAL_MS ?? "60000", // 60s default
  10,
);
const WORKER_ID =
  process.env.WORKER_INSTANCE_ID ||
  `worker-${hostname()}-${Math.random().toString(36).slice(2, 8)}`;

let shuttingDown = false;
let activeJobs = 0;

function log(...parts: unknown[]): void {
  console.log(`[${new Date().toISOString()}] [${WORKER_ID}]`, ...parts);
}

function logError(msg: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  console.error(`[${new Date().toISOString()}] [${WORKER_ID}] ${msg}: ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Job claim ──────────────────────────────────────────────────────────────
//
// Atomic SELECT + UPDATE with FOR UPDATE SKIP LOCKED — Postgres canonical
// queue pattern. Each worker (and each in-process concurrent claim) gets
// exactly one row; no double-execution races even with N instances.
async function claimOne(): Promise<BookingJob | null> {
  const result = await sql<BookingJob>`
    UPDATE booking_jobs
    SET status = 'running', updated_at = NOW()
    WHERE id = (
      SELECT id FROM booking_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ── Single-step executor ───────────────────────────────────────────────────
//
// Reconstructs the lib/core ExecutionJobRequest from BookingJobStep.body
// (the upstream creator — chat-commit, create-trip, room synthesis — wrote
// the marker via lib/core/execution/job-manager.buildStepFromRequest).
// Then delegates to runExecutionJobWithRecovery for full retry+fallback.
async function runStep(
  job: BookingJob,
  step: BookingJobStep,
  stepIndex: number,
): Promise<BookingJobStep> {
  const body = step.body as Record<string, unknown>;

  if (body?.__source !== "lib/core/execution") {
    // Vercel's gate should have kept this on the legacy path. Log loudly so
    // the misrouting is obvious — and fail-fast so the job goes to "failed"
    // rather than silently completing without execution.
    return {
      ...step,
      status: "error",
      error:
        "Worker received legacy-shape step (missing __source marker). " +
        "This should not happen with USE_WORKER_FOR gating intact.",
    };
  }

  const request: ExecutionJobRequest = {
    request: {
      scenario: body.scenario as ExecutionScenario,
      params: body.params,
    } as ExecutionParams,
    profileId: typeof body.profileId === "number" ? body.profileId : undefined,
    consent: body.consent as ConsentPolicy | undefined,
  };

  const result = await Promise.race([
    runExecutionJobWithRecovery(request, {
      jobId: job.id,
      userId: job.user_id,
      stepIndex,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Step timed out after ${STEP_TIMEOUT_MS / 1000}s`)),
        STEP_TIMEOUT_MS,
      ),
    ),
  ]);

  const stepStatus: BookingJobStep["status"] =
    result.status === "paused_payment"
      ? "awaiting_confirmation"
      : result.status === "completed"
      ? "done"
      : result.status === "no_availability"
      ? "no_availability"
      : "error";

  return {
    ...step,
    status: stepStatus,
    handoff_url: result.handoffUrl ?? step.handoff_url,
    session_url: result.sessionUrl ?? step.session_url,
    error: result.error ?? step.error,
    attemptCount: result.attemptCount ?? step.attemptCount,
    usedFallback: result.usedFallback ?? step.usedFallback,
    decisionLog: result.decisionLog ?? step.decisionLog,
  };
}

// ── Job runner ─────────────────────────────────────────────────────────────
//
// Mirrors the parallel-vs-sequential split from app/api/booking-jobs/[id]/start
// route.ts: trip-package jobs (>=2 steps) run all steps in parallel via
// Promise.allSettled; single-step jobs run sequentially.
async function runJob(job: BookingJob): Promise<void> {
  log(`▶ job ${job.id} (${job.steps.length} step(s)) starting`);
  const startedAt = Date.now();

  const updatedSteps: BookingJobStep[] = [...job.steps];

  // Serialize DB writes from concurrent step progress callbacks.
  let dbWriteChain: Promise<void> = Promise.resolve();
  const writeSteps = (): Promise<void> => {
    const p = dbWriteChain
      .then(() => updateBookingJobSteps(job.id, updatedSteps))
      .then(() => {});
    dbWriteChain = p.catch(() => {});
    return p;
  };

  const runStepAt = async (i: number): Promise<void> => {
    if (updatedSteps[i].status === "done") return;
    try {
      updatedSteps[i] = await runStep(job, updatedSteps[i], i);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unhandled step error";
      updatedSteps[i] = { ...updatedSteps[i], status: "error", error: errMsg };
      logError(`step ${i} of job ${job.id} threw`, err);
    }
    await writeSteps();
  };

  if (updatedSteps.length >= 2) {
    await Promise.allSettled(updatedSteps.map((_, i) => runStepAt(i)));
  } else {
    for (let i = 0; i < updatedSteps.length; i++) {
      await runStepAt(i);
    }
  }

  await dbWriteChain.catch(() => {});

  const doneCount = updatedSteps.filter((s) => s.status === "done").length;
  const awaitingCount = updatedSteps.filter(
    (s) => s.status === "awaiting_confirmation",
  ).length;
  const completedCount = doneCount + awaitingCount;
  const finalStatus: BookingJob["status"] = completedCount > 0 ? "done" : "failed";

  await updateBookingJobStatus(job.id, finalStatus, new Date());

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log(
    `✓ job ${job.id} → ${finalStatus} ` +
      `(${doneCount}/${updatedSteps.length} done, ${awaitingCount} awaiting payment) ` +
      `in ${elapsedSec}s`,
  );
}

// ── Scheduled-retry scanner ────────────────────────────────────────────────
//
// Mirrors app/api/cron/retry-jobs/route.ts: scan booking_jobs for steps
// with retryScheduledFor in the past, reset them to 'pending', and clear
// retry metadata. The main poll loop will then claim+execute naturally —
// no HTTP fire-and-forget needed (unlike the Vercel cron).
//
// Coexistence: Vercel's /api/cron/retry-jobs continues to run on its
// hourly schedule, calling /api/booking-jobs/[id]/start which short-
// circuits to 202 for worker-routable jobs. Both paths are convergent
// (UPDATEs to status='pending' are idempotent; FOR UPDATE SKIP LOCKED
// in claimOne prevents double-claim). Once we burn the 30-day fallback
// window we'll delete the Vercel cron in a separate cleanup pass.
async function processScheduledRetries(): Promise<void> {
  let jobs: BookingJob[];
  try {
    jobs = await getJobsWithPendingRetries();
  } catch (err) {
    logError("retry scan failed", err);
    return;
  }

  if (jobs.length === 0) return;

  const now = new Date().toISOString();
  let resetCount = 0;

  for (const job of jobs) {
    const updatedSteps: BookingJobStep[] = job.steps.map((step) => {
      if (
        step.retryScheduledFor &&
        step.retryScheduledFor <= now &&
        step.status !== "done"
      ) {
        resetCount++;
        const retryEntry: DecisionLogEntry = {
          ts: now,
          type: "retry",
          message: `Scheduled retry triggered by worker at ${new Date(now).toLocaleTimeString()}`,
        };
        return {
          ...step,
          status: "pending" as const,
          retryScheduledFor: undefined,
          error: undefined,
          attemptCount: 0,
          decisionLog: [...(step.decisionLog ?? []), retryEntry],
        };
      }
      return step;
    });

    try {
      await updateBookingJobSteps(job.id, updatedSteps);
      await updateBookingJobStatus(job.id, "pending");
    } catch (err) {
      logError(`retry reset failed for job ${job.id}`, err);
    }
  }

  log(`retry scan: ${resetCount} step(s) reset across ${jobs.length} job(s)`);
}

// ── Main loop with bounded concurrency ─────────────────────────────────────
async function main(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL env var is required");
  }

  log(`starting — node ${process.version} on ${process.platform}`);
  log(
    `config: poll=${POLL_INTERVAL_MS / 1000}s ` +
      `max_concurrent=${MAX_CONCURRENT_JOBS} ` +
      `step_timeout=${STEP_TIMEOUT_MS / 1000}s ` +
      `retry_scan=${RETRY_SCAN_INTERVAL_MS / 1000}s`,
  );

  await sql`SELECT 1 AS ping`;
  log(`postgres connected`);

  // Scheduled-retry scanner runs in its own setInterval — independent of
  // the main claim loop so a long-running browser task can't starve retries.
  const retryTimer = setInterval(() => {
    processScheduledRetries().catch((err) => logError("retry scan threw", err));
  }, RETRY_SCAN_INTERVAL_MS);
  // Run once on startup so we don't wait the full interval after a deploy.
  processScheduledRetries().catch((err) => logError("initial retry scan threw", err));

  while (!shuttingDown) {
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      // Capacity-bound: short backoff, no DB query
      await sleep(2000);
      continue;
    }

    let job: BookingJob | null = null;
    try {
      job = await claimOne();
    } catch (err) {
      logError("claimOne failed", err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      log(
        `no jobs pending (active=${activeJobs}/${MAX_CONCURRENT_JOBS}, sleeping ${POLL_INTERVAL_MS / 1000}s)`,
      );
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    activeJobs++;
    log(`claimed job ${job.id} (active=${activeJobs}/${MAX_CONCURRENT_JOBS})`);

    // Fire-and-forget — main loop immediately tries to claim the next job
    // if capacity allows. Failure handling lives inside runJob / runStep.
    runJob(job)
      .catch((err) => {
        logError(`runJob ${job.id} threw at top level`, err);
        // Best-effort: mark job failed so it doesn't hang in 'running'
        return updateBookingJobStatus(job.id, "failed", new Date()).catch(() => {});
      })
      .finally(() => {
        activeJobs--;
      });
  }

  clearInterval(retryTimer);

  // Drain in-flight before exit (Railway gives ~10s after SIGTERM)
  log(`shutdown initiated — waiting for ${activeJobs} in-flight job(s) to drain (max 60s)`);
  const drainStart = Date.now();
  while (activeJobs > 0 && Date.now() - drainStart < 60_000) {
    await sleep(500);
  }
  if (activeJobs > 0) {
    log(`drain timeout — ${activeJobs} job(s) still running, exiting anyway`);
  } else {
    log(`graceful shutdown complete`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  log(`SIGTERM received — finishing in-flight jobs then exiting`);
  shuttingDown = true;
});

process.on("SIGINT", () => {
  log(`SIGINT received — finishing in-flight jobs then exiting`);
  shuttingDown = true;
});

main().catch((err) => {
  logError("fatal error in main", err);
  process.exit(1);
});
