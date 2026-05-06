import { describe, expect, it } from "vitest";
import {
  getTaskEvidenceHref,
  getTaskWorkspaceHref,
  normalizeTaskAction,
  taskDetailsHref,
  taskEvidenceAction,
  taskWorkspaceViewForJob,
  taskWorkspaceViewForStatus,
} from "@/lib/booking-jobs/workspace";

describe("booking job workspace helpers", () => {
  it("routes queued, active, and terminal statuses into stable workspace buckets", () => {
    expect(taskWorkspaceViewForStatus("pending")).toBe("queue");
    expect(taskWorkspaceViewForStatus("pending_local")).toBe("queue");
    expect(taskWorkspaceViewForStatus("running")).toBe("live");
    expect(taskWorkspaceViewForStatus("done")).toBe("history");
    expect(taskWorkspaceViewForStatus("failed")).toBe("history");
  });

  it("respects compact-list workspace buckets when present", () => {
    expect(taskWorkspaceViewForJob({ id: "job-1", status: "done", workspace: "queue" })).toBe("queue");
    expect(taskDetailsHref({ id: "job 1", status: "done", workspace: "history" })).toBe(
      "/tasks?view=history&focus=job%201",
    );
  });

  it("keeps ready-for-review human boundaries out of queue", () => {
    expect(taskWorkspaceViewForJob({
      id: "review",
      status: "done",
      awaiting_confirmation_count: 1,
    })).toBe("history");
    expect(taskWorkspaceViewForJob({
      id: "review-step",
      status: "done",
      steps: [{ status: "awaiting_confirmation" }],
    })).toBe("history");
  });

  it("normalizes task details and evidence hrefs", () => {
    const queued = { id: "job 1", status: "pending" as const };
    expect(getTaskWorkspaceHref(queued)).toBe("/tasks?view=queue&focus=job%201");
    expect(getTaskEvidenceHref({ id: "job 2", status: "running" })).toBe(
      "/tasks?view=live&focus=job%202",
    );
    expect(normalizeTaskAction(queued, "details")).toMatchObject({
      kind: "details",
      label: "Details",
      view: "queue",
    });
    expect(normalizeTaskAction({ id: "done", status: "done" }, "evidence")).toMatchObject({
      kind: "evidence",
      label: "Evidence",
      view: "history",
    });
  });

  it("labels queued/live watch actions separately from saved terminal evidence", () => {
    expect(taskEvidenceAction({ id: "queued", status: "pending" })).toMatchObject({
      label: "Watch",
      view: "queue",
    });
    expect(taskEvidenceAction({ id: "active", status: "running" })).toMatchObject({
      label: "Watch",
      view: "live",
    });
    expect(taskEvidenceAction({ id: "closed", status: "failed" })).toMatchObject({
      label: "Evidence",
      view: "history",
    });
  });
});
