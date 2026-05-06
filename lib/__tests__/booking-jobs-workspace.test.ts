import { describe, expect, it } from "vitest";
import {
  getTaskEvidenceHref,
  getTaskWorkspaceHref,
  taskEvidenceAction,
  taskWorkspaceViewForStatus,
} from "@/lib/booking-jobs/workspace";

describe("task workspace routing", () => {
  it("keeps not-started tasks in queue and running tasks in live", () => {
    expect(taskWorkspaceViewForStatus("pending")).toBe("queue");
    expect(taskWorkspaceViewForStatus("pending_local")).toBe("queue");
    expect(taskWorkspaceViewForStatus("running")).toBe("live");
  });

  it("keeps completed, review-ready, and failed tasks in history", () => {
    expect(taskWorkspaceViewForStatus("done")).toBe("history");
    expect(taskWorkspaceViewForStatus("failed")).toBe("history");
  });

  it("builds canonical details and evidence URLs", () => {
    const job = { id: "job_123", status: "done" as const };
    expect(getTaskWorkspaceHref(job)).toBe("/tasks?view=history&focus=job_123");
    expect(getTaskEvidenceHref(job)).toBe("/tasks?view=history&focus=job_123&panel=evidence");
  });

  it("uses Watch only for live jobs and Evidence for saved task records", () => {
    expect(taskEvidenceAction({ id: "job_live", status: "running" }).label).toBe("Watch");
    expect(taskEvidenceAction({ id: "job_done", status: "done" }).label).toBe("Evidence");
  });
});
