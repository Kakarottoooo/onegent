/**
 * GET /api/v1/metrics/providers/[providerId]
 *
 * Per-provider success-rate metrics over an optional time window.
 * Intended for B 端 callers who want to know "how well does Onegent do
 * on opentable-com in the last 30 days?" before committing a booking.
 *
 * Auth: Authorization: Bearer ogk_live_<...>
 *
 * Query params:
 *   ?timeRangeDays=N  (optional, default 30, clamped to [1, 365])
 *
 * Response: ProviderSuccessRate shape from lib/core/metrics/types.
 *   {
 *     providerId: "opentable-com",
 *     successRate: 0.87,          // accepted / totalAttempts
 *     totalAttempts: 142,
 *     acceptedCount: 124,
 *     manualOverrideCount: 12,
 *     failedCount: 6,
 *     lastEventAt: "2026-04-23T..."
 *   }
 *
 * Returns an all-zero record (successRate=0, totalAttempts=0) when no
 * data exists — NOT a 404. Callers should gate on totalAttempts > N
 * before treating successRate as meaningful evidence.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { computeSuccessRate } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ providerId: string }> },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;

  const { providerId } = await ctx.params;
  if (!providerId) {
    return NextResponse.json(
      { error: { code: "missing_provider_id", message: "providerId path param required." } },
      { status: 400 },
    );
  }

  const rangeParam = req.nextUrl.searchParams.get("timeRangeDays");
  const sinceDays = rangeParam
    ? Math.max(1, Math.min(365, Number(rangeParam) || 30))
    : 30;

  const metrics = await computeSuccessRate(providerId, { sinceDays });

  return NextResponse.json(
    {
      ...metrics,
      timeRangeDays: sinceDays,
    },
    { status: 200 },
  );
}
