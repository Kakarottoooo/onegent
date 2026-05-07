import { getOptionalClerkUserId } from "@/lib/auth/optional-clerk-user";
import { getBookingJob, type BookingJob } from "@/lib/db";

export type BookingJobAccessDecision =
  | {
      ok: true;
      job: BookingJob;
      reason: "owner_user" | "source_session" | "dev_anonymous";
    }
  | {
      ok: false;
      status: 403 | 404;
      error: "Job not found" | "Forbidden";
      reason:
        | "missing_job"
        | "session_mismatch"
        | "user_mismatch"
        | "missing_access_context";
    };

export type BookingJobAccessContext = {
  userId?: string | null;
  sessionId?: string | null;
  allowDevAnonymous?: boolean;
};

export function readBookingJobSessionId(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("session_id");
  const fromHeader = req.headers.get("x-onegent-session-id");
  return normalizeSessionId(fromQuery) ?? normalizeSessionId(fromHeader);
}

export function canAccessBookingJob(
  job: BookingJob,
  context: BookingJobAccessContext,
): BookingJobAccessDecision {
  const userId = normalizeSessionId(context.userId);
  const sessionId = normalizeSessionId(context.sessionId);

  if (job.user_id && userId === job.user_id) {
    return { ok: true, job, reason: "owner_user" };
  }
  if (sessionId && sessionId === job.session_id) {
    return { ok: true, job, reason: "source_session" };
  }

  // Local dogfood has historical anonymous jobs whose older UI callers did
  // not attach session_id to every artifact route. Keep that compatibility out
  // of production while newer callers migrate onto session-bound URLs.
  if (!job.user_id && !sessionId && context.allowDevAnonymous) {
    return { ok: true, job, reason: "dev_anonymous" };
  }

  if (sessionId && sessionId !== job.session_id) {
    return { ok: false, status: 403, error: "Forbidden", reason: "session_mismatch" };
  }
  if (job.user_id && userId && userId !== job.user_id) {
    return { ok: false, status: 403, error: "Forbidden", reason: "user_mismatch" };
  }
  return {
    ok: false,
    status: 403,
    error: "Forbidden",
    reason: "missing_access_context",
  };
}

export async function resolveBookingJobAccess(
  req: Request,
  jobId: string,
): Promise<BookingJobAccessDecision> {
  const job = await getBookingJob(jobId);
  if (!job) {
    return { ok: false, status: 404, error: "Job not found", reason: "missing_job" };
  }
  const userId = await getOptionalClerkUserId();
  return canAccessBookingJob(job, {
    userId,
    sessionId: readBookingJobSessionId(req),
    allowDevAnonymous: process.env.NODE_ENV !== "production",
  });
}

function normalizeSessionId(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
