/**
 * GET /api/dev/resy-run-analysis
 *
 * Returns the aggregated `ResyRunAnalysisSummary` consumed by
 * `/dev/resy-run-analysis`. Read-only, dev-gated.
 *
 * No path params, no query params — there's no traversal vector
 * because the loader walks a fixed allow-listed dir tree
 * (`benchmark/runs/` + `worker/.debug-screenshots/<allow-listed-providers>/`).
 *
 * On any internal failure the loader returns an empty-ish shell rather
 * than throwing, so this endpoint stays at 200 with `verdict: "NEED_PROBE"`
 * (or similar) even when the suite hasn't been initialized.
 *
 * Gate matches the rest of `/api/dev/*`: dev-mode by default, prod
 * requires `ENABLE_DEV_BENCHMARK_API=1` (same env var on purpose so
 * codex can flip all dev APIs at once).
 */
import { NextResponse } from "next/server";
import { buildResyRunAnalysis } from "@/lib/benchmark/resy-run-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }
  const summary = await buildResyRunAnalysis();
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}

function isDevApiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
}
