import { NextRequest, NextResponse } from "next/server";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";
import { getVisibleBookingJobs } from "@/lib/booking-jobs/read-model";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const includeShares = req.nextUrl.searchParams.get("include_share") === "1";
  const userId = await getOptionalClerkUserId();
  try {
    const jobs = await getVisibleBookingJobs({
      sessionId,
      userId,
      includeShares,
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({ jobs: [] });
    }
    throw err;
  }
}
