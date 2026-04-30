/**
 * GET /api/internal/benchmark/runs?limit=N
 *
 * Lists recent benchmark runs for the internal dashboard. Auth-gated by
 * INTERNAL_ANALYTICS_USER_IDS allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { listBenchmarkRuns } from "@/lib/benchmark/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 50;

  try {
    const runs = await listBenchmarkRuns(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
