/**
 * Mutable-task types (Phase 1).
 *
 * constraints = the canonical task definition (what to book).
 * policy      = the fallback / approval rules the agent may apply.
 *
 * These live alongside booking_jobs.steps[].body for now (per the dual-write
 * decision in CLAUDE.md / Phase 1 design notes). When applyJobModification
 * mutates constraints, it ALSO mirrors the change into step.body so the
 * existing executor (which reads step.body) picks up new values without any
 * executor-side change. Long-term we can collapse onto constraints alone.
 */

export interface RestaurantConstraints {
  task_type: "restaurant_booking";
  city: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  time: string;
  party_size: number;
  restaurant_name: string;
  occasion?: string;
  /** Free-form preferences passed through to the agent. */
  preferences?: Record<string, unknown>;
}

// Placeholders for other task types — keep the discriminated union open so
// later phases can add HotelConstraints / FlightConstraints without breaking
// existing consumers.
export interface HotelConstraintsPlaceholder {
  task_type: "hotel_booking";
  [key: string]: unknown;
}

export interface FlightConstraintsPlaceholder {
  task_type: "flight_booking";
  [key: string]: unknown;
}

export interface ActivityConstraintsPlaceholder {
  task_type: "activity_booking";
  [key: string]: unknown;
}

export type JobConstraints =
  | RestaurantConstraints
  | HotelConstraintsPlaceholder
  | FlightConstraintsPlaceholder
  | ActivityConstraintsPlaceholder;

export interface JobPolicy {
  /** Max minutes the agent may shift the time when the requested slot is full. */
  time_window_minutes?: 0 | 30 | 60 | 90;
  /** Restaurant: try a backup venue if the primary fails. */
  allow_venue_switch?: boolean;
  /** Try a different platform (Resy ↔ OpenTable ↔ official site) on failure. */
  allow_platform_switch?: boolean;
  /** Hotel/flight: max % the agent may exceed the user's stated budget. */
  allow_budget_increase_percent?: number;
  /** Pause for explicit user OK before clicking the booking-commit button. */
  require_user_approval_before_booking?: boolean;
  /** Pause for explicit user OK before entering payment details. */
  require_user_approval_before_payment?: boolean;
}

// ─── Patch shape — what the modify API accepts ──────────────────────────────

export interface JobModificationPatch {
  /** Partial constraints — only listed keys overwrite. */
  constraints?: Record<string, unknown>;
  /** Partial policy — only listed keys overwrite. */
  policy?: Partial<JobPolicy>;
  /** Optional human-readable note for the audit log. */
  message?: string;
}

// ─── Default policy when a legacy job hasn't got one yet ────────────────────

export const DEFAULT_JOB_POLICY: JobPolicy = {
  time_window_minutes: 60,
  allow_venue_switch: false,
  allow_platform_switch: false,
  allow_budget_increase_percent: 0,
  require_user_approval_before_booking: false,
  require_user_approval_before_payment: true,
};
