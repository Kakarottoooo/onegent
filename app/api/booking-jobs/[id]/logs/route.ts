import { NextResponse } from "next/server";
import { liveLogGet, liveLogIsClosed, liveLogEpoch } from "@/lib/live-log-store";
import { getAgentLogs, getBookingJob } from "@/lib/db";

const TERMINAL_JOB_STATUSES = new Set(["done", "failed", "cancelled", "succeeded"]);

/**
 * GET /api/booking-jobs/[id]/logs?after=N
 *
 * Returns the live execution trace for a booking_job, used by the Tasks
 * timeline UI. Two sources are merged:
 *
 *   1. lib/live-log-store (in-memory, per-process) — populated by the
 *      Vercel-side in-process executor (lib/booking-autopilot/stagehand-
 *      executor.ts). Captures every Stagehand action as it happens.
 *
 *   2. agent_logs (DB, source='audit') — populated by writeAudit calls
 *      from lib/core/execution/executor.ts and recovery.ts. Lower
 *      cardinality (one entry per major decision: job_started, step_started,
 *      job_failed, retry, time_adjusted, provider_fallback, ...) but
 *      cross-process visible. This is the ONLY source for jobs run by the
 *      Railway worker, since worker writes to its own in-memory live-log-
 *      store which Vercel can't see.
 *
 * Source selection:
 *   - If lib/live-log-store has entries → use it (richer, full Stagehand trace).
 *   - Otherwise, fall back to agent_logs (DB, available cross-process).
 *
 * The B+B2 architecture moved primary execution to the worker, so the
 * fallback is now the common case for chat-commit jobs. Without it the
 * Tasks UI showed "No live trace captured for this run yet." even when
 * the worker was actively running the job.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const after = parseInt(url.searchParams.get("after") ?? "0", 10);

  // Source 1: in-memory (Vercel-side) live trace.
  const liveLines = liveLogGet(id, after);
  if (liveLines.length > 0) {
    return NextResponse.json({
      entries: liveLines,
      lines: liveLines.map((entry) => entry.line),
      total: after + liveLines.length,
      closed: liveLogIsClosed(id),
      epoch: liveLogEpoch(id),
      source: "live",
    });
  }

  // Source 2: DB audit log (worker-routed jobs land here).
  const auditRows = await getAgentLogs({
    jobId: id,
    source: "audit",
    limit: 500,
  });
  // getAgentLogs returns DESC; flip to chronological so the UI's "after"
  // cursor advances as the run progresses.
  const chronological = [...auditRows].reverse();
  const sliced = chronological.slice(after);

  const entries = sliced.map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const eventType = typeof details.type === "string" ? details.type : "info";
    // row.created_at typing varies across drivers; coerce to Date defensively.
    const rawTs = row.created_at as unknown;
    const ts = rawTs instanceof Date
      ? rawTs.toISOString()
      : new Date(rawTs as string | number).toISOString();
    return {
      line: `[${eventType}] ${row.message}`,
      ts,
    };
  });

  // Treat the run as "closed" once the booking_job has reached a terminal
  // status — without this, the UI would keep polling forever for finished
  // worker runs (which never call liveLogClose on the Vercel side).
  const job = await getBookingJob(id);
  const closed = !!job && TERMINAL_JOB_STATUSES.has(job.status);

  return NextResponse.json({
    entries,
    lines: entries.map((e) => e.line),
    total: after + entries.length,
    closed,
    // No epoch tracking for DB-sourced runs — agent_logs is append-only,
    // there's no per-run reset. UI uses epoch only to detect "fresh run
    // started, drop old buffer", which is irrelevant when reading from DB.
    epoch: 0,
    source: "audit",
  });
}
