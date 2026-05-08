import type { TaskWorkspaceBucket } from "@/lib/booking-jobs/workspace";
import type { TravelTaskState } from "@/lib/core";
import type {
  ActivitySkillOutcome,
  ActivitySkillPageType,
  ActivitySkillProvider,
} from "./types";

export type ActivitySkillRuntimeNextAction =
  | "start_provider_execution"
  | "ask_user_to_choose_event"
  | "hold_for_manual_review"
  | "ask_user_to_select_seats"
  | "ask_user_to_sign_in"
  | "stop_before_payment_or_final_action"
  | "capture_provider_degraded_evidence"
  | "collect_required_evidence"
  | "create_reviewed_skill_patch";

export type ActivitySkillEvidenceRequirement =
  | "provider"
  | "page_type"
  | "currentUrl"
  | "screenshot"
  | "action_log"
  | "visible_candidate_facts";

export type ActivitySkillRuntimeEvidenceInput = {
  provider?: ActivitySkillProvider | string | null;
  pageType?: ActivitySkillPageType | string | null;
  currentUrl?: string | null;
  screenshotRef?: string | null;
  actionLog?: string[] | null;
  visibleCandidateFacts?: string[] | null;
};

export type ActivitySkillRuntimeInput = ActivitySkillRuntimeEvidenceInput & {
  outcome: ActivitySkillOutcome;
};

export type ActivitySkillEvidenceCheck = {
  complete: boolean;
  missing: ActivitySkillEvidenceRequirement[];
};

export type ActivitySkillTaskDecision = {
  outcome: ActivitySkillOutcome;
  taskState: TravelTaskState;
  workspaceBucket: TaskWorkspaceBucket;
  safeNextAction: ActivitySkillRuntimeNextAction;
  canExecuteProviderContinuation: boolean;
  requiresUserAction: boolean;
  hardStop: boolean;
  evidence: ActivitySkillEvidenceCheck;
  summary: string;
};

export const ACTIVITY_TASK_WORKSPACE_EVIDENCE_REQUIREMENTS: ReadonlyArray<ActivitySkillEvidenceRequirement> =
  Object.freeze([
    "provider",
    "page_type",
    "currentUrl",
    "screenshot",
    "action_log",
    "visible_candidate_facts",
  ]);

export const ACTIVITY_EXECUTABLE_OUTCOMES: ReadonlySet<ActivitySkillOutcome> =
  Object.freeze(new Set<ActivitySkillOutcome>([
    "exact_event_ready",
    "single_candidate_ready",
  ]));

export const ACTIVITY_HUMAN_ONLY_BOUNDARY_OUTCOMES: ReadonlySet<ActivitySkillOutcome> =
  Object.freeze(new Set<ActivitySkillOutcome>([
    "provider_listing_needs_choice",
    "safe_handoff_reached",
    "user_seat_selection_required",
    "account_session_required",
    "payment_or_final_action_required",
  ]));

const OUTCOME_DECISIONS: Readonly<Record<ActivitySkillOutcome, Omit<ActivitySkillTaskDecision, "outcome" | "evidence">>> =
  Object.freeze({
    exact_event_ready: {
      taskState: "draft",
      workspaceBucket: "queue",
      safeNextAction: "start_provider_execution",
      canExecuteProviderContinuation: true,
      requiresUserAction: false,
      hardStop: false,
      summary: "Exact event page is identified and can start provider execution.",
    },
    provider_listing_needs_choice: {
      taskState: "ready_for_confirmation",
      workspaceBucket: "queue",
      safeNextAction: "ask_user_to_choose_event",
      canExecuteProviderContinuation: false,
      requiresUserAction: true,
      hardStop: false,
      summary: "Provider listing has multiple visible candidates; ask the user which event to use.",
    },
    single_candidate_ready: {
      taskState: "draft",
      workspaceBucket: "queue",
      safeNextAction: "start_provider_execution",
      canExecuteProviderContinuation: true,
      requiresUserAction: false,
      hardStop: false,
      summary: "One strong candidate matches the request and can start provider execution.",
    },
    safe_handoff_reached: {
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "hold_for_manual_review",
      canExecuteProviderContinuation: false,
      requiresUserAction: true,
      hardStop: false,
      summary: "Provider page reached a user-controlled manual-review boundary.",
    },
    user_seat_selection_required: {
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "ask_user_to_select_seats",
      canExecuteProviderContinuation: false,
      requiresUserAction: true,
      hardStop: true,
      summary: "Seat map or ticket choice is visible; the user must choose seats.",
    },
    account_session_required: {
      taskState: "awaiting_login",
      workspaceBucket: "history",
      safeNextAction: "ask_user_to_sign_in",
      canExecuteProviderContinuation: false,
      requiresUserAction: true,
      hardStop: true,
      summary: "Account, sign-in, or session verification is required; stop for the user.",
    },
    payment_or_final_action_required: {
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "stop_before_payment_or_final_action",
      canExecuteProviderContinuation: false,
      requiresUserAction: true,
      hardStop: true,
      summary: "Payment, purchase, or final confirmation boundary is visible; stop immediately.",
    },
    provider_degraded: {
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "capture_provider_degraded_evidence",
      canExecuteProviderContinuation: false,
      requiresUserAction: false,
      hardStop: false,
      summary: "Provider page is degraded, blocked, unavailable, or not safe to continue.",
    },
    insufficient_evidence: {
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "collect_required_evidence",
      canExecuteProviderContinuation: false,
      requiresUserAction: false,
      hardStop: false,
      summary: "Evidence bundle is incomplete; collect required task-workspace evidence before continuing.",
    },
    skill_patch_needed: {
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "create_reviewed_skill_patch",
      canExecuteProviderContinuation: false,
      requiresUserAction: false,
      hardStop: false,
      summary: "A likely skill patch was found; review and test it before it can become runtime behavior.",
    },
  });

export function validateActivitySkillEvidence(
  evidence: ActivitySkillRuntimeEvidenceInput,
): ActivitySkillEvidenceCheck {
  const missing: ActivitySkillEvidenceRequirement[] = [];
  if (!hasText(evidence.provider)) missing.push("provider");
  if (!hasText(evidence.pageType)) missing.push("page_type");
  if (!hasText(evidence.currentUrl)) missing.push("currentUrl");
  if (!hasText(evidence.screenshotRef)) missing.push("screenshot");
  if (!hasEntries(evidence.actionLog)) missing.push("action_log");
  if (!hasEntries(evidence.visibleCandidateFacts)) {
    missing.push("visible_candidate_facts");
  }
  return { complete: missing.length === 0, missing };
}

export function mapActivitySkillOutcomeToTaskDecision(
  input: ActivitySkillRuntimeInput,
): ActivitySkillTaskDecision {
  const evidence = validateActivitySkillEvidence(input);
  if (!evidence.complete && ACTIVITY_EXECUTABLE_OUTCOMES.has(input.outcome)) {
    return {
      outcome: "insufficient_evidence",
      ...OUTCOME_DECISIONS.insufficient_evidence,
      evidence,
    };
  }
  return {
    outcome: input.outcome,
    ...OUTCOME_DECISIONS[input.outcome],
    evidence,
  };
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasEntries(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => hasText(entry));
}
