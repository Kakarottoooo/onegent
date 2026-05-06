import { describe, expect, it } from "vitest";
import type { BookingJobSummary } from "@/lib/db";
import { summarizeBookingJobs } from "@/lib/booking-jobs/read-model";

function summaryRow(overrides: Partial<BookingJobSummary> = {}): BookingJobSummary {
  return {
    id: "job-1",
    session_id: "session-1",
    user_id: null,
    trip_label: "Test job",
    status: "pending",
    step_count: 1,
    action_count: 0,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("summarizeBookingJobs", () => {
  it("counts active, completed, failed, and action jobs from summary rows", () => {
    const summary = summarizeBookingJobs([
      summaryRow({ id: "pending", status: "pending", action_count: 1 }),
      summaryRow({ id: "pending-local", status: "pending_local", action_count: 0 }),
      summaryRow({ id: "running", status: "running", action_count: 2 }),
      summaryRow({ id: "done", status: "done", action_count: 1 }),
      summaryRow({ id: "failed", status: "failed", action_count: 0 }),
    ]);

    expect(summary).toMatchObject({
      total: 5,
      action_count: 4,
      active_count: 3,
      completed_count: 1,
      failed_count: 1,
    });
  });

  it("uses the newest updated_at as the latest summary timestamp", () => {
    const summary = summarizeBookingJobs([
      summaryRow({ id: "older", updated_at: "2026-05-05T01:00:00.000Z" }),
      summaryRow({ id: "newer", updated_at: "2026-05-05T02:30:00.000Z" }),
      summaryRow({ id: "middle", updated_at: "2026-05-05T02:00:00.000Z" }),
    ]);

    expect(summary.latest_updated_at).toBe("2026-05-05T02:30:00.000Z");
  });

  it("returns a stable empty summary", () => {
    expect(summarizeBookingJobs([])).toEqual({
      total: 0,
      action_count: 0,
      active_count: 0,
      completed_count: 0,
      failed_count: 0,
      latest_updated_at: null,
    });
  });
});
