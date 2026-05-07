import { describe, expect, it } from "vitest";
import type { BookingJob } from "@/lib/db";
import { canAccessBookingJob, readBookingJobSessionId } from "@/lib/booking-jobs/access";

const baseJob: BookingJob = {
  id: "job-1",
  session_id: "session-owner",
  user_id: "user-owner",
  trip_label: "Test task",
  status: "done",
  steps: [],
  autonomy_settings: null,
  plan_version: 1,
  constraints: null,
  policy: null,
  created_at: "2026-05-07T00:00:00.000Z",
  updated_at: "2026-05-07T00:00:00.000Z",
  completed_at: null,
};

describe("booking job access guard", () => {
  it("allows the owning Clerk user", () => {
    const decision = canAccessBookingJob(baseJob, {
      userId: "user-owner",
      sessionId: null,
    });
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.reason).toBe("owner_user");
  });

  it("allows the source session without a user", () => {
    const decision = canAccessBookingJob(baseJob, {
      userId: null,
      sessionId: "session-owner",
    });
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.reason).toBe("source_session");
  });

  it("rejects a mismatched session", () => {
    const decision = canAccessBookingJob(baseJob, {
      userId: null,
      sessionId: "session-other",
    });
    expect(decision).toMatchObject({
      ok: false,
      status: 403,
      reason: "session_mismatch",
    });
  });

  it("rejects missing context in production-shaped checks", () => {
    const decision = canAccessBookingJob({ ...baseJob, user_id: null }, {
      userId: null,
      sessionId: null,
      allowDevAnonymous: false,
    });
    expect(decision).toMatchObject({
      ok: false,
      status: 403,
      reason: "missing_access_context",
    });
  });

  it("keeps anonymous local dogfood jobs readable in non-production dev", () => {
    const decision = canAccessBookingJob({ ...baseJob, user_id: null }, {
      userId: null,
      sessionId: null,
      allowDevAnonymous: true,
    });
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.reason).toBe("dev_anonymous");
  });

  it("reads session_id from query before header", () => {
    const req = new Request("http://local.test/api/booking-jobs/job-1?session_id=from-query", {
      headers: { "x-onegent-session-id": "from-header" },
    });
    expect(readBookingJobSessionId(req)).toBe("from-query");
  });

  it("falls back to x-onegent-session-id header", () => {
    const req = new Request("http://local.test/api/booking-jobs/job-1", {
      headers: { "x-onegent-session-id": "from-header" },
    });
    expect(readBookingJobSessionId(req)).toBe("from-header");
  });
});
