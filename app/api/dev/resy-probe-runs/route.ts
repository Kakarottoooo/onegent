/**
 * GET /api/dev/resy-probe-runs — list probe-run summaries.
 *
 * Mirrors the gating of `/api/dev/benchmark-runs`: dev-mode by default,
 * prod requires `ENABLE_DEV_BENCHMARK_API=1` (same env var on purpose so
 * codex can flip both at once).
 *
 * Response:
 *   { runs: ResyProbeRunSummary[], total: number }
 *
 * On no-runs-yet returns `{ runs: [], total: 0 }` (not 404) so the
 * dashboard can show its "no probe runs yet, run X" empty state without
 * tripping its error path.
 */
import { NextResponse } from "next/server";
import { listResyProbeRunSummaries } from "@/lib/benchmark/resy-probe-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }

  const runs = await listResyProbeRunSummaries();
  return NextResponse.json({
    runs,
    total: runs.length,
  });
}

function isDevApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}
