/**
 * POST /api/internal/benchmark/seed
 *
 * Internal-only entrypoint that creates a benchmark run + dispatches its
 * cases as real booking_jobs (with autonomy.benchmark_dry_run = true so the
 * provider layer refuses the final submit click). Auth-gated by the same
 * INTERNAL_ANALYTICS_USER_IDS allowlist used by /api/internal/scenario-events.
 *
 * Body (all fields optional):
 *   {
 *     name?:      string  // run label, default = auto-generated
 *     mode?:      "dry_run" | "full_commit"  // only dry_run accepted today
 *     maxCases?:  number  // cap how many cases dispatch this call (default 1)
 *     notes?:     string
 *   }
 *
 * Returns immediately with run_id; cases run asynchronously inside their own
 * /api/booking-jobs/[id]/start invocations. Poll GET /runs/[id] for results.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { runRestaurantBenchmark } from "@/lib/benchmark/run-restaurant-benchmark";
import type { BenchmarkMode } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SeedRequestBody {
  name?: unknown;
  mode?: unknown;
  notes?: unknown;
  maxCases?: unknown;
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

  // Cap defensively: 5 is total seed-case count; anything higher is a typo.
  let maxCases: number | undefined;
  if (typeof body.maxCases === "number" && Number.isFinite(body.maxCases)) {
    maxCases = Math.max(1, Math.min(5, Math.floor(body.maxCases)));
  }

  try {
    const result = await runRestaurantBenchmark({ name, mode, notes, maxCases });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
