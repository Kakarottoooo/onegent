import { NextRequest, NextResponse } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";
import { getVisibleBookingJobListItems } from "@/lib/booking-jobs/read-model";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const includeShares = req.nextUrl.searchParams.get("include_share") === "1";
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(100, Math.floor(limitParam)))
    : 60;
  const userId = await getOptionalClerkUserId();

  try {
    const jobs = await getVisibleBookingJobListItems({
      sessionId,
      userId,
      includeShares,
      limit,
    });
    return NextResponse.json({
      jobs,
      meta: {
        shape: "compact",
        count: jobs.length,
        heavy_fields_excluded: [
          "steps",
          "decisionLog",
          "screenshots",
          "logs",
          "profile",
          "autonomy_settings",
        ],
      },
    });
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({
        jobs: [],
        meta: {
          shape: "compact",
          count: 0,
          heavy_fields_excluded: [
            "steps",
            "decisionLog",
            "screenshots",
            "logs",
            "profile",
            "autonomy_settings",
          ],
        },
      });
    }
    throw err;
  }
}
