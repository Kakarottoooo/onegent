import { NextRequest, NextResponse } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import {
  CALENDAR_JOBS_HEAVY_FIELDS_EXCLUDED,
  getVisibleCalendarJobItems,
} from "@/lib/calendar-read-model";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
  const userId = await getOptionalClerkUserId();
  const jobs = await getVisibleCalendarJobItems({ sessionId, userId, limit });

  return NextResponse.json({
    jobs,
    meta: {
      shape: "calendar-jobs",
      count: jobs.length,
      heavy_fields_excluded: CALENDAR_JOBS_HEAVY_FIELDS_EXCLUDED,
    },
  });
}
