import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clearDecisionRoomBookingJobsByIds,
  createBookingJob,
  deleteBookingJob,
  deleteMonitorsByJobId,
  getBookingJobsBySession,
  getBookingJobsByUser,
} from "@/lib/db";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import type { AgentAutonomySettings } from "@/lib/autonomy";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";
import { getVisibleBookingJobs } from "@/lib/booking-jobs/read-model";
import { prepareWorkerQueueSteps } from "@/lib/booking-jobs/worker-enqueue";
import { isCoreExecutionSource, isCoreSupported, markStepForCore } from "@/lib/core/cend-adapter";

/** POST /api/booking-jobs - create a new background booking job. */
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

  const userId = await getOptionalClerkUserId();
  const jobId = randomUUID();
  const initialSteps: BookingJobStep[] = steps.map((s) => ({ ...s, status: "pending" }));

  const workerQueue = prepareWorkerQueueSteps(initialSteps, process.env.USE_WORKER_FOR);
  const useCoreForCend = process.env.USE_CORE_EXECUTOR_FOR_CEND === "true" && !!userId;
  const finalSteps: BookingJobStep[] = workerQueue.shouldUseWorkerQueue
    ? workerQueue.steps
    : useCoreForCend
      ? initialSteps.map((s) => (isCoreSupported(s.type) ? markStepForCore(s) : s))
      : initialSteps;

  const viaCoreCount = finalSteps.filter(
    (s) => isCoreExecutionSource((s.body as Record<string, unknown>).__source),
  ).length;
  if (viaCoreCount > 0) {
    console.log("[booking-jobs] dual-gate per-step", {
      jobId,
      step_count: finalSteps.length,
      via_core: viaCoreCount,
      worker_queue: workerQueue.shouldUseWorkerQueue,
      status: workerQueue.status ?? "pending",
    });
  }

  const job = await createBookingJob({
    id: jobId,
    sessionId,
    userId: userId ?? null,
    tripLabel,
    steps: finalSteps,
    autonomySettings,
    ...(workerQueue.status ? { status: workerQueue.status } : {}),
  });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    ...(viaCoreCount > 0 ? { _via_core: viaCoreCount } : {}),
  });
}

/**
 * Backward-compatible list route.
 * New high-traffic readers should prefer:
 * - /api/booking-jobs/summary for counts
 * - /api/booking-jobs/compact-list for list cards
 * - /api/booking-jobs/list for legacy full-job readers
 * - /api/booking-jobs/[id] for detail polling
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const userId = await getOptionalClerkUserId();

  try {
    const jobs = await getVisibleBookingJobs({
      sessionId,
      userId,
      includeShares: true,
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({ jobs: [] });
    }
    throw err;
  }
}

/**
 * DELETE /api/booking-jobs?session_id=... - bulk delete every job the user
 * currently sees on this page plus their monitors and Decision Room links.
 */
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const userId = await getOptionalClerkUserId();

  let sessionJobs: BookingJob[];
  let userJobs: BookingJob[];
  try {
    [sessionJobs, userJobs] = await Promise.all([
      getBookingJobsBySession(sessionId),
      userId ? getBookingJobsByUser(userId) : Promise.resolve([] as BookingJob[]),
    ]);
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({ deleted: true, count: 0 });
    }
    throw err;
  }

  const allJobIds = Array.from(
    new Set([...sessionJobs, ...userJobs].map((j) => j.id)),
  );
  if (allJobIds.length === 0) {
    return NextResponse.json({ deleted: true, count: 0 });
  }

  await Promise.all(allJobIds.map((id) => deleteMonitorsByJobId(id)));
  await clearDecisionRoomBookingJobsByIds(allJobIds);
  await Promise.all(allJobIds.map((id) => deleteBookingJob(id)));
  return NextResponse.json({ deleted: true, count: allJobIds.length });
}
