/**
 * POST /api/internal/site-skills/refresh
 *
 * Re-scan all finalised benchmark_cases and rebuild provider_skills rows.
 * Idempotent. Returns counts so the caller can verify the refresh ran.
 *
 * Auth-gated by INTERNAL_ANALYTICS_USER_IDS allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAnalyticsAccess } from "@/lib/scenarioEvents";
import { refreshProviderSkills } from "@/lib/site-skills/aggregate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest) {
  const access = await requireInternalAnalyticsAccess();
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason ?? "forbidden" },
      { status: access.status },
    );
  }

  try {
    const result = await refreshProviderSkills();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
