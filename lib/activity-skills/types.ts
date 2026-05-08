export type ActivitySkillProvider =
  | "ticketmaster"
  | "seatgeek"
  | "stubhub"
  | "eventbrite"
  | "axs";

export type ActivitySkillResolvedProvider = ActivitySkillProvider | "unknown";

export type ActivitySkillPageType =
  | "exact_event"
  | "artist_or_performer"
  | "listing"
  | "grouping"
  | "search_results"
  | "unknown_provider_page";

export type ActivitySkillExecutionMode =
  | "direct_execution"
  | "provider_start"
  | "review_capture";

export type ActivitySkillSafeNextAction =
  | "start_task"
  | "ask_user_to_choose"
  | "review_capture"
  | "stop_for_user_boundary";

export type ActivitySkillOutcome =
  | "exact_event_ready"
  | "provider_listing_needs_choice"
  | "single_candidate_ready"
  | "safe_handoff_reached"
  | "user_seat_selection_required"
  | "account_session_required"
  | "payment_or_final_action_required"
  | "provider_degraded"
  | "insufficient_evidence"
  | "skill_patch_needed";

export type ActivitySkillHardStop =
  | "seat_selection"
  | "login"
  | "account_verification"
  | "captcha"
  | "otp"
  | "payment"
  | "final_purchase"
  | "final_confirmation";

export interface ActivitySkillEvidenceContract {
  requiredSources: string[];
  minimumForLabRun: string[];
}

export interface ActivitySkillUrlMatch {
  provider: ActivitySkillResolvedProvider;
  pageType: ActivitySkillPageType;
  inputUrl: string;
  normalizedUrl: string;
  host: string;
  providerPageId?: string;
  titleHint?: string;
  confidence: number;
  executionMode: ActivitySkillExecutionMode;
  needsUserChoice: boolean;
  safeNextAction: ActivitySkillSafeNextAction;
  evidence: {
    source: "url_pattern";
    matchedPattern: string;
    titleSource?: "slug";
  };
}

export interface ActivityProviderSkill {
  provider: ActivitySkillProvider;
  pageTypes: ActivitySkillPageType[];
  requiredInputs: string[];
  safeActions: string[];
  hardStops: ActivitySkillHardStop[];
  evidenceContract: ActivitySkillEvidenceContract;
  canHandleUrl(url: unknown): ActivitySkillUrlMatch | null;
}
