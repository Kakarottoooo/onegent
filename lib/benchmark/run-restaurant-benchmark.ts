/**
 * Restaurant booking benchmark runner.
 *
 * First batch (current): plumbing-only. Creates a run + per-case rows so
 * we can verify the schema, types, store, and API gate end-to-end. Cases
 * are immediately marked `skipped` with `dry_run_blocked` because the
 * worker-side dry_run hook isn't wired yet — running for real would create
 * actual restaurant reservations.
 *
 * Next batch will replace the skip loop with: dispatch a booking_job in
 * dry_run mode → poll for terminal status → write result back.
 *
 * Why land plumbing first: lets us prove data flow + auth gate + summary
 * stats with zero risk of polluting OpenTable / Resy with real bookings.
 */

import {
  createBenchmarkRun,
  createBenchmarkCase,
  updateBenchmarkCase,
  setBenchmarkRunStatus,
  summarizeBenchmarkRun,
} from "./store";
import { getRestaurantBenchmarkCases } from "./restaurant-cases";
import type {
  BenchmarkMode,
  BenchmarkRunSummary,
  RestaurantBenchmarkCase,
} from "./types";

export interface RunRestaurantBenchmarkInput {
  /** Friendly label, e.g. "NYC restaurant baseline 2026-04-30". */
  name: string;
  /** dry_run = stop before any real reservation submit. full_commit not yet supported. */
  mode: BenchmarkMode;
  /** Optional override; defaults to all NYC seed cases. */
  cases?: RestaurantBenchmarkCase[];
  /** Free-form notes attached to the run row. */
  notes?: string;
}

export interface RunRestaurantBenchmarkResult {
  run_id: string;
  total: number;
  status: "completed" | "errored";
  summary: BenchmarkRunSummary;
  /** Surfaces why the runner stopped early when no real cases were dispatched. */
  message?: string;
}

export async function runRestaurantBenchmark(
  input: RunRestaurantBenchmarkInput,
): Promise<RunRestaurantBenchmarkResult> {
  // Hard guard until the worker-side dry_run hook lands. Without it, any
  // dispatched job would actually try to commit a reservation — not what
  // benchmark mode promises.
  if (input.mode === "full_commit") {
    throw new Error(
      "full_commit mode is not implemented yet. Use 'dry_run'. " +
        "full_commit will be enabled once the worker honours the dry_run boundary.",
    );
  }

  const cases = input.cases ?? getRestaurantBenchmarkCases();
  if (cases.length === 0) {
    throw new Error("No benchmark cases provided");
  }

  const run = await createBenchmarkRun({
    name: input.name,
    city: "New York",
    scenario: "restaurant_booking",
    mode: input.mode,
    notes: input.notes ?? null,
  });

  await setBenchmarkRunStatus(run.id, "running");

  for (const c of cases) {
    const caseRow = await createBenchmarkCase({
      runId: run.id,
      caseId: c.case_id,
      payload: c,
      mode: input.mode,
    });

    // Plumbing-only mode: immediately skip with a clear marker so dashboards
    // can distinguish "we couldn't run this" from "this actually failed".
    await updateBenchmarkCase(caseRow.id, {
      status: "skipped",
      success: false,
      failureReason: "dry_run_blocked",
      audit: {
        reason:
          "Plumbing-only run. Worker dry_run boundary not yet wired; refusing to dispatch a real booking job.",
        case_id: c.case_id,
        expected_provider: c.expected_provider,
      },
      finalize: true,
    });
  }

  await setBenchmarkRunStatus(run.id, "completed", { completed: true });

  const summary = await summarizeBenchmarkRun(run.id);

  return {
    run_id: run.id,
    total: cases.length,
    status: "completed",
    summary,
    message:
      "Plumbing-only run: every case was marked `skipped` with reason `dry_run_blocked`. " +
      "The next batch will wire the worker-side dry_run boundary and dispatch real (non-committing) jobs.",
  };
}
