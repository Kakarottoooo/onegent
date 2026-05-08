/**
 * Stage 0B L2RecoveryResult — pure helpers.
 *
 * Build and validate the per-run summary the lab emits alongside the JSONL
 * event stream. Downstream cockpit / patch-proposal code consumes this
 * shape; the runner is the only writer.
 */

import type {
  L2EvidenceBundle,
  L2RecoveryClass,
  L2RecoveryResult,
  L2SafeNextAction,
  LabHardStopReason,
  SkillPatchProposal,
  Stage0bLabProvider,
} from "./types";

/**
 * Canonical mapping from L2RecoveryClass → safe next action. Locked here
 * so the runner cannot ship a result that says "exact_event_ready" but
 * `review_capture` (or vice versa). Tests pin the table.
 */
export const RECOVERY_OUTCOMES: ReadonlyArray<{
  classification: L2RecoveryClass;
  safe_next_action: L2SafeNextAction;
  description: string;
}> = Object.freeze([
  {
    classification: "exact_event_ready",
    safe_next_action: "start_task",
    description:
      "URL or page uniquely identifies an event and provider runtime can start.",
  },
  {
    classification: "single_candidate_ready",
    safe_next_action: "start_task",
    description:
      "Listing/artist page has exactly one obvious candidate matching the user's constraints.",
  },
  {
    classification: "provider_listing_needs_choice",
    safe_next_action: "ask_user_choice",
    description:
      "Listing/artist/grouping page has 2+ event candidates; the user must pick.",
  },
  {
    classification: "safe_handoff_reached",
    safe_next_action: "user_handoff_required",
    description:
      "Provider page reached a user-controlled continuation boundary that is not a hard stop.",
  },
  {
    classification: "user_seat_selection_required",
    safe_next_action: "user_handoff_required",
    description:
      "Seat map / seat picker is visible. The lab MUST stop; the user picks seats.",
  },
  {
    classification: "account_session_required",
    safe_next_action: "user_handoff_required",
    description:
      "Login / account verification wall is visible. The lab MUST stop.",
  },
  {
    classification: "payment_or_final_action_required",
    safe_next_action: "user_handoff_required",
    description:
      "Payment form / final-confirm button is visible. The lab MUST stop.",
  },
  {
    classification: "provider_degraded",
    safe_next_action: "review_capture",
    description:
      "Provider page is unavailable, blocked, or rendering broken content.",
  },
  {
    classification: "insufficient_evidence",
    safe_next_action: "review_capture",
    description:
      "Missing screenshot/log/currentUrl/candidate evidence; the run is inconclusive.",
  },
  {
    classification: "skill_patch_needed",
    safe_next_action: "review_patch_proposal",
    description:
      "Harness saw a structural change; a reviewed patch should land before further runs.",
  },
]);

export function safeNextActionFor(classification: L2RecoveryClass): L2SafeNextAction {
  for (const row of RECOVERY_OUTCOMES) {
    if (row.classification === classification) return row.safe_next_action;
  }
  // Defensive — should be unreachable given the union type, but if a new
  // classification is added without updating RECOVERY_OUTCOMES we want
  // the runner to fail loudly rather than ship the wrong action.
  throw new Error(`safeNextActionFor: no entry for classification "${classification}"`);
}

export interface BuildL2RecoveryResultInput {
  run_id: string;
  started_at: string;
  finished_at: string;
  provider: Stage0bLabProvider;
  classification: L2RecoveryClass;
  evidence: L2EvidenceBundle;
  skill_patch_proposal?: SkillPatchProposal;
  notes?: string;
}

/**
 * Build a fully-validated L2RecoveryResult. Enforces:
 *   - safe_next_action is derived from RECOVERY_OUTCOMES (not free-form)
 *   - evidence bundle is required (evidence-first)
 *   - skill_patch_needed flag and patch payload are consistent
 *   - hard_stops list inside evidence stays a non-null array
 */
export function buildL2RecoveryResult(input: BuildL2RecoveryResultInput): L2RecoveryResult {
  if (!input.run_id) {
    throw new Error("buildL2RecoveryResult: run_id is required");
  }
  if (!input.evidence) {
    throw new Error("buildL2RecoveryResult: evidence is required (evidence-first)");
  }
  if (!Array.isArray(input.evidence.screenshot_paths)) {
    throw new Error("buildL2RecoveryResult: evidence.screenshot_paths must be an array");
  }
  if (!Array.isArray(input.evidence.hard_stops)) {
    throw new Error("buildL2RecoveryResult: evidence.hard_stops must be an array");
  }
  if (!input.evidence.jsonl_path) {
    throw new Error("buildL2RecoveryResult: evidence.jsonl_path is required");
  }
  if (typeof input.evidence.event_count !== "number" || input.evidence.event_count < 0) {
    throw new Error("buildL2RecoveryResult: evidence.event_count must be a non-negative number");
  }
  const skillPatchNeeded = input.classification === "skill_patch_needed";
  if (skillPatchNeeded && !input.skill_patch_proposal) {
    throw new Error(
      "buildL2RecoveryResult: classification=skill_patch_needed requires a skill_patch_proposal payload",
    );
  }
  if (!skillPatchNeeded && input.skill_patch_proposal) {
    throw new Error(
      "buildL2RecoveryResult: skill_patch_proposal is only allowed with classification=skill_patch_needed",
    );
  }
  return {
    run_id: input.run_id,
    started_at: input.started_at,
    finished_at: input.finished_at,
    provider: input.provider,
    classification: input.classification,
    safe_next_action: safeNextActionFor(input.classification),
    skill_patch_needed: skillPatchNeeded,
    ...(input.skill_patch_proposal
      ? { skill_patch_proposal: input.skill_patch_proposal }
      : {}),
    evidence: input.evidence,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/**
 * Predicates the cockpit / scorecard uses to count outcomes against the
 * Stage 0B success thresholds documented in
 * docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md.
 */
export function isHardStopOutcome(classification: L2RecoveryClass): boolean {
  return (
    classification === "user_seat_selection_required" ||
    classification === "account_session_required" ||
    classification === "payment_or_final_action_required"
  );
}

export function isSafeOutcome(classification: L2RecoveryClass): boolean {
  return (
    classification === "exact_event_ready" ||
    classification === "single_candidate_ready" ||
    classification === "provider_listing_needs_choice" ||
    classification === "safe_handoff_reached" ||
    isHardStopOutcome(classification)
  );
}

/**
 * Hard-stop reasons the runner MUST treat as boundary. Pinned for the
 * test runner and the cockpit summary.
 */
export const STAGE0B_HARD_STOPS: ReadonlyArray<LabHardStopReason> = Object.freeze([
  "login_or_signin_wall",
  "captcha_or_challenge",
  "otp_or_phone_verification",
  "seat_selection_required",
  "payment_form_visible",
  "final_confirm_button",
  "cookie_consent_blocking_render",
  "harness_error_or_disconnect",
]);
