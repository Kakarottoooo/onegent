import type { BookingJob } from "@/lib/db";
import type { BookingJobListItem, TaskWorkspaceBucket } from "./read-model";

export type TaskWorkspaceStatusInput = Pick<BookingJob, "id" | "status"> &
  Partial<Pick<BookingJobListItem, "workspace" | "updated_at">>;

export type TaskEvidenceAction = {
  href: string;
  label: "Watch" | "Evidence";
  view: TaskWorkspaceBucket;
};

export function taskWorkspaceViewForStatus(status: BookingJob["status"]): TaskWorkspaceBucket {
  if (status === "pending" || status === "pending_local" || status === "running") {
    return "live";
  }
  return "history";
}

export function taskWorkspaceViewForJob(job: TaskWorkspaceStatusInput): TaskWorkspaceBucket {
  return job.workspace ?? taskWorkspaceViewForStatus(job.status);
}

export function taskDetailsHref(job: TaskWorkspaceStatusInput): string {
  const view = taskWorkspaceViewForJob(job);
  return `/tasks?view=${view}&focus=${encodeURIComponent(job.id)}`;
}

export function taskEvidenceAction(job: TaskWorkspaceStatusInput): TaskEvidenceAction {
  const view = taskWorkspaceViewForJob(job);
  const active = view === "live";
  return {
    href: taskDetailsHref(job),
    label: active ? "Watch" : "Evidence",
    view,
  };
}
