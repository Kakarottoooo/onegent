import { NextRequest, NextResponse } from "next/server";
import {
  getBookingJobCompactRowsBySession,
  getBookingJobCompactRowsByUser,
} from "@/lib/db";
import {
  mergeCompactRows,
  summarizeBookingJobList,
} from "@/lib/booking-jobs/read-model";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const userId = await getOptionalClerkUserId();

  try {
    const [sessionRows, userRows] = await Promise.all([
      getBookingJobCompactRowsBySession(sessionId, 200),
      userId ? getBookingJobCompactRowsByUser(userId, 200) : Promise.resolve([]),
    ]);
    const jobs = mergeCompactRows(sessionRows, userRows, 200);
    return NextResponse.json(
      { summary: summarizeBookingJobList(jobs) },
      { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" } },
    );
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({
        summary: { total: 0, queue: 0, live: 0, history: 0, actions: 0, ready: 0 },
      });
    }
    throw err;
  }
}
