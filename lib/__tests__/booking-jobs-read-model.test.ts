import { describe, expect, it } from "vitest";
import type { BookingJobListRow, BookingJobSummary } from "@/lib/db";
import {
  buildBookingJobListItem,
  classifyBookingJobListItem,
  summarizeBookingJobs,
} from "@/lib/booking-jobs/read-model";
import { getTaskWorkspaceHref } from "@/lib/booking-jobs/workspace";

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

function listRow(overrides: Partial<BookingJobListRow> = {}): BookingJobListRow {
  return {
    ...summaryRow(),
    done_count: 0,
    awaiting_confirmation_count: 0,
    adjusted_count: 0,
    replan_count: 0,
    primary_step_type: "restaurant",
    primary_step_label: "Book Fumo",
    primary_step_status: "pending",
    primary_start_url: "https://www.opentable.com/r/fumo-soho-new-york",
    scenario: "restaurant",
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

describe("booking job compact list rows", () => {
  it("builds a compact task row without heavy detail fields", () => {
    const item = buildBookingJobListItem(listRow({
      id: "compact-1",
      status: "done",
      step_count: 2,
      done_count: 1,
      awaiting_confirmation_count: 1,
      action_count: 0,
      adjusted_count: 1,
      replan_count: 1,
    }));

    expect(item).toMatchObject({
      id: "compact-1",
      step_count: 2,
      done_count: 1,
      awaiting_confirmation_count: 1,
      adjusted_count: 1,
      replan_count: 1,
      provider: "opentable",
      workspace: "history",
      latest_status_label: "Ready to review - confirm on site",
    });
    expect(item).not.toHaveProperty("steps");
    expect(item).not.toHaveProperty("decisionLog");
    expect(item).not.toHaveProperty("autonomy_settings");
    expect(JSON.stringify(item)).not.toContain("profile");
  });

  it("classifies queue, active, ready-for-review, and historical rows without full steps", () => {
    expect(classifyBookingJobListItem(listRow({ status: "pending" }))).toBe("queue");
    expect(classifyBookingJobListItem(listRow({ status: "pending_local" }))).toBe("queue");
    expect(classifyBookingJobListItem(listRow({ status: "running" }))).toBe("live");
    expect(classifyBookingJobListItem(listRow({ status: "done", awaiting_confirmation_count: 1 }))).toBe("history");
    expect(classifyBookingJobListItem(listRow({
      status: "done",
      action_count: 1,
      awaiting_confirmation_count: 1,
    }))).toBe("queue");
    expect(classifyBookingJobListItem(listRow({ status: "failed", action_count: 1 }))).toBe("history");
    expect(classifyBookingJobListItem(listRow({ status: "done", step_count: 1, done_count: 1 }))).toBe("history");
  });

  it("labels event-choice rows as user input even when they are stored as awaiting confirmation", () => {
    const item = buildBookingJobListItem(listRow({
      status: "done",
      action_count: 1,
      awaiting_confirmation_count: 1,
      primary_step_status: "awaiting_confirmation",
    }));

    expect(item.workspace).toBe("queue");
    expect(item.latest_status_label).toBe("Needs your input");
  });

  it("keeps compact rows traceable to their source chat session", () => {
    const item = buildBookingJobListItem(listRow({
      id: "capture-job",
      session_id: "capture-chat-1",
      status: "done",
      step_count: 1,
      done_count: 1,
    }));

    expect(item.session_id).toBe("capture-chat-1");
    expect(item.workspace).toBe("history");
    expect(getTaskWorkspaceHref(item)).toBe(
      "/tasks?view=history&focus=capture-job&session_id=capture-chat-1",
    );
  });
});
