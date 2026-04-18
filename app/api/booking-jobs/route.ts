import { NextRequest, NextResponse } from "next/server";
import { createBookingJob, getBookingJobsBySession, getBookingJobsByUser, deleteAllBookingJobsBySession, deleteAllMonitorsBySession } from "@/lib/db";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import type { AgentAutonomySettings } from "@/lib/autonomy";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";

/** POST /api/booking-jobs — create a new background booking job */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.session_id === "string" ? body.session_id : null;
  const tripLabel = typeof body?.trip_label === "string" ? body.trip_label : "My Trip";
  const steps: BookingJobStep[] = Array.isArray(body?.steps) ? body.steps : [];
  const autonomySettings: AgentAutonomySettings | null = body?.autonomy_settings ?? null;

  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  if (steps.length === 0) {
    return NextResponse.json({ error: "steps required" }, { status: 400 });
  }

  const { userId } = await auth();
  const jobId = randomUUID();

  const initialSteps: BookingJobStep[] = steps.map((s) => ({ ...s, status: "pending" }));

  const job = await createBookingJob({
    id: jobId,
    sessionId,
    userId: userId ?? null,
    tripLabel,
    steps: initialSteps,
    autonomySettings,
  });

  return NextResponse.json({ jobId: job.id, status: job.status });
}

/**
 * GET /api/booking-jobs — list jobs for the session, plus any jobs owned by
 * the authenticated user whose session_id is different (e.g. Decision Room
 * bookings that were created with one-off random UUIDs in earlier versions).
 * Merged + deduped by job id, sorted newest first.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const { userId } = await auth();

  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobsBySession(sessionId),
    userId ? getBookingJobsByUser(userId) : Promise.resolve([] as BookingJob[]),
  ]);

  const byId = new Map<string, BookingJob>();
  for (const j of sessionJobs) byId.set(j.id, j);
  for (const j of userJobs) if (!byId.has(j.id)) byId.set(j.id, j);
  const jobs = [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return NextResponse.json({ jobs });
}

/** DELETE /api/booking-jobs?session_id=... — bulk delete all jobs + their monitors */
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  await deleteAllMonitorsBySession(sessionId);
  await deleteAllBookingJobsBySession(sessionId);
  return NextResponse.json({ deleted: true });
}
