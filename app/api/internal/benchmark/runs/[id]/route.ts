/**
 * GET /api/internal/benchmark/runs/[id]
 *
 * Returns a benchmark run + its cases + summary stats. Resolves any cases
 * whose underlying booking_job has reached a terminal state — so this
 * endpoint doubles as the polling target.
 *
 * Auth-gated by INTERNAL_ANALYTICS_USER_IDS (same as /seed and /scenario-events).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { resolveBenchmarkRun } from "@/lib/benchmark/run-restaurant-benchmark";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "run id required" }, { status: 400 });
  }

  try {
    const { run, cases, summary } = await resolveBenchmarkRun(id);
    if (!run) {
      return NextResponse.json({ error: "run not found" }, { status: 404 });
    }
    return NextResponse.json({ run, cases, summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
