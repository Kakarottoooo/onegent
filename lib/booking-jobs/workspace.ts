import type { BookingJob } from "@/lib/db";

export type TaskWorkspaceView = "queue" | "live" | "history";

export type TaskEvidenceActionKind = "watch" | "details" | "evidence" | "pay";

export type TaskWorkspaceJobLike = Pick<
  BookingJob,
  "id" | "status" | "created_at" | "updated_at" | "completed_at"
> & {
  action_count?: number;
  ready_step_count?: number;
  step_count?: number;
};

export function taskWorkspaceViewForStatus(status: unknown): TaskWorkspaceView {
  if (status === "running") return "live";
  if (status === "pending" || status === "pending_local") return "queue";
  return "history";
}

export function taskWorkspaceViewForJob(job: Pick<TaskWorkspaceJobLike, "status">): TaskWorkspaceView {
  return taskWorkspaceViewForStatus(job.status);
}

export function buildTaskWorkspaceHref(
  jobId: string,
  view: TaskWorkspaceView,
  mode: "details" | "evidence" = "details",
): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("focus", jobId);
  if (mode === "evidence") params.set("panel", "evidence");
  return `/tasks?${params.toString()}`;
}

export function getTaskWorkspaceHref(job: Pick<TaskWorkspaceJobLike, "id" | "status">): string {
  return buildTaskWorkspaceHref(job.id, taskWorkspaceViewForJob(job));
}

export function getTaskEvidenceHref(job: Pick<TaskWorkspaceJobLike, "id" | "status">): string {
  return buildTaskWorkspaceHref(job.id, taskWorkspaceViewForJob(job), "evidence");
}

export function normalizeTaskAction(
  job: Pick<TaskWorkspaceJobLike, "id" | "status">,
  kind: TaskEvidenceActionKind,
): { href: string; label: string; opensEvidence: boolean } {
  const view = taskWorkspaceViewForJob(job);
  if (kind === "watch") {
    return { href: buildTaskWorkspaceHref(job.id, view, "evidence"), label: "Watch", opensEvidence: true };
  }
  if (kind === "evidence") {
    return { href: buildTaskWorkspaceHref(job.id, view, "evidence"), label: "Evidence", opensEvidence: true };
  }
  if (kind === "pay") {
    return { href: buildTaskWorkspaceHref(job.id, view, "evidence"), label: "Review", opensEvidence: true };
  }
  return { href: buildTaskWorkspaceHref(job.id, view), label: "Details", opensEvidence: false };
}

export function taskEvidenceAction(
  job: Pick<TaskWorkspaceJobLike, "id" | "status">,
): { href: string; label: "Watch" | "Evidence"; opensEvidence: true } {
  const view = taskWorkspaceViewForJob(job);
  return {
    href: buildTaskWorkspaceHref(job.id, view, "evidence"),
    label: view === "live" ? "Watch" : "Evidence",
    opensEvidence: true,
  };
}
