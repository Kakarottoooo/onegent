import type { BookingJob } from "@/lib/db";

export type TaskWorkspaceBucket = "queue" | "live" | "history";

export type TaskWorkspaceClassificationInput = Pick<BookingJob, "status"> & {
  workspace?: TaskWorkspaceBucket;
  updated_at?: string;
  step_count?: number;
  action_count?: number;
  done_count?: number;
  awaiting_confirmation_count?: number;
  primary_step_status?: string | null;
  steps?: Array<{ status?: string | null; actionItem?: unknown }>;
};

export type TaskWorkspaceStatusInput = Pick<BookingJob, "id"> & TaskWorkspaceClassificationInput;
export type TaskWorkspaceSourceInput = {
  session_id?: string | null;
  sourceSessionId?: string | null;
};
export type TaskWorkspaceHrefInput = TaskWorkspaceStatusInput & TaskWorkspaceSourceInput;

export type TaskEvidenceAction = {
  href: string;
  label: "Watch" | "Evidence";
  view: TaskWorkspaceBucket;
};

export type NormalizedTaskAction =
  | {
      kind: "watch";
      label: "Watch";
      href: string;
      view: TaskWorkspaceBucket;
    }
  | {
      kind: "details";
      label: "Details";
      href: string;
      view: TaskWorkspaceBucket;
    }
  | {
      kind: "evidence";
      label: "Evidence";
      href: string;
      view: TaskWorkspaceBucket;
    };

export type TaskWorkspaceHrefOptions = TaskWorkspaceSourceInput & {
  focusId?: string | null;
};

function numberField(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasReadyForReviewBoundary(job: TaskWorkspaceClassificationInput): boolean {
  if (numberField(job.awaiting_confirmation_count) > 0) return true;
  if (job.primary_step_status === "awaiting_confirmation") return true;
  return job.steps?.some((step) => step.status === "awaiting_confirmation") ?? false;
}

export function taskWorkspaceViewForStatus(status: BookingJob["status"]): TaskWorkspaceBucket {
  if (status === "pending" || status === "pending_local") {
    return "queue";
  }
  if (status === "running") {
    return "live";
  }
  return "history";
}

export function taskWorkspaceViewForJob(job: TaskWorkspaceClassificationInput): TaskWorkspaceBucket {
  if (job.workspace) return job.workspace;
  if (job.status === "pending" || job.status === "pending_local") return "queue";
  if (job.status === "running") return "live";
  if (hasReadyForReviewBoundary(job)) return "history";
  if (job.status === "done" || job.status === "failed") return "history";
  if (numberField(job.action_count) > 0) return "queue";

  const stepCount = numberField(job.step_count);
  const doneCount = numberField(job.done_count);
  if (stepCount > 0 && doneCount > 0 && doneCount < stepCount) return "queue";

  return taskWorkspaceViewForStatus(job.status);
}

export function taskSourceSessionId(source: TaskWorkspaceSourceInput): string | null {
  const raw = source.sourceSessionId ?? source.session_id ?? null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function taskWorkspaceHrefForView(
  view: TaskWorkspaceBucket,
  options: TaskWorkspaceHrefOptions = {},
): string {
  const parts = [`view=${encodeURIComponent(view)}`];
  if (options.focusId) parts.push(`focus=${encodeURIComponent(options.focusId)}`);
  const sourceSessionId = taskSourceSessionId(options);
  if (sourceSessionId) parts.push(`session_id=${encodeURIComponent(sourceSessionId)}`);
  return `/tasks?${parts.join("&")}`;
}

export function taskDetailsHref(job: TaskWorkspaceHrefInput): string {
  const view = taskWorkspaceViewForJob(job);
  return taskWorkspaceHrefForView(view, {
    focusId: job.id,
    sourceSessionId: taskSourceSessionId(job),
  });
}

export function getTaskWorkspaceHref(job: TaskWorkspaceHrefInput): string {
  return taskDetailsHref(job);
}

export function getTaskEvidenceHref(job: TaskWorkspaceHrefInput): string {
  return taskDetailsHref(job);
}

export function normalizeTaskAction(
  job: TaskWorkspaceHrefInput,
  kind: NormalizedTaskAction["kind"] = "details",
): NormalizedTaskAction {
  const view = taskWorkspaceViewForJob(job);
  const href = taskDetailsHref(job);
  if (kind === "watch") {
    return { kind, label: "Watch", href, view };
  }
  if (kind === "evidence") {
    return { kind, label: "Evidence", href, view };
  }
  return { kind, label: "Details", href, view };
}

export function taskEvidenceAction(job: TaskWorkspaceHrefInput): TaskEvidenceAction {
  const view = taskWorkspaceViewForJob(job);
  const active = view === "live" || view === "queue";
  return {
    href: getTaskEvidenceHref(job),
    label: active ? "Watch" : "Evidence",
    view,
  };
}
