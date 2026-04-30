/**
 * GET  /api/internal/site-skills           — list all aggregated rows
 * POST /api/internal/site-skills/refresh   — trigger a re-aggregation pass
 *
 * Auth-gated by INTERNAL_ANALYTICS_USER_IDS allowlist (same gate as
 * /scenario-events and /benchmark).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { listProviderSkills } from "@/lib/site-skills/aggregate";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  try {
    const skills = await listProviderSkills();
    return NextResponse.json({ skills });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
