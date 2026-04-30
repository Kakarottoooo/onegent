/**
 * POST /api/internal/benchmark/seed
 *
 * Internal-only entrypoint to kick off a benchmark run. Auth-gated by the
 * same INTERNAL_ANALYTICS_USER_IDS allowlist used by /api/internal/scenario-events.
 *
 * Body (all fields optional):
 *   {
 *     name?:  string         // run label, default = auto-generated
 *     mode?:  "dry_run"      // only dry_run accepted in this batch
 *     notes?: string
 *   }
 *
 * Behaviour in this batch: plumbing only. Creates run + case rows, marks every
 * case as `skipped` with `dry_run_blocked`. Returns the run_id and summary so
 * the caller can verify the data pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { runRestaurantBenchmark } from "@/lib/benchmark/run-restaurant-benchmark";
import type { BenchmarkMode } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SeedRequestBody {
  name?: unknown;
  mode?: unknown;
  notes?: unknown;
}

export async function POST(req: NextRequest) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  const body = (await req.json().catch(() => ({}))) as SeedRequestBody;

  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : `NYC restaurant benchmark ${new Date().toISOString()}`;

  const rawMode = typeof body.mode === "string" ? body.mode : "dry_run";
  if (rawMode !== "dry_run" && rawMode !== "full_commit") {
    return NextResponse.json(
      { error: `mode must be 'dry_run' or 'full_commit', got: ${rawMode}` },
      { status: 400 },
    );
  }
  const mode: BenchmarkMode = rawMode as BenchmarkMode;

  const notes = typeof body.notes === "string" ? body.notes : undefined;

  try {
    const result = await runRestaurantBenchmark({ name, mode, notes });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
