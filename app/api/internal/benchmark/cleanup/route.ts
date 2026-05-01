/**
 * POST /api/internal/benchmark/cleanup
 *
 * Wipe benchmark history (runs + cases via FK cascade). Refuses to delete
 * runs that are still pending/running unless body.includeInFlight = true.
 * Auth-gated by INTERNAL_ANALYTICS_USER_IDS.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { clearBenchmarkHistory } from "@/lib/benchmark/store";

export const dynamic = "force-dynamic";

interface CleanupBody {
  includeInFlight?: unknown;
}

export async function POST(req: NextRequest) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  const body = (await req.json().catch(() => ({}))) as CleanupBody;
  const includeInFlight = body.includeInFlight === true;

  try {
    const result = await clearBenchmarkHistory({ includeInFlight });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
