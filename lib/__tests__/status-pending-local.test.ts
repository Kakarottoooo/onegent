import { describe, expect, it } from "vitest";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import { computeJobSemanticStatus, JOB_SEMANTIC_DISPLAY } from "@/lib/status";

function makeStep(overrides: Partial<BookingJobStep> = {}): BookingJobStep {
  return {
    type: "restaurant",
    emoji: "R",
    label: "Sirrah",
    apiEndpoint: "/api/booking-jobs/start",
    body: {},
    status: "pending",
    ...overrides,
  } as BookingJobStep;
}

function makeJob(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job-sirrah",
    session_id: "session-1",
    user_id: null,
    trip_label: "Sirrah",
    status: "pending_local",
    steps: [makeStep()],
    autonomy_settings: null,
    plan_version: 1,
    constraints: null,
    policy: null,
    created_at: "2026-05-05T06:49:14.638Z",
    updated_at: "2026-05-05T06:49:38.110Z",
    completed_at: "2026-05-05T06:49:17.073Z",
    ...overrides,
  };
}

describe("computeJobSemanticStatus pending_local", () => {
  it("treats local worker queue rows as pending instead of failed", () => {
    expect(computeJobSemanticStatus(makeJob())).toBe("pending");
  });

  it("uses the queued display label for pending_local rows", () => {
    const status = computeJobSemanticStatus(makeJob());
    expect(JOB_SEMANTIC_DISPLAY[status].label).toBe("Queued");
  });
});
