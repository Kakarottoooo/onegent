import { NextRequest, NextResponse } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";
import {
  getVisibleBookingJobSummaries,
  summarizeBookingJobs,
} from "@/lib/booking-jobs/read-model";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const userId = await getOptionalClerkUserId();
  try {
    const jobs = await getVisibleBookingJobSummaries({
      sessionId,
      userId,
      limit: 30,
    });
    return NextResponse.json({ summary: summarizeBookingJobs(jobs) });
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({
        summary: {
          total: 0,
          action_count: 0,
          active_count: 0,
          completed_count: 0,
          failed_count: 0,
          latest_updated_at: null,
        },
      });
    }
    throw err;
  }
}
