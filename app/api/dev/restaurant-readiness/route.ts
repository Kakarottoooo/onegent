/**
 * GET /api/dev/restaurant-readiness
 *
 * Returns the aggregated `RestaurantReadinessSummary` consumed by
 * `/dev/restaurant-readiness`. Read-only, dev-gated.
 *
 * No path params, no query params — there's no traversal vector
 * because the loader walks a fixed allow-listed dir tree
 * (`benchmark/runs/` + `worker/.debug-screenshots/<allow-listed providers>/`).
 *
 * On any internal failure the loader returns an empty-ish shell rather
 * than throwing, so this endpoint stays at 200 with `goNoGo: "needs_probe"`
 * even when the suite hasn't been initialized.
 *
 * Gate matches `/api/dev/benchmark-runs`: dev-mode by default, prod
 * requires `ENABLE_DEV_BENCHMARK_API=1` (same env var on purpose so
 * codex can flip both at once).
 */
import { NextResponse } from "next/server";
import { buildReadinessSummary } from "@/lib/benchmark/restaurant-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }

  const summary = await buildReadinessSummary();
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
