import { describe, expect, it } from "vitest";
import type { BookingJob } from "@/lib/db";
import {
  compactRowFromJob,
  mergeCompactRows,
  summarizeBookingJobList,
  toBookingJobListItem,
} from "@/lib/booking-jobs/read-model";

function job(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: "job_1",
    session_id: "session_1",
    user_id: "user_1",
    trip_label: "Sirrah",
    status: "done",
    steps: [
      {
        type: "restaurant",
        emoji: "restaurant",
        label: "Sirrah",
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {},
        fallbackUrl: "https://example.com",
        status: "awaiting_confirmation",
        handoff_url: "https://opentable.example/details",
      },
    ],
    autonomy_settings: null,
    plan_version: 1,
    constraints: null,
    policy: null,
    created_at: "2026-05-06T10:00:00.000Z",
    updated_at: "2026-05-06T10:01:00.000Z",
    completed_at: "2026-05-06T10:01:00.000Z",
    ...overrides,
  };
}

describe("booking job compact read model", () => {
  it("extracts compact task fields without retaining heavy step payloads", () => {
    const row = compactRowFromJob(job());

    expect(row).toMatchObject({
      id: "job_1",
      trip_label: "Sirrah",
      step_count: 1,
      ready_step_count: 1,
      first_step_type: "restaurant",
      first_step_label: "Sirrah",
      has_handoff_url: true,
    });
    expect(row).not.toHaveProperty("steps");
    expect(row).not.toHaveProperty("decisionLog");
    expect(row).not.toHaveProperty("autonomy_settings");
  });

  it("adds workspace and summary fields for list rendering", () => {
    const item = toBookingJobListItem(compactRowFromJob(job({ status: "pending_local" })));

    expect(item.workspace).toBe("queue");
    expect(item.latest_status_label).toBe("Queued locally");
  });

  it("dedupes session and user rows and computes workspace totals", () => {
    const sessionRow = compactRowFromJob(job({ id: "job_1", status: "running" }));
    const duplicateUserRow = compactRowFromJob(job({ id: "job_1", status: "done" }));
    const secondUserRow = compactRowFromJob(job({
      id: "job_2",
      status: "failed",
      created_at: "2026-05-06T10:02:00.000Z",
    }));

    const items = mergeCompactRows([sessionRow], [duplicateUserRow, secondUserRow], 10);
    const summary = summarizeBookingJobList(items);

    expect(items.map((item) => item.id)).toEqual(["job_2", "job_1"]);
    expect(summary).toMatchObject({ total: 2, queue: 0, live: 1, history: 1 });
  });
});
