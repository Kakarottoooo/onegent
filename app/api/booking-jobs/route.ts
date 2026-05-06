import { NextRequest, NextResponse } from "next/server";
import {
  createBookingJob,
  getBookingJobsBySession,
  getBookingJobsByUser,
  deleteBookingJob,
  deleteMonitorsByJobId,
  clearDecisionRoomBookingJobsByIds,
  getSharedArtifactsByRefs,
  type SharedArtifact,
} from "@/lib/db";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import type { AgentAutonomySettings } from "@/lib/autonomy";
import { randomUUID } from "crypto";
import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { isCoreExecutionSource, isCoreSupported, markStepForCore } from "@/lib/core/cend-adapter";
import { canUseNoDatabaseBookingJobsFallback } from "@/lib/booking-jobs/db-errors";
import { prepareWorkerQueueSteps } from "@/lib/booking-jobs/worker-enqueue";

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

  const userId = await getOptionalClerkUserId();
  const jobId = randomUUID();

  const initialSteps: BookingJobStep[] = steps.map((s) => ({ ...s, status: "pending" }));

  // ── Dogfood: per-step dual-gate ───────────────────────────────────────────
  // If this job is worker-routable, insert it in worker-ready shape immediately.
  // Creating a core-marked row as plain "pending" leaves a race before /start
  // can flip it to pending_local; stale workers can claim that row and fail it.
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
  const lean = req.nextUrl.searchParams.get("lean") === "1";
  const scope = req.nextUrl.searchParams.get("scope");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw) || 0)) : null;
  const userId = await getOptionalClerkUserId();
  const includeUserJobs = scope !== "session";

  let sessionJobs: BookingJob[];
  let userJobs: BookingJob[];
  try {
    [sessionJobs, userJobs] = await Promise.all([
      getBookingJobsBySession(sessionId),
      includeUserJobs && userId ? getBookingJobsByUser(userId) : Promise.resolve([] as BookingJob[]),
    ]);
  } catch (err) {
    if (canUseNoDatabaseBookingJobsFallback(err)) {
      return NextResponse.json({ jobs: [] });
    }
    throw err;
  }

  const byId = new Map<string, BookingJob>();
  for (const j of sessionJobs) byId.set(j.id, j);
  for (const j of userJobs) if (!byId.has(j.id)) byId.set(j.id, j);
  const sortedJobs = [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const jobs = limit ? sortedJobs.slice(0, limit) : sortedJobs;

  if (lean) {
    return NextResponse.json(
      { jobs: jobs.map((j) => ({ ...j, own_share: null })) },
      { headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=10" } },
    );
  }

  // Attach `own_share` for the signed-in owner so /tasks can show
  // "Shared · X views" instead of a Share button when an artifact already
  // exists. Only owner-created shares — never leak someone else's slug.
  let shareMap: Record<string, SharedArtifact> = {};
  if (userId) {
    const ownedJobIds = jobs.filter((j) => j.user_id === userId).map((j) => j.id);
    if (ownedJobIds.length > 0) {
      shareMap = await getSharedArtifactsByRefs(userId, "booking", ownedJobIds);
    }
  }
  const enriched = jobs.map((j) => {
    const share = shareMap[j.id];
    return {
      ...j,
      own_share: share
        ? {
            slug: share.slug,
            view_count: share.view_count,
            visibility: share.visibility,
          }
        : null,
    };
  });

  return NextResponse.json({ jobs: enriched });
}

/**
 * DELETE /api/booking-jobs?session_id=... — bulk delete every job the user
 * currently sees on this page + their monitors + their Decision Room links.
 *
 * "Sees on this page" = session jobs UNION user-owned jobs (same logic as
 * the GET above). Previously DELETE only scoped by session_id, which left
 * the user's jobs from earlier sessions intact — they'd disappear from the
 * page momentarily then come back on the next GET, so Clear all felt broken.
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
    new Set([...sessionJobs, ...userJobs].map((j) => j.id))
  );
  if (allJobIds.length === 0) {
    return NextResponse.json({ deleted: true, count: 0 });
  }

  // Monitor rows are keyed by job_id (with an index), so per-id delete is cheap.
  await Promise.all(allJobIds.map((id) => deleteMonitorsByJobId(id)));
  await clearDecisionRoomBookingJobsByIds(allJobIds);
  await Promise.all(allJobIds.map((id) => deleteBookingJob(id)));
  return NextResponse.json({ deleted: true, count: allJobIds.length });
}
