/**
 * GET /api/cron/retry-jobs
 *
 * Vercel Cron — runs every hour. Finds booking job steps that have a
 * retryScheduledFor timestamp in the past, resets them to pending, and
 * re-triggers the job's start endpoint.
 *
 * The start endpoint skips steps that are already "done", so only the
 * failed/scheduled steps are re-attempted.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getJobsWithPendingRetries,
  updateBookingJobSteps,
  updateBookingJobStatus,
} from "@/lib/db";
import type { BookingJobStep } from "@/lib/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest) {
  // Validate Vercel cron secret (optional but recommended)
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await getJobsWithPendingRetries();
  const now = new Date().toISOString();
  const triggered: string[] = [];

  for (const job of jobs) {
    // Reset steps that are due for retry — clear retry schedule and error state
    const updatedSteps: BookingJobStep[] = job.steps.map((step) => {
      if (step.retryScheduledFor && step.retryScheduledFor <= now && step.status !== "done") {
        return {
          ...step,
          status: "pending" as const,
          retryScheduledFor: undefined,
          error: undefined,
          attemptCount: 0,
          decisionLog: [
            ...(step.decisionLog ?? []),
            {
              ts: now,
              type: "retry" as const,
              message: `Scheduled retry triggered at ${new Date(now).toLocaleTimeString()}`,
            },
          ],
        };
      }
      return step;
    });

    await updateBookingJobSteps(job.id, updatedSteps);
    // Round-3 phantom isolation: re-enqueue with PENDING_QUEUE_STATUS so
    // phantom's `WHERE status='pending'` cannot see the retry row.
    const { PENDING_QUEUE_STATUS } = await import("@/lib/core/cend-adapter");
    await updateBookingJobStatus(job.id, PENDING_QUEUE_STATUS as "pending");

    // Fire-and-forget — don't await so cron doesn't time out
    fetch(`${BASE_URL}/api/booking-jobs/${job.id}/start`, { method: "POST" }).catch(
      () => {}
    );
    triggered.push(job.id);
  }

  return NextResponse.json({
    ok: true,
    checked: jobs.length,
    triggered: triggered.length,
    jobIds: triggered,
  });
}
