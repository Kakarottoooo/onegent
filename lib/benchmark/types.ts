/**
 * Benchmark types — shared between case definitions, runner, store, and API.
 *
 * The benchmark layer measures real-world success/failure of Onegent's
 * automated booking flow against fixed, version-controlled test cases.
 * It is internal-only (gated by INTERNAL_ANALYTICS_USER_IDS) and never
 * exposed to end users.
 */

// ─── Failure taxonomy ───────────────────────────────────────────────────────
// Every failed run gets exactly one reason from this list. Adding a new
// reason means every analyser knows about it — keep this canonical.

export const FAILURE_REASONS = [
  "no_availability",
  "dom_drift",
  "captcha_or_bot_detection",
  "login_required",
  "payment_stop",
  "provider_timeout",
  "stagehand_misread",
  "wrong_date_selected",
  "wrong_time_selected",
  "wrong_party_size_selected",
  "fallback_failed",
  "human_handoff_required",
  "executor_error",
  "dry_run_blocked", // benchmark stopped at dry_run boundary — not a real failure
  "unknown_error",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

// ─── Run-level status ───────────────────────────────────────────────────────

export type BenchmarkRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "cancelled"
  | "errored";

// ─── Case-level status ──────────────────────────────────────────────────────
// Mirrors the lifecycle of a single case attempt.

export type BenchmarkCaseStatus =
  | "pending"           // case row created, runner has not picked it up yet
  | "running"           // booking job created and being executed
  | "succeeded"         // automation completed fully (or dry_run boundary hit safely)
  | "failed"            // automation failed; failure_reason populated
  | "skipped"           // explicit skip (e.g. dry_run mode required but unavailable)
  | "timed_out";        // exceeded max wall-clock budget

// ─── Mode ───────────────────────────────────────────────────────────────────
// dry_run = stop before final confirm click; produces zero real reservations.
// full_commit = run to completion; only use with dedicated test accounts.

export type BenchmarkMode = "dry_run" | "full_commit";

// ─── Case definition (TS source of truth, lives in restaurant-cases.ts) ─────

export interface RestaurantBenchmarkCase {
  /** Stable human-readable id, e.g. "nyc_restaurant_001". */
  case_id: string;
  city: string;
  /** Restaurant brand/name as the user would type it. */
  restaurant_name: string;
  /** Direct booking page if known — speeds up provider routing. */
  restaurant_url?: string;
  /** Provider hint; runner still verifies via existing routing. */
  expected_provider: "OpenTable" | "Resy" | "official_website";
  /** Reservation date in YYYY-MM-DD. Use a date >= today's date. */
  date: string;
  /** Reservation time in HH:MM (24h). */
  time: string;
  party_size: number;
  occasion?: string;
  /** Soft constraints / preferences that the agent may consult. */
  preferences?: Record<string, unknown>;
  /** Per-case fallback policy (overrides run-wide defaults). */
  fallback_policy?: {
    time_window_minutes?: number;
    allow_platform_switch?: boolean;
    allow_venue_switch?: boolean;
    require_user_approval_before_booking?: boolean;
  };
  /** Free-form notes about why this case exists (date-night vs solo etc). */
  notes?: string;
}

// ─── Run / case rows persisted to DB ────────────────────────────────────────
// These mirror the SQL columns 1:1.

export interface BenchmarkRunRow {
  id: string;
  name: string;
  city: string;
  scenario: string; // e.g. "restaurant_booking"
  mode: BenchmarkMode;
  total_cases: number;
  success_cases: number;
  status: BenchmarkRunStatus;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BenchmarkCaseRow {
  id: string;
  run_id: string;
  case_id: string;
  task_payload: RestaurantBenchmarkCase;
  mode: BenchmarkMode;
  /** Set once the runner creates a booking_job for this case. */
  booking_job_id: string | null;
  provider: string | null;
  executor: string | null;
  status: BenchmarkCaseStatus;
  success: boolean;
  failure_reason: FailureReason | null;
  fallback_attempted: boolean;
  fallback_success: boolean;
  payment_stop_triggered: boolean;
  human_handoff_required: boolean;
  duration_seconds: number | null;
  audit: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

// ─── Run summary (cheap aggregate view) ─────────────────────────────────────

export interface BenchmarkRunSummary {
  run_id: string;
  total: number;
  by_status: Record<BenchmarkCaseStatus, number>;
  by_failure_reason: Partial<Record<FailureReason, number>>;
  success_rate: number;
  avg_duration_seconds: number | null;
}
