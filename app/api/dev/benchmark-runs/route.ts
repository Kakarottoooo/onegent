import { NextResponse } from "next/server";
import { listPhase0BenchmarkRunSummaries } from "@/lib/benchmark/phase0-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevBenchmarkApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }

  const runs = await listPhase0BenchmarkRunSummaries();
  return NextResponse.json({
    runs,
    total: runs.length,
  });
}

function isDevBenchmarkApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}
