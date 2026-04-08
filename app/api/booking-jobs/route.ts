import { NextRequest, NextResponse } from "next/server";
import { createBookingJob, getBookingJobsBySession, deleteAllBookingJobsBySession, deleteAllMonitorsBySession } from "@/lib/db";
import type { BookingJobStep } from "@/lib/db";
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

/** GET /api/booking-jobs — list all jobs for the session */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const jobs = await getBookingJobsBySession(sessionId);
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
