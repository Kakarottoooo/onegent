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

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw) || 0)) : 100;
  const scope = req.nextUrl.searchParams.get("scope");
  const includeUserJobs = scope !== "session";
  const userId = await getOptionalClerkUserId();

  try {
    const [sessionRows, userRows] = await Promise.all([
      getBookingJobCompactRowsBySession(sessionId, limit),
      includeUserJobs && userId
        ? getBookingJobCompactRowsByUser(userId, limit)
        : Promise.resolve([]),
    ]);
    const jobs = mergeCompactRows(sessionRows, userRows, limit);
    return NextResponse.json(
      { jobs, summary: summarizeBookingJobList(jobs) },
      { headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=10" } },
    );
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({
        jobs: [],
        summary: { total: 0, queue: 0, live: 0, history: 0, actions: 0, ready: 0 },
      });
    }
    throw err;
  }
}
