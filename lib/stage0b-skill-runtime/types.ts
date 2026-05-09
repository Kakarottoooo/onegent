/**
 * Stage 0B Activity Provider Skill Runtime — pure no-live types.
 *
 * Mirrors the contract documented in:
 *   docs/30-provider-debug/STAGE0B_TM_SEATGEEK_LAB.md
 *
 * These types describe the JSONL evidence format the controlled Browser
 * Harness lab writes, plus the L2RecoveryResult shape Onegent uses to
 * classify a lab run's outcome. They are PURE TypeScript and have no
 * dependency on Browser Harness, Playwright, Stagehand, or Computer Use.
 *
 * Browser Harness is NOT vendored into Onegent and NOT imported here.
 * The lab runner shells out to the external CLI in dev mode and writes
 * JSONL events that conform to this contract; downstream test/cockpit
 * code consumes the JSONL without ever launching a browser.
 */

import type {
  ActivitySkillExecutionMode,
  ActivitySkillPageType,
  ActivitySkillProvider,
} from "@/lib/activity-skills";

// ─── Provider scope ─────────────────────────────────────────────────────
//
// Stage 0B lab started with Ticketmaster + SeatGeek and now includes StubHub
// as the first copyability check for the Activity Provider Skill Runtime.
// Eventbrite / AXS stay no-live corpus work until their controlled lab starts.

export type Stage0bLabProvider = Extract<
  ActivitySkillProvider,
  "ticketmaster" | "seatgeek" | "stubhub"
>;

export const STAGE0B_LAB_PROVIDERS: ReadonlyArray<Stage0bLabProvider> =
  Object.freeze(["ticketmaster", "seatgeek", "stubhub"]);

// ─── Lab event JSONL schema ─────────────────────────────────────────────
//
// One JSONL line per significant action the lab runner observes. The
// runner writes these to a per-run file under .stage0b-evidence/ which is
// .gitignored at the repo root. JSONL keeps each line independently
// parseable so a partial / interrupted run still produces useful evidence.
//
// Required fields are non-nullable. Optional fields are absent (not null)
// when the harness did not capture that signal.

export type LabAction =
  /** Initial navigation to the input URL. */
  | "navigate"
  /** Captured a screenshot at the current page state. */
  | "screenshot"
  /** Read DOM text / attributes (no click / type). */
  | "inspect"
  /** Followed a same-origin link the harness identified as safe. */
  | "follow_safe_link"
  /** Scrolled to load lazy content (no click). */
  | "scroll"
  /** Refused to act past a hard stop boundary. */
  | "halt_at_hard_stop"
  /** Lab runner finished and wrote the L2RecoveryResult. */
  | "complete";

export type LabHardStopReason =
  | "login_or_signin_wall"
  | "captcha_or_challenge"
  | "otp_or_phone_verification"
  | "seat_selection_required"
  | "payment_form_visible"
  | "final_confirm_button"
  | "cookie_consent_blocking_render"
  | "harness_error_or_disconnect";

/**
 * Visible facts the lab observed on the page. Each field is OPTIONAL —
 * the harness only fills what it can read from the DOM/text. Any field
 * absent here means "not observed", NOT "absent on the page". Downstream
 * code MUST treat absence as inconclusive.
 */
export interface LabVisibleFacts {
  /** Visible event title or page H1, raw text. */
  title?: string;
  /** Visible artist / performer / grouping label when distinct from title. */
  performer?: string;
  /** First city / venue text the harness spotted. */
  city?: string;
  venue?: string;
  /** Visible date(s) the harness spotted. ISO when parseable, else raw. */
  visible_dates?: string[];
  /** Visible time(s). ISO when parseable, else raw. */
  visible_times?: string[];
  /** Number of upcoming-event rows / cards rendered on the page. */
  candidate_count?: number;
  /** Compact visible labels for candidate rows/cards, in page order. */
  candidate_labels?: string[];
  /** Provider links associated with visible candidate rows/cards, in page order. */
  candidate_links?: string[];
  /** Visible price band when it appears as a hint, e.g. "$45 - $250". */
  visible_price_band?: string;
  /** Free-form notes the harness emits ("seat map iframe present"). */
  notes?: string[];
}

export type LabOutcome =
  /** The action ran cleanly and there is nothing to flag at this step. */
  | "ok"
  /** The action ran but something blocked progress (e.g. hidden content). */
  | "degraded"
  /** The action did not run because a hard stop fired. */
  | "halted"
  /** The runner encountered an error and stopped without halting on policy. */
  | "error";

export interface LabEvent {
  /** ISO timestamp at the moment the harness emitted the event. */
  timestamp: string;
  /** Stable run id (UUID) so events from one run group together. */
  run_id: string;
  /** Sequential index inside the run, starting at 1. */
  seq: number;
  /** Provider scope. Always "ticketmaster" or "seatgeek" in Stage 0B. */
  provider: Stage0bLabProvider;
  /** Page type as classified by the URL resolver at navigation time. */
  page_type: ActivitySkillPageType;
  /** Action being recorded by this event. */
  action: LabAction;
  /** Current URL the harness observed at action time. May differ from input URL after navigation. */
  currentUrl: string;
  /** Optional path under .stage0b-evidence/<run_id>/ for the screenshot from this event. */
  screenshotPath?: string;
  /** Visible facts the harness read at this step. */
  visible_facts?: LabVisibleFacts;
  /** Outcome of this single action. */
  outcome: LabOutcome;
  /** When `action === "halt_at_hard_stop"`, the reason is required. */
  hardStop?: LabHardStopReason;
  /** Free-form notes the harness emits. */
  notes?: string;
}

// ─── L2RecoveryResult — final-state schema ───────────────────────────────
//
// Emitted exactly once per lab run as the final JSON object alongside the
// JSONL event stream. This is the per-run summary the cockpit and patch
// proposal flow consume. It reuses the runtime-classification vocabulary
// from `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md`.

export type L2RecoveryClass =
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

export type L2SafeNextAction =
  /** Onegent can pass the URL to the existing L1 provider runtime. */
  | "start_task"
  /** Onegent should ask the user to pick from N candidates the harness saw. */
  | "ask_user_choice"
  /** Onegent should pause for the user to handle a hard-stop boundary. */
  | "user_handoff_required"
  /** Onegent should hold the capture for review and not run anything. */
  | "review_capture"
  /** A patch proposal exists and needs review before further runs. */
  | "review_patch_proposal";

export interface L2EvidenceBundle {
  /** Inputs */
  input_url: string;
  /** Final URL after navigation. May equal input_url for static pages. */
  final_url: string;
  /** Final page type as classified by the URL resolver against final_url. */
  final_page_type: ActivitySkillPageType;
  /** Per-event JSONL log path (relative to repo root, under .stage0b-evidence/). */
  jsonl_path: string;
  /** Number of LabEvent records the runner wrote. */
  event_count: number;
  /** Screenshot paths the runner captured, in order. */
  screenshot_paths: string[];
  /** Visible facts merged across the run (last-write-wins). */
  visible_facts: LabVisibleFacts;
  /** Hard stops that fired during the run, in order. */
  hard_stops: LabHardStopReason[];
}

export interface L2RecoveryResult {
  /** Stable run id, same as LabEvent.run_id. */
  run_id: string;
  /** ISO timestamp when the run started. */
  started_at: string;
  /** ISO timestamp when the run finished. */
  finished_at: string;
  /** Provider scope. */
  provider: Stage0bLabProvider;
  /** L2 outcome classification. */
  classification: L2RecoveryClass;
  /** What Onegent should do with this run's URL. */
  safe_next_action: L2SafeNextAction;
  /**
   * True iff the harness saw a structural change that should become a
   * reviewed patch (e.g. selector drift, DOM rename, new page flow).
   * When true, skill_patch_proposal MUST be set.
   */
  skill_patch_needed: boolean;
  /** Patch proposal payload when skill_patch_needed === true. */
  skill_patch_proposal?: SkillPatchProposal;
  /** Evidence bundle. Always present; downstream code asserts on it. */
  evidence: L2EvidenceBundle;
  /** Free-form operator notes (e.g. "harness CLI v1.2.3"). */
  notes?: string;
}

/**
 * Patch proposal — captures what the harness saw and what Onegent should
 * change in a *future*, code-reviewed PR. Intentionally narrow: this is a
 * proposal, not an automatic edit. The patch_target is a string referring
 * to a file path Onegent owns; the harness must NOT touch it.
 */
export type SkillPatchKind =
  | "selector_drift"
  | "page_flow_change"
  | "new_page_type"
  | "missing_filter"
  | "stricter_safe_handoff"
  | "host_pattern_extension";

export interface SkillPatchProposal {
  kind: SkillPatchKind;
  /** Short title shown in the cockpit / patch review queue. */
  title: string;
  /** What the harness observed that motivated the proposal. */
  observed_evidence: string;
  /** Onegent file path the proposal would touch (informational only). */
  patch_target: string;
  /** What the suggested change would do. Plain English. */
  proposed_change: string;
  /** Risk class — controls whether the proposal can land without dogfood. */
  risk: "low" | "medium" | "high";
  /** Cross-references to LabEvent.seq values that motivate the proposal. */
  evidence_event_seqs: number[];
}

// ─── Lab test plan entry ────────────────────────────────────────────────
//
// Each entry in the 20-URL plan is a single fixture: input URL plus the
// expected resolver classification (so a no-live test can assert the
// resolver agrees with the plan author *before* any harness run starts).

export interface LabTestPlanEntry {
  /** Stable id used in evidence paths and reports, e.g. "tm-01". */
  id: string;
  provider: Stage0bLabProvider;
  /** Class the URL author intended ("artist", "exact event", "listing", "dated event", etc.). */
  intended_class:
    | "ticketmaster_event"
    | "ticketmaster_artist"
    | "ticketmaster_search"
    | "ticketmaster_listing"
    | "seatgeek_dated_event"
    | "seatgeek_listing"
    | "stubhub_event"
    | "stubhub_performer"
    | "stubhub_category"
    | "stubhub_geography"
    | "stubhub_checkout";
  url: string;
  expected_resolver_page_type: ActivitySkillPageType;
  expected_resolver_execution_mode: ActivitySkillExecutionMode;
  /** Reason this fixture exists — what the run should reveal. */
  reason: string;
}

export type Stage0bLabPlanName = "stage0b" | "ticketmaster-forge" | "stubhub-forge";
