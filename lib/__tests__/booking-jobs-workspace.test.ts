import { describe, expect, it } from "vitest";
import {
  taskDetailsHref,
  taskEvidenceAction,
  taskWorkspaceViewForJob,
  taskWorkspaceViewForStatus,
} from "@/lib/booking-jobs/workspace";

describe("booking job workspace helpers", () => {
  it("routes active statuses to live and terminal statuses to history", () => {
    expect(taskWorkspaceViewForStatus("pending")).toBe("live");
    expect(taskWorkspaceViewForStatus("pending_local")).toBe("live");
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

  it("labels saved terminal evidence differently from live watch state", () => {
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
