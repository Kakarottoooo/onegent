import { sql, db } from "@vercel/postgres";
import { encrypt, decrypt } from "./encryption";

export { sql };

let scenarioEventsTableReady: Promise<void> | null = null;
let decisionPlansTableReady: Promise<void> | null = null;
let planOutcomesTableReady: Promise<void> | null = null;
let feedbackPromptsTableReady: Promise<void> | null = null;
let planVotesTableReady: Promise<void> | null = null;
let priceWatchesTableReady: Promise<void> | null = null;
let userPreferencesTableReady: Promise<void> | null = null;
let userNotificationsTableReady: Promise<void> | null = null;

// ── Decision Rooms v2 (multi-party Phase 1) ────────────────────────────────
let decisionRoomsTableReady: Promise<void> | null = null;
let decisionRoomMembersTableReady: Promise<void> | null = null;
let decisionRoomConstraintsTableReady: Promise<void> | null = null;
let decisionRoomProposalsTableReady: Promise<void> | null = null;
let decisionRoomVotesTableReady: Promise<void> | null = null;
let decisionRoomMessagesTableReady: Promise<void> | null = null;
// ── Decision Rooms v2 Stage 2 (chat-flow trip rooms) ───────────────────────
let roomMemberIntentStateTableReady: Promise<void> | null = null;
let decisionRoomPrivateMessagesTableReady: Promise<void> | null = null;

// ── Contacts / user profiles (Phase 1.5, layer 2) ──────────────────────────
let userProfilesTableReady: Promise<void> | null = null;
let userContactsTableReady: Promise<void> | null = null;
let contactRequestsTableReady: Promise<void> | null = null;
let contactBlocksTableReady: Promise<void> | null = null;
let userContactsBackfillRan: Promise<void> | null = null;

// ── Groups (Phase 2, layer 3 — named reusable sets of contacts) ────────────
let userGroupsTableReady: Promise<void> | null = null;
let userGroupMembersTableReady: Promise<void> | null = null;

/**
 * Initialize the database tables if they don't exist.
 * Call once on first deploy or via a setup script.
 */
export async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS preference_profiles (
      user_id       TEXT PRIMARY KEY,
      profile_json  JSONB NOT NULL,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS favorites (
      id            SERIAL PRIMARY KEY,
      user_id       TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      card_json     JSONB NOT NULL,
      saved_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, restaurant_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id              SERIAL PRIMARY KEY,
      user_id         TEXT NOT NULL,
      restaurant_id   TEXT NOT NULL,
      restaurant_name TEXT NOT NULL,
      query           TEXT,
      satisfied       BOOLEAN NOT NULL,
      issues          TEXT[],
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await ensureScenarioEventsTable();
  await ensureDecisionPlansTable();
  await ensurePlanOutcomesTable();
  await ensureFeedbackPromptsTable();
  await ensurePlanVotesTable();
  await ensurePriceWatchesTable();
  await ensureUserPreferencesTable();
  await ensureUserNotificationsTable();
  await ensureBookingProfilesTable();
}

export async function ensureScenarioEventsTable() {
  if (!scenarioEventsTableReady) {
    scenarioEventsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS scenario_events (
          id            SERIAL PRIMARY KEY,
          user_id       TEXT,
          session_id    TEXT NOT NULL,
          scenario      TEXT NOT NULL,
          plan_id       TEXT NOT NULL,
          event_type    TEXT NOT NULL,
          option_id     TEXT,
          action_id     TEXT,
          request_id    TEXT,
          query_text    TEXT,
          metadata_json JSONB,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `;
    })().catch((err) => {
      scenarioEventsTableReady = null;
      throw err;
    });
  }

  await scenarioEventsTableReady;
}

export async function ensureDecisionPlansTable() {
  if (!decisionPlansTableReady) {
    decisionPlansTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_plans (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          user_id     TEXT,
          scenario    TEXT NOT NULL,
          query_text  TEXT,
          plan_json   JSONB NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_plans_session_idx ON decision_plans (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS decision_plans_user_idx ON decision_plans (user_id) WHERE user_id IS NOT NULL`;
      // Migration: add parent_plan_id for refinement lineage tracking
      await sql`ALTER TABLE decision_plans ADD COLUMN IF NOT EXISTS parent_plan_id TEXT`;
    })().catch((err) => {
      decisionPlansTableReady = null;
      throw err;
    });
  }

  await decisionPlansTableReady;
}

export async function ensurePlanOutcomesTable() {
  if (!planOutcomesTableReady) {
    planOutcomesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS plan_outcomes (
          id            BIGSERIAL PRIMARY KEY,
          plan_id       TEXT NOT NULL,
          session_id    TEXT,
          user_id       TEXT,
          outcome_type  TEXT NOT NULL,
          option_id     TEXT,
          metadata      JSONB,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS plan_outcomes_plan_idx ON plan_outcomes (plan_id)`;
    })().catch((err) => {
      planOutcomesTableReady = null;
      throw err;
    });
  }

  await planOutcomesTableReady;
}

export async function ensureFeedbackPromptsTable() {
  if (!feedbackPromptsTableReady) {
    feedbackPromptsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS feedback_prompts (
          id            BIGSERIAL PRIMARY KEY,
          plan_id       TEXT NOT NULL,
          user_session  TEXT NOT NULL,
          scheduled_for TIMESTAMPTZ NOT NULL,
          sent_at       TIMESTAMPTZ,
          responded_at  TIMESTAMPTZ,
          response_json JSONB,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS feedback_prompts_plan_idx ON feedback_prompts (plan_id)`;
      await sql`CREATE INDEX IF NOT EXISTS feedback_prompts_session_idx ON feedback_prompts (user_session)`;
      // Prevent duplicate prompts from concurrent cron runs
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS feedback_prompts_plan_unique_idx ON feedback_prompts (plan_id)`;
    })().catch((err) => {
      feedbackPromptsTableReady = null;
      throw err;
    });
  }

  await feedbackPromptsTableReady;
}

export async function ensurePlanVotesTable() {
  if (!planVotesTableReady) {
    planVotesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS plan_votes (
          id            BIGSERIAL PRIMARY KEY,
          plan_id       TEXT NOT NULL,
          voter_session TEXT NOT NULL,
          option_id     TEXT NOT NULL,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS plan_votes_plan_idx ON plan_votes (plan_id)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS plan_votes_voter_idx ON plan_votes (plan_id, voter_session)`;
    })().catch((err) => {
      planVotesTableReady = null;
      throw err;
    });
  }
  await planVotesTableReady;
}

export async function ensurePriceWatchesTable() {
  if (!priceWatchesTableReady) {
    priceWatchesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS price_watches (
          id                BIGSERIAL PRIMARY KEY,
          plan_id           TEXT NOT NULL,
          session_id        TEXT NOT NULL,
          item_type         TEXT NOT NULL,
          item_key          TEXT NOT NULL,
          item_label        TEXT NOT NULL,
          last_known_price  NUMERIC(10,2) NOT NULL,
          threshold_pct     NUMERIC(5,2) NOT NULL DEFAULT 10,
          search_params     JSONB,
          created_at        TIMESTAMPTZ DEFAULT NOW(),
          last_checked_at   TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS price_watches_plan_idx ON price_watches (plan_id)`;
      await sql`CREATE INDEX IF NOT EXISTS price_watches_session_idx ON price_watches (session_id)`;
    })().catch((err) => {
      priceWatchesTableReady = null;
      throw err;
    });
  }
  await priceWatchesTableReady;
}

export async function ensureUserPreferencesTable() {
  if (!userPreferencesTableReady) {
    userPreferencesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id               BIGSERIAL PRIMARY KEY,
          session_id       TEXT NOT NULL,
          preference_key   TEXT NOT NULL,
          preference_value TEXT NOT NULL,
          confidence       FLOAT DEFAULT 1.0,
          updated_at       TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (session_id, preference_key)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_prefs_session_idx ON user_preferences (session_id)`;
      // 4b-2 migrations: user_id column + per-user unique index
      await sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS user_id TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS user_prefs_user_idx ON user_preferences (user_id) WHERE user_id IS NOT NULL`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS user_prefs_user_key_idx ON user_preferences (user_id, preference_key) WHERE user_id IS NOT NULL`;
    })().catch((err) => {
      userPreferencesTableReady = null;
      throw err;
    });
  }
  await userPreferencesTableReady;
}

export async function upsertUserPreference(
  sessionId: string,
  key: string,
  value: string,
  confidence = 1.0,
  userId?: string
): Promise<void> {
  await ensureUserPreferencesTable();
  if (userId) {
    await sql`
      INSERT INTO user_preferences (session_id, user_id, preference_key, preference_value, confidence, updated_at)
      VALUES (${sessionId}, ${userId}, ${key}, ${value}, ${confidence}, NOW())
      ON CONFLICT (user_id, preference_key) WHERE user_id IS NOT NULL
      DO UPDATE SET preference_value = EXCLUDED.preference_value,
                    confidence = EXCLUDED.confidence,
                    session_id = EXCLUDED.session_id,
                    updated_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO user_preferences (session_id, preference_key, preference_value, confidence, updated_at)
      VALUES (${sessionId}, ${key}, ${value}, ${confidence}, NOW())
      ON CONFLICT (session_id, preference_key)
      DO UPDATE SET preference_value = EXCLUDED.preference_value,
                    confidence = EXCLUDED.confidence,
                    updated_at = NOW()
    `;
  }
}

export async function getUserPreferences(
  sessionId: string,
  userId?: string
): Promise<Record<string, string>> {
  await ensureUserPreferencesTable();
  const result = userId
    ? await sql<{ preference_key: string; preference_value: string }>`
        SELECT preference_key, preference_value
        FROM user_preferences
        WHERE user_id = ${userId}
      `
    : await sql<{ preference_key: string; preference_value: string }>`
        SELECT preference_key, preference_value
        FROM user_preferences
        WHERE session_id = ${sessionId}
      `;
  const prefs: Record<string, string> = {};
  for (const row of result.rows) {
    prefs[row.preference_key] = row.preference_value;
  }
  return prefs;
}

export interface PushSubscriptionRecord {
  id: number;
  session_id: string;
  user_id: string | null;
  push_endpoint: string;
  push_subscription: object;
}

export async function ensureUserNotificationsTable() {
  if (!userNotificationsTableReady) {
    userNotificationsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_notifications (
          id                  BIGSERIAL PRIMARY KEY,
          session_id          TEXT NOT NULL,
          user_id             TEXT,
          push_endpoint       TEXT NOT NULL,
          push_subscription   JSONB NOT NULL,
          notification_email  TEXT,
          created_at          TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (push_endpoint)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_notifs_session_idx ON user_notifications (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS user_notifs_user_idx ON user_notifications (user_id) WHERE user_id IS NOT NULL`;
    })().catch((err) => {
      userNotificationsTableReady = null;
      throw err;
    });
  }
  await userNotificationsTableReady;
}

export async function upsertPushSubscription(
  sessionId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userId?: string
): Promise<void> {
  await ensureUserNotificationsTable();
  await sql`
    INSERT INTO user_notifications (session_id, user_id, push_endpoint, push_subscription)
    VALUES (${sessionId}, ${userId ?? null}, ${subscription.endpoint}, ${JSON.stringify(subscription)})
    ON CONFLICT (push_endpoint)
    DO UPDATE SET
      session_id = EXCLUDED.session_id,
      user_id = COALESCE(EXCLUDED.user_id, user_notifications.user_id),
      push_subscription = EXCLUDED.push_subscription
  `;
}

export async function getPushSubscriptionsBySession(
  sessionId: string
): Promise<PushSubscriptionRecord[]> {
  await ensureUserNotificationsTable();
  const result = await sql<PushSubscriptionRecord>`
    SELECT id, session_id, user_id, push_endpoint, push_subscription
    FROM user_notifications
    WHERE session_id = ${sessionId}
  `;
  return result.rows;
}

export async function getAllPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  await ensureUserNotificationsTable();
  const result = await sql<PushSubscriptionRecord>`
    SELECT id, session_id, user_id, push_endpoint, push_subscription
    FROM user_notifications
    ORDER BY created_at DESC
  `;
  return result.rows;
}

// ─── Phase 4 (Decision Room): Shared Decision Sessions ───────────────────────

let decisionSessionsTableReady: Promise<void> | null = null;

export async function ensureDecisionSessionsTable(): Promise<void> {
  if (!decisionSessionsTableReady) {
    decisionSessionsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_sessions (
          id                      TEXT PRIMARY KEY,
          initiator_user_id       TEXT,
          initiator_session_token TEXT NOT NULL,
          partner_session_token   TEXT NOT NULL,
          initiator_constraints   TEXT NOT NULL,
          partner_constraints   TEXT,
          conflict              BOOLEAN NOT NULL DEFAULT FALSE,
          conflict_reason       TEXT,
          merged_options        JSONB,
          initiator_vote        JSONB NOT NULL DEFAULT '[]',
          partner_vote          JSONB NOT NULL DEFAULT '[]',
          status                TEXT NOT NULL DEFAULT 'waiting_partner',
          decided_card_id       TEXT,
          feedback_initiator    TEXT,
          feedback_partner      TEXT,
          party_size            INT NOT NULL DEFAULT 2,
          decision_type         TEXT NOT NULL DEFAULT 'dinner_tonight',
          city_id               TEXT NOT NULL DEFAULT 'losangeles',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          expires_at            TIMESTAMPTZ NOT NULL,
          deleted_at            TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_sessions_initiator_idx ON decision_sessions (initiator_user_id) WHERE initiator_user_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS decision_sessions_expires_idx ON decision_sessions (expires_at)`;
    })().catch((err) => {
      decisionSessionsTableReady = null;
      throw err;
    });
  }
  await decisionSessionsTableReady;
}

export interface DecisionSession {
  id: string;
  initiator_user_id: string | null;
  initiator_session_token: string;
  partner_session_token: string;
  initiator_constraints: string;
  partner_constraints: string | null;
  conflict: boolean;
  conflict_reason: string | null;
  merged_options: unknown[] | null;
  initiator_vote: { card_id: string; approved: boolean }[];
  partner_vote: { card_id: string; approved: boolean }[];
  status: "waiting_partner" | "voting" | "decided" | "conflict" | "expired";
  decided_card_id: string | null;
  feedback_initiator: "loved" | "fine" | "never" | null;
  feedback_partner: "loved" | "fine" | "never" | null;
  party_size: number;
  decision_type: string;
  city_id: string;
  created_at: string;
  expires_at: string;
  deleted_at: string | null;
}

export async function createDecisionSession(params: {
  id: string;
  initiatorUserId: string | null;
  initiatorSessionToken: string;
  partnerSessionToken: string;
  initiatorConstraints: string;
  cityId: string;
  decisionType?: string;
}): Promise<DecisionSession> {
  await ensureDecisionSessionsTable();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const result = await sql<DecisionSession>`
    INSERT INTO decision_sessions
      (id, initiator_user_id, initiator_session_token, partner_session_token, initiator_constraints, city_id, decision_type, expires_at)
    VALUES
      (${params.id}, ${params.initiatorUserId}, ${params.initiatorSessionToken}, ${params.partnerSessionToken},
       ${params.initiatorConstraints}, ${params.cityId}, ${params.decisionType ?? "dinner_tonight"}, ${expiresAt})
    RETURNING *
  `;
  return result.rows[0];
}

export async function getDecisionSession(id: string): Promise<DecisionSession | null> {
  await ensureDecisionSessionsTable();
  const result = await sql<DecisionSession>`
    SELECT * FROM decision_sessions WHERE id = ${id} AND deleted_at IS NULL
  `;
  return result.rows[0] ?? null;
}

export async function updateDecisionSession(
  id: string,
  updates: Partial<{
    partner_constraints: string;
    conflict: boolean;
    conflict_reason: string;
    merged_options: unknown[];
    initiator_vote: { card_id: string; approved: boolean }[];
    partner_vote: { card_id: string; approved: boolean }[];
    status: string;
    decided_card_id: string;
    feedback_initiator: string;
    feedback_partner: string;
  }>
): Promise<DecisionSession | null> {
  await ensureDecisionSessionsTable();

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (updates.partner_constraints !== undefined) { setClauses.push(`partner_constraints = $${p++}`); values.push(updates.partner_constraints); }
  if (updates.conflict !== undefined) { setClauses.push(`conflict = $${p++}`); values.push(updates.conflict); }
  if (updates.conflict_reason !== undefined) { setClauses.push(`conflict_reason = $${p++}`); values.push(updates.conflict_reason); }
  if (updates.merged_options !== undefined) { setClauses.push(`merged_options = $${p++}`); values.push(JSON.stringify(updates.merged_options)); }
  if (updates.initiator_vote !== undefined) { setClauses.push(`initiator_vote = $${p++}`); values.push(JSON.stringify(updates.initiator_vote)); }
  if (updates.partner_vote !== undefined) { setClauses.push(`partner_vote = $${p++}`); values.push(JSON.stringify(updates.partner_vote)); }
  if (updates.status !== undefined) { setClauses.push(`status = $${p++}`); values.push(updates.status); }
  if (updates.decided_card_id !== undefined) { setClauses.push(`decided_card_id = $${p++}`); values.push(updates.decided_card_id); }
  if (updates.feedback_initiator !== undefined) { setClauses.push(`feedback_initiator = $${p++}`); values.push(updates.feedback_initiator); }
  if (updates.feedback_partner !== undefined) { setClauses.push(`feedback_partner = $${p++}`); values.push(updates.feedback_partner); }

  if (setClauses.length === 0) return getDecisionSession(id);

  values.push(id);
  const query = `UPDATE decision_sessions SET ${setClauses.join(", ")} WHERE id = $${p} AND deleted_at IS NULL RETURNING *`;
  const result = await db.query<DecisionSession>(query, values as string[]);
  return result.rows[0] ?? null;
}

// ─── G-4: Venue quality degradation tracking ──────────────────────────────────

let venueBaselinesTableReady: Promise<void> | null = null;

export async function ensureVenueBaselinesTable(): Promise<void> {
  if (!venueBaselinesTableReady) {
    venueBaselinesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS venue_baselines (
          id SERIAL PRIMARY KEY,
          plan_id TEXT NOT NULL,
          venue_id TEXT NOT NULL,
          venue_name TEXT NOT NULL,
          baseline_rating FLOAT NOT NULL,
          baseline_review_count INT NOT NULL,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS venue_baselines_plan_idx ON venue_baselines (plan_id)`;
    })().catch((err) => {
      venueBaselinesTableReady = null;
      throw err;
    });
  }
  await venueBaselinesTableReady;
}

export async function recordVenueBaseline(
  planId: string,
  venueId: string,
  venueName: string,
  rating: number,
  reviewCount: number
): Promise<void> {
  await ensureVenueBaselinesTable();
  await sql`
    INSERT INTO venue_baselines (plan_id, venue_id, venue_name, baseline_rating, baseline_review_count)
    VALUES (${planId}, ${venueId}, ${venueName}, ${rating}, ${reviewCount})
    ON CONFLICT DO NOTHING
  `;
}

/** On Clerk sign-in: copy all session-keyed prefs to the user account (idempotent). */
// ─── Booking Jobs (async autopilot execution) ─────────────────────────────────

let bookingJobsTableReady: Promise<void> | null = null;

export async function ensureBookingJobsTable(): Promise<void> {
  if (!bookingJobsTableReady) {
    bookingJobsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS booking_jobs (
          id                TEXT PRIMARY KEY,
          session_id        TEXT NOT NULL,
          user_id           TEXT,
          trip_label        TEXT NOT NULL,
          status            TEXT NOT NULL DEFAULT 'pending',
          steps             JSONB NOT NULL DEFAULT '[]',
          autonomy_settings JSONB,
          created_at        TIMESTAMPTZ DEFAULT NOW(),
          updated_at        TIMESTAMPTZ DEFAULT NOW(),
          completed_at      TIMESTAMPTZ
        )
      `;
      // Migrate existing tables that pre-date this column
      await sql`
        ALTER TABLE booking_jobs ADD COLUMN IF NOT EXISTS autonomy_settings JSONB
      `.catch(() => {});
      await sql`CREATE INDEX IF NOT EXISTS booking_jobs_session_idx ON booking_jobs (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS booking_jobs_user_idx ON booking_jobs (user_id) WHERE user_id IS NOT NULL`;
    })().catch((err) => {
      bookingJobsTableReady = null;
      throw err;
    });
  }
  await bookingJobsTableReady;
}

/** Alternative venue/provider to try when the primary fails. */
export interface FallbackCandidate {
  label: string;
  body: Record<string, unknown>;
  fallbackUrl: string;
}

/**
 * Manual action item generated when autopilot fails for a step.
 * Shown in My Trips so the user knows exactly what to do next.
 */
export interface StepActionItem {
  message: string;
  options: Array<{ label: string; url: string }>;
}

/**
 * One entry in the agent's decision log for a step.
 * Lets users see exactly what the agent tried on their behalf.
 */
export interface DecisionLogEntry {
  ts: string; // ISO timestamp
  type:
    | "info"           // diagnostic / informational
    | "attempt"        // tried primary or fallback
    | "retry"          // retrying after transient error
    | "time_adjusted"  // restaurant: trying a different time slot
    | "venue_switched" // hotel/restaurant: switching to backup venue
    | "succeeded"      // terminal success
    | "failed"         // terminal failure for this option
    | "skipped"        // no_availability — not retried
    | "scene_replan";  // cascaded change from another step's outcome
  message: string;     // human-readable, e.g. "Tried Le Bernardin at 7:00pm"
  outcome?: string;    // e.g. "No availability", "Network error", "Booked ✓"
}

export interface BookingJobStep {
  type: "flight" | "hotel" | "restaurant" | "activity" | "universal";
  emoji: string;
  label: string;
  apiEndpoint: string;
  body: Record<string, unknown>;
  fallbackUrl: string;
  /** Backup venues/hotels/restaurants tried if the primary fails */
  fallbackCandidates?: FallbackCandidate[];
  /**
   * For restaurants: alternate time slots to try (in "HH:MM" format) before
   * giving up and switching venues. E.g. ["19:30", "18:30", "20:00"].
   * The agent tries these automatically — no user input needed.
   */
  timeFallbacks?: string[];
  // ── Runtime fields (filled in as job runs) ──
  status: "pending" | "loading" | "done" | "error" | "no_availability" | "awaiting_confirmation";
  handoff_url?: string;
  /**
   * Browserbase live-view URL — present only in cloud (Browserbase) mode.
   * Opens an interactive cloud browser where the user can enter CVC / confirm.
   * Works on any device including mobile.
   */
  session_url?: string;
  selected_time?: string;
  error?: string;
  /** How many autopilot attempts were made (1 = succeeded first try) */
  attemptCount?: number;
  /** True when a fallback candidate succeeded instead of the primary */
  usedFallback?: boolean;
  /** True when a time fallback was used instead of the originally requested time */
  timeAdjusted?: boolean;
  /** Populated when all attempts + fallbacks fail — tells user what to do manually */
  actionItem?: StepActionItem;
  /** Full log of every decision the agent made for this step */
  decisionLog?: DecisionLogEntry[];
  /**
   * ISO timestamp — when this step should be automatically retried.
   * Set by the user via the "Retry later" UI. The cron job picks it up.
   */
  retryScheduledFor?: string;
  /** True when a scene-level replan automatically adjusted this step's parameters */
  replanAdjusted?: boolean;
  /** True when a scene replan flagged this step for user review */
  replanFlagged?: boolean;
}

export interface BookingJob {
  id: string;
  session_id: string;
  user_id: string | null;
  trip_label: string;
  status: "pending" | "running" | "done" | "failed";
  steps: BookingJobStep[];
  /** User-configured autonomy settings at the time this job was created. */
  autonomy_settings: import("./autonomy").AgentAutonomySettings | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createBookingJob(params: {
  id: string;
  sessionId: string;
  userId?: string | null;
  tripLabel: string;
  steps: BookingJobStep[];
  autonomySettings?: import("./autonomy").AgentAutonomySettings | null;
}): Promise<BookingJob> {
  await ensureBookingJobsTable();
  const stepsJson = JSON.stringify(params.steps);
  const autonomyJson = params.autonomySettings ? JSON.stringify(params.autonomySettings) : null;
  const result = await sql<BookingJob>`
    INSERT INTO booking_jobs (id, session_id, user_id, trip_label, status, steps, autonomy_settings)
    VALUES (${params.id}, ${params.sessionId}, ${params.userId ?? null}, ${params.tripLabel}, 'pending', ${stepsJson}::jsonb, ${autonomyJson}::jsonb)
    RETURNING *
  `;
  return result.rows[0];
}

export async function getBookingJob(id: string): Promise<BookingJob | null> {
  await ensureBookingJobsTable();
  const result = await sql<BookingJob>`
    SELECT * FROM booking_jobs WHERE id = ${id}
  `;
  return result.rows[0] ?? null;
}

export async function getBookingJobsBySession(sessionId: string, limit = 20): Promise<BookingJob[]> {
  await ensureBookingJobsTable();
  const result = await sql<BookingJob>`
    SELECT * FROM booking_jobs
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Jobs owned by a user regardless of session_id — recovers Decision Room
 * bookings whose session_id was a one-off random UUID.
 */
export async function getBookingJobsByUser(userId: string, limit = 20): Promise<BookingJob[]> {
  await ensureBookingJobsTable();
  const result = await sql<BookingJob>`
    SELECT * FROM booking_jobs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

export async function updateBookingJobStatus(
  id: string,
  status: BookingJob["status"],
  completedAt?: Date
): Promise<void> {
  await ensureBookingJobsTable();
  if (completedAt) {
    await sql`
      UPDATE booking_jobs
      SET status = ${status}, updated_at = NOW(), completed_at = ${completedAt.toISOString()}
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE booking_jobs
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
    `;
  }
}

/** Update a single step within a job (by index). */
export async function updateBookingJobStep(
  id: string,
  stepIndex: number,
  patch: Partial<BookingJobStep>
): Promise<void> {
  await ensureBookingJobsTable();
  // Read current steps, patch the target, write back
  const result = await sql<{ steps: string }>`
    SELECT steps FROM booking_jobs WHERE id = ${id}
  `;
  if (!result.rows[0]) return;
  const raw = result.rows[0].steps;
  const steps: BookingJobStep[] = typeof raw === "string" ? JSON.parse(raw) : raw as unknown as BookingJobStep[];
  if (stepIndex < 0 || stepIndex >= steps.length) return;
  steps[stepIndex] = { ...steps[stepIndex], ...patch };
  await sql`
    UPDATE booking_jobs
    SET steps = ${JSON.stringify(steps)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `;
}

/** Find jobs that have steps with retryScheduledFor in the past — ready to trigger. */
export async function getJobsWithPendingRetries(): Promise<BookingJob[]> {
  await ensureBookingJobsTable();
  const now = new Date().toISOString();
  // Find jobs where any step has retryScheduledFor set (we'll filter in JS)
  const result = await sql<BookingJob>`
    SELECT id, session_id, user_id, trip_label, status, steps,
           autonomy_settings, created_at, updated_at, completed_at
    FROM booking_jobs
    WHERE status IN ('pending','failed')
      AND steps::text LIKE '%retryScheduledFor%'
  `;
  // Filter to only those where at least one step's retryScheduledFor <= now
  return result.rows.filter((job) =>
    job.steps.some(
      (s) => s.retryScheduledFor && s.retryScheduledFor <= now
    )
  );
}

export async function updateBookingJobSteps(id: string, steps: BookingJobStep[]): Promise<void> {
  await ensureBookingJobsTable();
  const stepsJson = JSON.stringify(steps);
  await sql`
    UPDATE booking_jobs
    SET steps = ${stepsJson}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deleteBookingJob(id: string): Promise<void> {
  await ensureBookingJobsTable();
  await sql`DELETE FROM booking_jobs WHERE id = ${id}`;
}

export async function deleteAllBookingJobsBySession(sessionId: string): Promise<void> {
  await ensureBookingJobsTable();
  await sql`DELETE FROM booking_jobs WHERE session_id = ${sessionId}`;
}

// ─── Agent Logs ───────────────────────────────────────────────────────────────
// Persistent log of agent actions, errors, and notable events.
// Queryable via GET /api/agent-logs — can be read by Claude Code for debugging.

export interface AgentLog {
  id: number;
  session_id: string;
  job_id: string | null;
  level: "info" | "warn" | "error";
  source: string;       // e.g. "stagehand-executor", "universal-route", "start-route"
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

let agentLogsTableReady: Promise<void> | null = null;

async function ensureAgentLogsTable(): Promise<void> {
  if (!agentLogsTableReady) {
    agentLogsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_logs (
          id         BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL DEFAULT '',
          job_id     TEXT,
          level      TEXT NOT NULL DEFAULT 'info',
          source     TEXT NOT NULL DEFAULT 'unknown',
          message    TEXT NOT NULL,
          details    JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_logs_session_idx ON agent_logs (session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS agent_logs_job_idx ON agent_logs (job_id) WHERE job_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS agent_logs_level_idx ON agent_logs (level)`;
      await sql`CREATE INDEX IF NOT EXISTS agent_logs_created_idx ON agent_logs (created_at DESC)`;
    })().catch((err) => {
      agentLogsTableReady = null;
      throw err;
    });
  }
  await agentLogsTableReady;
}

export async function writeAgentLog(entry: Omit<AgentLog, "id" | "created_at">): Promise<void> {
  try {
    await ensureAgentLogsTable();
    const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
    await sql`
      INSERT INTO agent_logs (session_id, job_id, level, source, message, details)
      VALUES (
        ${entry.session_id},
        ${entry.job_id ?? null},
        ${entry.level},
        ${entry.source},
        ${entry.message},
        ${detailsJson}::jsonb
      )
    `;
  } catch {
    // Never let logging fail the caller
  }
}

export async function getAgentLogs(params: {
  sessionId?: string;
  jobId?: string;
  level?: AgentLog["level"];
  limit?: number;
}): Promise<AgentLog[]> {
  await ensureAgentLogsTable();
  const { sessionId, jobId, level, limit = 100 } = params;

  if (jobId) {
    const r = await sql<AgentLog>`
      SELECT * FROM agent_logs WHERE job_id = ${jobId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return r.rows;
  }
  if (sessionId && level) {
    const r = await sql<AgentLog>`
      SELECT * FROM agent_logs WHERE session_id = ${sessionId} AND level = ${level}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return r.rows;
  }
  if (sessionId) {
    const r = await sql<AgentLog>`
      SELECT * FROM agent_logs WHERE session_id = ${sessionId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return r.rows;
  }
  // Global — errors only, most recent first
  const r = await sql<AgentLog>`
    SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ${limit}
  `;
  return r.rows;
}

// ─── Agent Feedback ───────────────────────────────────────────────────────────

let agentFeedbackTableReady: Promise<void> | null = null;

async function ensureAgentFeedbackTable() {
  if (!agentFeedbackTableReady) {
    agentFeedbackTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS agent_feedback (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          job_id      TEXT NOT NULL,
          step_index  INTEGER NOT NULL,
          step_type   TEXT NOT NULL,
          -- What the agent decided: "primary" | "time_adjusted" | "venue_switched" | "failed"
          agent_decision TEXT NOT NULL,
          venue_name  TEXT,
          -- Which booking provider was used (opentable / booking_com / kayak / expedia)
          provider    TEXT,
          -- "accepted" = user opened agent's link; "manual_override" = used manual link
          -- "satisfied" / "ok" / "unsatisfied" = job-level satisfaction
          outcome     TEXT NOT NULL,
          metadata    JSONB,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS agent_feedback_session ON agent_feedback(session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS agent_feedback_job ON agent_feedback(job_id)`;
    })().catch((err) => {
      agentFeedbackTableReady = null;
      throw err;
    });
  }
  await agentFeedbackTableReady;
}

export interface AgentFeedbackEvent {
  id: string;
  session_id: string;
  job_id: string;
  step_index: number;
  step_type: "flight" | "hotel" | "restaurant" | "job";
  agent_decision: "primary" | "time_adjusted" | "venue_switched" | "failed" | "n/a";
  venue_name?: string | null;
  provider?: string | null;
  outcome: "accepted" | "manual_override" | "satisfied" | "ok" | "unsatisfied";
  metadata?: Record<string, unknown>;
}

export async function logAgentFeedback(event: AgentFeedbackEvent): Promise<void> {
  await ensureAgentFeedbackTable();
  const meta = event.metadata ? JSON.stringify(event.metadata) : null;
  await sql`
    INSERT INTO agent_feedback
      (id, session_id, job_id, step_index, step_type, agent_decision, venue_name, provider, outcome, metadata)
    VALUES
      (${event.id}, ${event.session_id}, ${event.job_id}, ${event.step_index},
       ${event.step_type}, ${event.agent_decision}, ${event.venue_name ?? null},
       ${event.provider ?? null}, ${event.outcome}, ${meta}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
}

export interface AgentFeedbackStats {
  /** How often agent-adjusted steps (time or venue) were accepted vs overridden */
  adjustmentAcceptanceRate: number; // 0–1
  /** Breakdown of outcomes */
  outcomeBreakdown: {
    accepted: number;
    manual_override: number;
    satisfied: number;
    ok: number;
    unsatisfied: number;
  };
  /** Success/acceptance rate per provider */
  providerStats: Array<{
    provider: string;
    total: number;
    accepted: number;
    rate: number;
  }>;
  /** Venues with most manual overrides (user didn't trust agent's pick) */
  topOverriddenVenues: Array<{ venue_name: string; overrides: number }>;
  /** Step types with most manual interventions */
  manualByType: Array<{ step_type: string; manual: number; total: number }>;
  /** How often each agent decision type was used */
  decisionTypeUsage: Array<{ agent_decision: string; count: number }>;
  totalEvents: number;
}

export async function getAgentFeedbackStats(sessionId?: string): Promise<AgentFeedbackStats> {
  await ensureAgentFeedbackTable();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scopeWhere = (sessionId ? sql`WHERE session_id = ${sessionId}` : sql`WHERE 1=1`) as any;

  const [totals, providers, venues, byType, decisions] = await Promise.all([
    // Outcome breakdown
    sql<{ outcome: string; cnt: string }>`
      SELECT outcome, COUNT(*) AS cnt FROM agent_feedback ${scopeWhere} GROUP BY outcome
    `,
    // Provider stats (only for step-level events)
    sql<{ provider: string; total: string; accepted: string }>`
      SELECT
        provider,
        COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted
      FROM agent_feedback
      ${scopeWhere} AND provider IS NOT NULL AND step_type != 'job'
      GROUP BY provider
      ORDER BY total DESC
    `,
    // Top overridden venues
    sql<{ venue_name: string; overrides: string }>`
      SELECT venue_name, COUNT(*) AS overrides
      FROM agent_feedback
      ${scopeWhere} AND outcome = 'manual_override' AND venue_name IS NOT NULL
      GROUP BY venue_name
      ORDER BY overrides DESC
      LIMIT 5
    `,
    // Manual interventions by step type
    sql<{ step_type: string; manual: string; total: string }>`
      SELECT
        step_type,
        SUM(CASE WHEN outcome = 'manual_override' THEN 1 ELSE 0 END) AS manual,
        COUNT(*) AS total
      FROM agent_feedback
      ${scopeWhere} AND step_type != 'job'
      GROUP BY step_type
    `,
    // Decision type usage
    sql<{ agent_decision: string; cnt: string }>`
      SELECT agent_decision, COUNT(*) AS cnt
      FROM agent_feedback
      ${scopeWhere} AND step_type != 'job'
      GROUP BY agent_decision
      ORDER BY cnt DESC
    `,
  ]);

  const outcomeMap = Object.fromEntries(
    totals.rows.map((r) => [r.outcome, parseInt(r.cnt)])
  ) as Record<string, number>;

  const adjustmentEvents = (outcomeMap["accepted"] ?? 0) + (outcomeMap["manual_override"] ?? 0);
  const adjustmentAcceptanceRate = adjustmentEvents > 0
    ? (outcomeMap["accepted"] ?? 0) / adjustmentEvents
    : 0;

  return {
    adjustmentAcceptanceRate,
    outcomeBreakdown: {
      accepted: outcomeMap["accepted"] ?? 0,
      manual_override: outcomeMap["manual_override"] ?? 0,
      satisfied: outcomeMap["satisfied"] ?? 0,
      ok: outcomeMap["ok"] ?? 0,
      unsatisfied: outcomeMap["unsatisfied"] ?? 0,
    },
    providerStats: providers.rows.map((r) => ({
      provider: r.provider,
      total: parseInt(r.total),
      accepted: parseInt(r.accepted),
      rate: parseInt(r.total) > 0 ? parseInt(r.accepted) / parseInt(r.total) : 0,
    })),
    topOverriddenVenues: venues.rows.map((r) => ({
      venue_name: r.venue_name,
      overrides: parseInt(r.overrides),
    })),
    manualByType: byType.rows.map((r) => ({
      step_type: r.step_type,
      manual: parseInt(r.manual),
      total: parseInt(r.total),
    })),
    decisionTypeUsage: decisions.rows.map((r) => ({
      agent_decision: r.agent_decision,
      count: parseInt(r.cnt),
    })),
    totalEvents: Object.values(outcomeMap).reduce((s, n) => s + n, 0),
  };
}

export async function getAgentFeedbackEvents(
  sessionId?: string,
  limit = 500
): Promise<AgentFeedbackEvent[]> {
  await ensureAgentFeedbackTable();
  const rows = sessionId
    ? await sql<AgentFeedbackEvent>`
        SELECT id, session_id, job_id, step_index, step_type, agent_decision,
               venue_name, provider, outcome, metadata
        FROM agent_feedback
        WHERE session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql<AgentFeedbackEvent>`
        SELECT id, session_id, job_id, step_index, step_type, agent_decision,
               venue_name, provider, outcome, metadata
        FROM agent_feedback
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.rows;
}

// ─── End Agent Feedback ────────────────────────────────────────────────────────

// ─── Booking Monitors ─────────────────────────────────────────────────────────

let bookingMonitorsTableReady: Promise<void> | null = null;

async function ensureBookingMonitorsTable() {
  if (!bookingMonitorsTableReady) {
    bookingMonitorsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS booking_monitors (
          id              TEXT PRIMARY KEY,
          job_id          TEXT NOT NULL,
          session_id      TEXT NOT NULL,
          step_index      INTEGER NOT NULL,
          step_label      TEXT NOT NULL,
          step_emoji      TEXT NOT NULL DEFAULT '',
          type            TEXT NOT NULL,
          config          JSONB NOT NULL,
          status          TEXT NOT NULL DEFAULT 'active',
          last_checked_at TIMESTAMPTZ,
          next_check_at   TIMESTAMPTZ NOT NULL,
          triggered_at    TIMESTAMPTZ,
          trigger_data    JSONB,
          trigger_message TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS booking_monitors_session ON booking_monitors(session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS booking_monitors_job ON booking_monitors(job_id)`;
      await sql`CREATE INDEX IF NOT EXISTS booking_monitors_active ON booking_monitors(status, next_check_at)`;
    })().catch((err) => {
      bookingMonitorsTableReady = null;
      throw err;
    });
  }
  await bookingMonitorsTableReady;
}

export type { BookingMonitor } from "./monitors";

export async function createBookingMonitor(
  monitor: Omit<import("./monitors").BookingMonitor, "created_at">
): Promise<void> {
  await ensureBookingMonitorsTable();
  const configJson = JSON.stringify(monitor.config);
  const triggerDataJson = monitor.trigger_data ? JSON.stringify(monitor.trigger_data) : null;
  await sql`
    INSERT INTO booking_monitors
      (id, job_id, session_id, step_index, step_label, step_emoji, type, config,
       status, last_checked_at, next_check_at, triggered_at, trigger_data, trigger_message)
    VALUES
      (${monitor.id}, ${monitor.job_id}, ${monitor.session_id}, ${monitor.step_index},
       ${monitor.step_label}, ${monitor.step_emoji}, ${monitor.type}, ${configJson}::jsonb,
       ${monitor.status}, ${monitor.last_checked_at ?? null}, ${monitor.next_check_at},
       ${monitor.triggered_at ?? null}, ${triggerDataJson}::jsonb, ${monitor.trigger_message ?? null})
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getBookingMonitorsBySession(
  sessionId: string
): Promise<import("./monitors").BookingMonitor[]> {
  await ensureBookingMonitorsTable();
  const result = await sql<import("./monitors").BookingMonitor>`
    SELECT id, job_id, session_id, step_index, step_label, step_emoji,
           type, config, status, last_checked_at, next_check_at,
           triggered_at, trigger_data, trigger_message, created_at
    FROM booking_monitors
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC
  `;
  return result.rows;
}

export async function getActiveMonitorsDue(): Promise<import("./monitors").BookingMonitor[]> {
  await ensureBookingMonitorsTable();
  const result = await sql<import("./monitors").BookingMonitor>`
    SELECT id, job_id, session_id, step_index, step_label, step_emoji,
           type, config, status, last_checked_at, next_check_at,
           triggered_at, trigger_data, trigger_message, created_at
    FROM booking_monitors
    WHERE status = 'active' AND next_check_at <= NOW()
    ORDER BY next_check_at ASC
    LIMIT 50
  `;
  return result.rows;
}

export async function updateMonitor(
  id: string,
  patch: {
    status?: import("./monitors").MonitorStatus;
    last_checked_at?: string;
    next_check_at?: string;
    triggered_at?: string | null;
    trigger_data?: Record<string, unknown> | null;
    trigger_message?: string | null;
  }
): Promise<void> {
  await ensureBookingMonitorsTable();
  const triggerDataJson = patch.trigger_data !== undefined
    ? (patch.trigger_data ? JSON.stringify(patch.trigger_data) : null)
    : undefined;

  await sql`
    UPDATE booking_monitors SET
      status          = COALESCE(${patch.status ?? null}, status),
      last_checked_at = COALESCE(${patch.last_checked_at ?? null}, last_checked_at),
      next_check_at   = COALESCE(${patch.next_check_at ?? null}, next_check_at),
      triggered_at    = CASE WHEN ${patch.triggered_at !== undefined} THEN ${patch.triggered_at ?? null} ELSE triggered_at END,
      trigger_data    = CASE WHEN ${triggerDataJson !== undefined} THEN ${triggerDataJson ?? null}::jsonb ELSE trigger_data END,
      trigger_message = CASE WHEN ${patch.trigger_message !== undefined} THEN ${patch.trigger_message ?? null} ELSE trigger_message END
    WHERE id = ${id}
  `;
}

export async function deleteMonitor(id: string): Promise<void> {
  await ensureBookingMonitorsTable();
  await sql`DELETE FROM booking_monitors WHERE id = ${id}`;
}

export async function deleteMonitorsByJobId(jobId: string): Promise<void> {
  await ensureBookingMonitorsTable();
  await sql`DELETE FROM booking_monitors WHERE job_id = ${jobId}`;
}

export async function deleteAllMonitorsBySession(sessionId: string): Promise<void> {
  await ensureBookingMonitorsTable();
  await sql`DELETE FROM booking_monitors WHERE session_id = ${sessionId}`;
}

/**
 * Delete monitor rows whose job_id no longer resolves to a booking_jobs row.
 * These are "orphans" left over from older clear-all / delete paths that did
 * not cascade. Returns the count of rows removed so callers can surface it.
 */
export async function deleteOrphanMonitorsBySession(sessionId: string): Promise<number> {
  await ensureBookingMonitorsTable();
  const result = await sql`
    DELETE FROM booking_monitors
    WHERE session_id = ${sessionId}
      AND NOT EXISTS (
        SELECT 1 FROM booking_jobs WHERE booking_jobs.id = booking_monitors.job_id
      )
  `;
  return result.rowCount ?? 0;
}

// ─── End Booking Monitors ──────────────────────────────────────────────────────

// ─── Relationship Profiles ────────────────────────────────────────────────────

let relationshipProfilesTableReady: Promise<void> | null = null;

async function ensureRelationshipProfilesTable() {
  if (!relationshipProfilesTableReady) {
    relationshipProfilesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS relationship_profiles (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          type        TEXT NOT NULL DEFAULT 'solo',
          session_ids JSONB NOT NULL DEFAULT '[]',
          constraints JSONB NOT NULL DEFAULT '[]',
          avoid_types JSONB NOT NULL DEFAULT '[]',
          notes       TEXT NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS rel_profiles_sessions ON relationship_profiles USING GIN(session_ids)`;
    })().catch((err) => {
      relationshipProfilesTableReady = null;
      throw err;
    });
  }
  await relationshipProfilesTableReady;
}

export type { RelationshipProfile, RelationshipType } from "./memory";

export async function getRelationshipBySession(
  sessionId: string
): Promise<import("./memory").RelationshipProfile | null> {
  await ensureRelationshipProfilesTable();
  const result = await sql<import("./memory").RelationshipProfile>`
    SELECT id, name, type, session_ids, constraints, avoid_types, notes, created_at, updated_at
    FROM relationship_profiles
    WHERE session_ids @> ${JSON.stringify([sessionId])}::jsonb
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function createRelationshipProfile(
  profile: Omit<import("./memory").RelationshipProfile, "created_at" | "updated_at">
): Promise<import("./memory").RelationshipProfile> {
  await ensureRelationshipProfilesTable();
  const result = await sql<import("./memory").RelationshipProfile>`
    INSERT INTO relationship_profiles (id, name, type, session_ids, constraints, avoid_types, notes)
    VALUES (
      ${profile.id}, ${profile.name}, ${profile.type},
      ${JSON.stringify(profile.session_ids)}::jsonb,
      ${JSON.stringify(profile.constraints)}::jsonb,
      ${JSON.stringify(profile.avoid_types)}::jsonb,
      ${profile.notes}
    )
    RETURNING *
  `;
  return result.rows[0];
}

export async function updateRelationshipProfile(
  id: string,
  patch: Partial<Pick<import("./memory").RelationshipProfile, "name" | "type" | "constraints" | "avoid_types" | "notes" | "session_ids">>
): Promise<void> {
  await ensureRelationshipProfilesTable();
  // Build partial update — only update provided fields
  if (patch.name !== undefined) {
    await sql`UPDATE relationship_profiles SET name = ${patch.name}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (patch.type !== undefined) {
    await sql`UPDATE relationship_profiles SET type = ${patch.type}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (patch.notes !== undefined) {
    await sql`UPDATE relationship_profiles SET notes = ${patch.notes}, updated_at = NOW() WHERE id = ${id}`;
  }
  if (patch.constraints !== undefined) {
    await sql`UPDATE relationship_profiles SET constraints = ${JSON.stringify(patch.constraints)}::jsonb, updated_at = NOW() WHERE id = ${id}`;
  }
  if (patch.avoid_types !== undefined) {
    await sql`UPDATE relationship_profiles SET avoid_types = ${JSON.stringify(patch.avoid_types)}::jsonb, updated_at = NOW() WHERE id = ${id}`;
  }
  if (patch.session_ids !== undefined) {
    await sql`UPDATE relationship_profiles SET session_ids = ${JSON.stringify(patch.session_ids)}::jsonb, updated_at = NOW() WHERE id = ${id}`;
  }
}

// ─── End Relationship Profiles ─────────────────────────────────────────────────

// ─── End Booking Jobs ─────────────────────────────────────────────────────────

export async function mergeSessionPreferences(
  sessionId: string,
  userId: string
): Promise<void> {
  await ensureUserPreferencesTable();
  // Stamp user_id on session rows ONLY where no user-keyed pref already exists for that key.
  // Skipping keys the user already has prevents unique constraint violations.
  await sql`
    UPDATE user_preferences
    SET user_id = ${userId}
    WHERE session_id = ${sessionId}
      AND user_id IS NULL
      AND preference_key NOT IN (
        SELECT preference_key FROM user_preferences WHERE user_id = ${userId}
      )
  `;
}

// ── Booking Profiles (secure, encrypted card data) ─────────────────────────

let bookingProfilesTableReady: Promise<void> | null = null;

export async function ensureBookingProfilesTable() {
  if (!bookingProfilesTableReady) {
    bookingProfilesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS booking_profiles (
          id              SERIAL PRIMARY KEY,
          user_id         TEXT NOT NULL,
          label           TEXT NOT NULL DEFAULT 'Personal',
          is_default      BOOLEAN NOT NULL DEFAULT FALSE,
          first_name      TEXT NOT NULL DEFAULT '',
          last_name       TEXT NOT NULL DEFAULT '',
          email           TEXT NOT NULL DEFAULT '',
          phone           TEXT NOT NULL DEFAULT '',
          address_line1   TEXT,
          city            TEXT,
          state           TEXT,
          zip             TEXT,
          country         TEXT,
          card_name       TEXT,
          card_number_enc TEXT,
          card_expiry     TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS booking_profiles_user_idx ON booking_profiles (user_id)`;
      // Travel document columns — added via migration (ALTER TABLE IF NOT EXISTS column)
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS date_of_birth TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS nationality TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS passport_number_enc TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS passport_expiry TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS passport_country TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS known_traveler_number TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS driver_license_number_enc TEXT`.catch(() => {});
      await sql`ALTER TABLE booking_profiles ADD COLUMN IF NOT EXISTS driver_license_state TEXT`.catch(() => {});
    })().catch((err) => {
      bookingProfilesTableReady = null;
      console.error("ensureBookingProfilesTable error:", err);
    }) as Promise<void>;
  }
  return bookingProfilesTableReady;
}

export interface BookingProfileRow {
  id: number;
  user_id: string;
  label: string;
  is_default: boolean;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  card_name?: string;
  /** Masked card number for display, e.g. "•••• •••• •••• 4242" */
  card_number_masked?: string;
  card_expiry?: string;
  /** Full decrypted card number — only included when explicitly requested */
  card_number?: string;
  // Travel documents
  date_of_birth?: string;
  nationality?: string;
  /** Full decrypted passport number — only included when explicitly requested */
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  known_traveler_number?: string;
  /** Full decrypted driver's license number — only included when explicitly requested */
  driver_license_number?: string;
  driver_license_state?: string;
}

type ProfileInput = Omit<BookingProfileRow, "id" | "user_id" | "card_number_masked">;

function maskCard(num: string): string {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

function rowToProfile(row: Record<string, unknown>, includeCard = false): BookingProfileRow {
  const cardEnc = row.card_number_enc as string | null;
  const decrypted = cardEnc ? decrypt(cardEnc) : "";
  const passportEnc = row.passport_number_enc as string | null;
  const passportDecrypted = passportEnc ? decrypt(passportEnc) : "";
  const dlEnc = row.driver_license_number_enc as string | null;
  const dlDecrypted = dlEnc ? decrypt(dlEnc) : "";
  return {
    id: row.id as number,
    user_id: row.user_id as string,
    label: row.label as string,
    is_default: row.is_default as boolean,
    first_name: (row.first_name as string) ?? "",
    last_name: (row.last_name as string) ?? "",
    email: (row.email as string) ?? "",
    phone: (row.phone as string) ?? "",
    address_line1: (row.address_line1 as string) ?? undefined,
    city: (row.city as string) ?? undefined,
    state: (row.state as string) ?? undefined,
    zip: (row.zip as string) ?? undefined,
    country: (row.country as string) ?? undefined,
    card_name: (row.card_name as string) ?? undefined,
    card_number_masked: decrypted ? maskCard(decrypted) : undefined,
    card_expiry: (row.card_expiry as string) ?? undefined,
    ...(includeCard && { card_number: decrypted || undefined }),
    // Travel documents (only included when explicitly requested, same as card)
    date_of_birth: (row.date_of_birth as string) ?? undefined,
    nationality: (row.nationality as string) ?? undefined,
    passport_expiry: (row.passport_expiry as string) ?? undefined,
    passport_country: (row.passport_country as string) ?? undefined,
    known_traveler_number: (row.known_traveler_number as string) ?? undefined,
    driver_license_state: (row.driver_license_state as string) ?? undefined,
    ...(includeCard && { passport_number: passportDecrypted || undefined }),
    ...(includeCard && { driver_license_number: dlDecrypted || undefined }),
  };
}

export async function listBookingProfiles(userId: string): Promise<BookingProfileRow[]> {
  await ensureBookingProfilesTable();
  const result = await sql`
    SELECT * FROM booking_profiles WHERE user_id = ${userId} ORDER BY is_default DESC, id ASC
  `;
  return result.rows.map((r) => rowToProfile(r));
}

export async function getBookingProfileById(
  id: number,
  userId: string,
  includeCard = false
): Promise<BookingProfileRow | null> {
  await ensureBookingProfilesTable();
  const result = await sql`
    SELECT * FROM booking_profiles WHERE id = ${id} AND user_id = ${userId}
  `;
  if (result.rows.length === 0) return null;
  return rowToProfile(result.rows[0], includeCard);
}

export async function getDefaultBookingProfile(
  userId: string,
  includeCard = false
): Promise<BookingProfileRow | null> {
  await ensureBookingProfilesTable();
  const result = await sql`
    SELECT * FROM booking_profiles
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return rowToProfile(result.rows[0], includeCard);
}

export async function createBookingProfile(
  userId: string,
  data: Partial<ProfileInput>
): Promise<BookingProfileRow> {
  await ensureBookingProfilesTable();
  const cardEnc = data.card_number ? encrypt(data.card_number) : null;
  const passportEnc = data.passport_number ? encrypt(data.passport_number) : null;
  const dlEnc = data.driver_license_number ? encrypt(data.driver_license_number) : null;
  // If this is the first profile, make it default
  const countRes = await sql`SELECT COUNT(*) as cnt FROM booking_profiles WHERE user_id = ${userId}`;
  const isFirst = parseInt((countRes.rows[0].cnt as string) ?? "0") === 0;

  const result = await sql`
    INSERT INTO booking_profiles (
      user_id, label, is_default,
      first_name, last_name, email, phone,
      address_line1, city, state, zip, country,
      card_name, card_number_enc, card_expiry,
      date_of_birth, nationality,
      passport_number_enc, passport_expiry, passport_country,
      known_traveler_number,
      driver_license_number_enc, driver_license_state,
      updated_at
    ) VALUES (
      ${userId},
      ${data.label ?? "Personal"},
      ${data.is_default ?? isFirst},
      ${data.first_name ?? ""},
      ${data.last_name ?? ""},
      ${data.email ?? ""},
      ${data.phone ?? ""},
      ${data.address_line1 ?? null},
      ${data.city ?? null},
      ${data.state ?? null},
      ${data.zip ?? null},
      ${data.country ?? null},
      ${data.card_name ?? null},
      ${cardEnc},
      ${data.card_expiry ?? null},
      ${data.date_of_birth ?? null},
      ${data.nationality ?? null},
      ${passportEnc},
      ${data.passport_expiry ?? null},
      ${data.passport_country ?? null},
      ${data.known_traveler_number ?? null},
      ${dlEnc},
      ${data.driver_license_state ?? null},
      NOW()
    ) RETURNING *
  `;
  return rowToProfile(result.rows[0]);
}

export async function updateBookingProfile(
  id: number,
  userId: string,
  data: Partial<ProfileInput>
): Promise<BookingProfileRow | null> {
  await ensureBookingProfilesTable();

  // Fetch existing to preserve card enc if not updating
  const existing = await sql`SELECT * FROM booking_profiles WHERE id = ${id} AND user_id = ${userId}`;
  if (existing.rows.length === 0) return null;

  const cardEnc = data.card_number !== undefined
    ? (data.card_number ? encrypt(data.card_number) : null)
    : (existing.rows[0].card_number_enc as string | null);
  const passportEnc = data.passport_number !== undefined
    ? (data.passport_number ? encrypt(data.passport_number) : null)
    : (existing.rows[0].passport_number_enc as string | null);
  const dlEnc = data.driver_license_number !== undefined
    ? (data.driver_license_number ? encrypt(data.driver_license_number) : null)
    : (existing.rows[0].driver_license_number_enc as string | null);

  if (data.is_default) {
    await sql`UPDATE booking_profiles SET is_default = FALSE WHERE user_id = ${userId}`;
  }

  const result = await sql`
    UPDATE booking_profiles SET
      label         = ${data.label ?? (existing.rows[0].label as string)},
      is_default    = ${data.is_default ?? (existing.rows[0].is_default as boolean)},
      first_name    = ${data.first_name ?? (existing.rows[0].first_name as string)},
      last_name     = ${data.last_name ?? (existing.rows[0].last_name as string)},
      email         = ${data.email ?? (existing.rows[0].email as string)},
      phone         = ${data.phone ?? (existing.rows[0].phone as string)},
      address_line1 = ${data.address_line1 !== undefined ? (data.address_line1 ?? null) : (existing.rows[0].address_line1 as string | null)},
      city          = ${data.city !== undefined ? (data.city ?? null) : (existing.rows[0].city as string | null)},
      state         = ${data.state !== undefined ? (data.state ?? null) : (existing.rows[0].state as string | null)},
      zip           = ${data.zip !== undefined ? (data.zip ?? null) : (existing.rows[0].zip as string | null)},
      country       = ${data.country !== undefined ? (data.country ?? null) : (existing.rows[0].country as string | null)},
      card_name     = ${data.card_name !== undefined ? (data.card_name ?? null) : (existing.rows[0].card_name as string | null)},
      card_number_enc = ${cardEnc},
      card_expiry   = ${data.card_expiry !== undefined ? (data.card_expiry ?? null) : (existing.rows[0].card_expiry as string | null)},
      date_of_birth = ${data.date_of_birth !== undefined ? (data.date_of_birth ?? null) : (existing.rows[0].date_of_birth as string | null)},
      nationality   = ${data.nationality !== undefined ? (data.nationality ?? null) : (existing.rows[0].nationality as string | null)},
      passport_number_enc = ${passportEnc},
      passport_expiry = ${data.passport_expiry !== undefined ? (data.passport_expiry ?? null) : (existing.rows[0].passport_expiry as string | null)},
      passport_country = ${data.passport_country !== undefined ? (data.passport_country ?? null) : (existing.rows[0].passport_country as string | null)},
      known_traveler_number = ${data.known_traveler_number !== undefined ? (data.known_traveler_number ?? null) : (existing.rows[0].known_traveler_number as string | null)},
      driver_license_number_enc = ${dlEnc},
      driver_license_state = ${data.driver_license_state !== undefined ? (data.driver_license_state ?? null) : (existing.rows[0].driver_license_state as string | null)},
      updated_at    = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;
  return rowToProfile(result.rows[0]);
}

export async function deleteBookingProfile(id: number, userId: string): Promise<boolean> {
  await ensureBookingProfilesTable();
  const result = await sql`
    DELETE FROM booking_profiles WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `;
  return result.rows.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Decision Rooms v2 — multi-party decision system (Phase 1: 2-person dining)
// Coexists with legacy decision_sessions; will eventually supersede it.
// ═══════════════════════════════════════════════════════════════════════════

export async function ensureDecisionRoomsTable(): Promise<void> {
  if (!decisionRoomsTableReady) {
    decisionRoomsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_rooms (
          id             TEXT PRIMARY KEY,
          short_code     TEXT UNIQUE NOT NULL,
          type           TEXT NOT NULL,
          title          TEXT NOT NULL,
          status         TEXT NOT NULL DEFAULT 'collecting',
          creator_id     TEXT NOT NULL,
          payer_id       TEXT,
          context_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
          booking_job_id TEXT,
          deadline       TIMESTAMPTZ,
          approval_rule  TEXT NOT NULL DEFAULT 'unanimous',
          synthesis_json JSONB,
          categories     TEXT[],
          flow           TEXT NOT NULL DEFAULT 'classic',
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          updated_at     TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      // Phase 2 migration for existing rooms table.
      await sql`ALTER TABLE decision_rooms ADD COLUMN IF NOT EXISTS approval_rule TEXT NOT NULL DEFAULT 'unanimous'`;
      // Stage 2 migrations — trip package + chat flow.
      await sql`ALTER TABLE decision_rooms ADD COLUMN IF NOT EXISTS synthesis_json JSONB`;
      await sql`ALTER TABLE decision_rooms ADD COLUMN IF NOT EXISTS categories TEXT[]`;
      await sql`ALTER TABLE decision_rooms ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'classic'`;
      await sql`CREATE INDEX IF NOT EXISTS decision_rooms_creator_idx ON decision_rooms (creator_id)`;
      await sql`CREATE INDEX IF NOT EXISTS decision_rooms_short_code_idx ON decision_rooms (short_code)`;
      await sql`CREATE INDEX IF NOT EXISTS decision_rooms_status_idx ON decision_rooms (status)`;
    })().catch((err) => {
      decisionRoomsTableReady = null;
      throw err;
    });
  }
  await decisionRoomsTableReady;
}

export async function ensureDecisionRoomMembersTable(): Promise<void> {
  if (!decisionRoomMembersTableReady) {
    decisionRoomMembersTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_members (
          room_id     TEXT NOT NULL,
          user_id     TEXT NOT NULL,
          role        TEXT NOT NULL DEFAULT 'member',
          status      TEXT NOT NULL DEFAULT 'joined',
          joined_at   TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (room_id, user_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_members_user_idx ON decision_room_members (user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_members_room_idx ON decision_room_members (room_id)`;
    })().catch((err) => {
      decisionRoomMembersTableReady = null;
      throw err;
    });
  }
  await decisionRoomMembersTableReady;
}

export async function ensureDecisionRoomConstraintsTable(): Promise<void> {
  if (!decisionRoomConstraintsTableReady) {
    decisionRoomConstraintsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_constraints (
          room_id      TEXT NOT NULL,
          user_id      TEXT NOT NULL,
          data_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
          submitted    BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at   TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (room_id, user_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_constraints_room_idx ON decision_room_constraints (room_id)`;
    })().catch((err) => {
      decisionRoomConstraintsTableReady = null;
      throw err;
    });
  }
  await decisionRoomConstraintsTableReady;
}

export async function ensureDecisionRoomProposalsTable(): Promise<void> {
  if (!decisionRoomProposalsTableReady) {
    decisionRoomProposalsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_proposals (
          id             TEXT PRIMARY KEY,
          room_id        TEXT NOT NULL,
          content_json   JSONB NOT NULL,
          rationale      TEXT,
          conflicts_json JSONB,
          status         TEXT NOT NULL DEFAULT 'active',
          created_at     TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_proposals_room_idx ON decision_room_proposals (room_id, status)`;
    })().catch((err) => {
      decisionRoomProposalsTableReady = null;
      throw err;
    });
  }
  await decisionRoomProposalsTableReady;
}

export async function ensureDecisionRoomVotesTable(): Promise<void> {
  if (!decisionRoomVotesTableReady) {
    decisionRoomVotesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_votes (
          proposal_id   TEXT NOT NULL,
          user_id       TEXT NOT NULL,
          vote          TEXT NOT NULL,
          option_id     TEXT,
          comment       TEXT,
          voted_at      TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (proposal_id, user_id)
        )
      `;
      // Phase 3 migration: add option_id for multi-option proposals.
      await sql`ALTER TABLE decision_room_votes ADD COLUMN IF NOT EXISTS option_id TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_votes_proposal_idx ON decision_room_votes (proposal_id)`;
    })().catch((err) => {
      decisionRoomVotesTableReady = null;
      throw err;
    });
  }
  await decisionRoomVotesTableReady;
}

export async function ensureDecisionRoomMessagesTable(): Promise<void> {
  if (!decisionRoomMessagesTableReady) {
    decisionRoomMessagesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_messages (
          id          BIGSERIAL PRIMARY KEY,
          room_id     TEXT NOT NULL,
          sender_id   TEXT,
          content     TEXT NOT NULL,
          meta_json   JSONB,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_messages_room_idx ON decision_room_messages (room_id, created_at DESC)`;
    })().catch((err) => {
      decisionRoomMessagesTableReady = null;
      throw err;
    });
  }
  await decisionRoomMessagesTableReady;
}

export async function ensureRoomMemberIntentStateTable(): Promise<void> {
  if (!roomMemberIntentStateTableReady) {
    roomMemberIntentStateTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS room_member_intent_state (
          room_id           TEXT NOT NULL,
          user_id           TEXT NOT NULL,
          intent_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at        TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (room_id, user_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS room_member_intent_state_room_idx ON room_member_intent_state (room_id)`;
    })().catch((err) => {
      roomMemberIntentStateTableReady = null;
      throw err;
    });
  }
  await roomMemberIntentStateTableReady;
}

export async function ensureDecisionRoomPrivateMessagesTable(): Promise<void> {
  if (!decisionRoomPrivateMessagesTableReady) {
    decisionRoomPrivateMessagesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS decision_room_private_messages (
          id         BIGSERIAL PRIMARY KEY,
          room_id    TEXT NOT NULL,
          user_id    TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS decision_room_private_messages_room_user_idx ON decision_room_private_messages (room_id, user_id, created_at DESC)`;
    })().catch((err) => {
      decisionRoomPrivateMessagesTableReady = null;
      throw err;
    });
  }
  await decisionRoomPrivateMessagesTableReady;
}

/** Ensure all Decision Room v2 tables — called on first API hit. */
export async function ensureDecisionRoomTables(): Promise<void> {
  await Promise.all([
    ensureDecisionRoomsTable(),
    ensureDecisionRoomMembersTable(),
    ensureDecisionRoomConstraintsTable(),
    ensureDecisionRoomProposalsTable(),
    ensureDecisionRoomVotesTable(),
    ensureDecisionRoomMessagesTable(),
    ensureRoomMemberIntentStateTable(),
    ensureDecisionRoomPrivateMessagesTable(),
  ]);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type DecisionRoomType = "restaurant" | "hotel" | "flight" | "activity" | "trip";
/**
 * Category of a sub-booking inside a trip room. A restaurant/hotel/flight/
 * activity room uses `type` directly; a `type="trip"` room carries one or
 * more of these categories in `categories[]` to describe which sub-bookings
 * the trip bundles (e.g. ["hotel", "flight", "activity"]).
 */
export type DecisionRoomCategory = "restaurant" | "hotel" | "flight" | "activity";
/**
 * How the room was created. `"classic"` = legacy form-based DR (user fills
 * constraints UI → submit). `"chat"` = new Stage 2 flow where homepage chat
 * auto-builds the constraints. Existing rooms default to `"classic"` via DB
 * migration; new chat-flow rooms set `flow="chat"` explicitly at INSERT time.
 */
export type DecisionRoomFlow = "classic" | "chat";
export type DecisionRoomStatus =
  | "collecting"   // members still filling constraints
  | "proposing"    // agent generating proposal
  | "approving"    // proposals out, waiting on votes
  | "executing"    // booking job kicked off
  | "done"         // booking completed
  | "abandoned";   // creator cancelled / timed out
export type ProposalStatus = "active" | "superseded" | "accepted" | "rejected";
export type VoteKind = "approve" | "decline" | "request_changes";

export type ApprovalRule = "unanimous" | "majority";

export interface DecisionRoom {
  id: string;
  short_code: string;
  type: DecisionRoomType;
  title: string;
  status: DecisionRoomStatus;
  creator_id: string;
  payer_id: string | null;
  context_json: Record<string, unknown>;
  booking_job_id: string | null;
  deadline: string | null;
  approval_rule: ApprovalRule;
  /** Stage 2: agent-synthesized TripPackage for `type="trip"` rooms. Null for legacy rooms and single-scenario rooms. */
  synthesis_json: Record<string, unknown> | null;
  /** Stage 2: sub-categories bundled by a `type="trip"` room. Null for single-scenario rooms. */
  categories: DecisionRoomCategory[] | null;
  /** Stage 2: how this room was created — classic form flow vs homepage-chat flow. */
  flow: DecisionRoomFlow;
  created_at: string;
  updated_at: string;
}

export interface DecisionRoomMember {
  room_id: string;
  user_id: string;
  role: "creator" | "member";
  status: "joined" | "left";
  joined_at: string;
}

export interface DecisionRoomConstraintRow {
  room_id: string;
  user_id: string;
  data_json: Record<string, unknown>;
  submitted: boolean;
  updated_at: string;
}

export interface DecisionRoomProposal {
  id: string;
  room_id: string;
  content_json: Record<string, unknown>;
  rationale: string | null;
  conflicts_json: unknown[] | null;
  status: ProposalStatus;
  created_at: string;
}

export interface DecisionRoomVote {
  proposal_id: string;
  user_id: string;
  vote: VoteKind;
  /** Which option within the proposal the user is voting on. null = legacy / no option chosen. */
  option_id: string | null;
  comment: string | null;
  voted_at: string;
}

export interface DecisionRoomMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  content: string;
  meta_json: Record<string, unknown> | null;
  created_at: string;
}

/** Composite snapshot returned by GET /api/rooms/[id]/state — feeds client polling. */
export interface DecisionRoomSnapshot {
  room: DecisionRoom;
  members: DecisionRoomMember[];
  /** Keyed by user_id — only members with a profile row are included. */
  member_profiles: Record<string, UserProfile>;
  constraints: DecisionRoomConstraintRow[];
  proposals: Array<DecisionRoomProposal & { votes: DecisionRoomVote[] }>;
  message_count: number;
  version: number; // bumped each time the room is updated; clients diff on this
}

// ── Short-code generator (6 chars, unambiguous alphabet) ───────────────────

const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/1/I/L
const SHORT_CODE_LEN = 6;

function randomShortCode(): string {
  let out = "";
  for (let i = 0; i < SHORT_CODE_LEN; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

// ── CRUD: Rooms ────────────────────────────────────────────────────────────

export async function createDecisionRoom(params: {
  id: string;
  type: DecisionRoomType;
  title: string;
  creatorId: string;
  payerId?: string | null;
  contextJson?: Record<string, unknown>;
  deadline?: string | null;
  approvalRule?: ApprovalRule;
}): Promise<DecisionRoom> {
  await ensureDecisionRoomTables();

  const payerId = params.payerId ?? params.creatorId;
  const contextJson = JSON.stringify(params.contextJson ?? {});
  const approvalRule: ApprovalRule = params.approvalRule ?? "unanimous";

  // Retry short-code collisions (unique constraint); fallback 5 tries.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortCode = randomShortCode();
    try {
      const result = await sql<DecisionRoom>`
        INSERT INTO decision_rooms
          (id, short_code, type, title, status, creator_id, payer_id, context_json, deadline, approval_rule)
        VALUES
          (${params.id}, ${shortCode}, ${params.type}, ${params.title}, 'collecting',
           ${params.creatorId}, ${payerId}, ${contextJson}::jsonb, ${params.deadline ?? null}, ${approvalRule})
        RETURNING *
      `;
      // Creator auto-joins
      await sql`
        INSERT INTO decision_room_members (room_id, user_id, role, status)
        VALUES (${params.id}, ${params.creatorId}, 'creator', 'joined')
        ON CONFLICT (room_id, user_id) DO NOTHING
      `;
      return result.rows[0];
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      if (!msg.includes("decision_rooms_short_code_key") && !msg.includes("unique")) throw err;
      // else retry
    }
  }
  throw new Error("Failed to allocate a unique short_code after retries");
}

export async function getDecisionRoomById(id: string): Promise<DecisionRoom | null> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoom>`
    SELECT * FROM decision_rooms WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getDecisionRoomByShortCode(shortCode: string): Promise<DecisionRoom | null> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoom>`
    SELECT * FROM decision_rooms WHERE short_code = ${shortCode.toUpperCase()} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * List rooms where this user is a joined member. With `archived: false` (the
 * default) returns only "live" rooms (status in collecting / proposing /
 * approving / executing). With `archived: true` returns done / abandoned —
 * the History tab on /rooms.
 */
export async function listMyDecisionRooms(
  userId: string,
  opts: { archived?: boolean } = {}
): Promise<DecisionRoom[]> {
  await ensureDecisionRoomTables();
  if (opts.archived) {
    const result = await sql<DecisionRoom>`
      SELECT r.*
      FROM decision_rooms r
      JOIN decision_room_members m ON m.room_id = r.id
      WHERE m.user_id = ${userId}
        AND m.status = 'joined'
        AND r.status IN ('done', 'abandoned')
      ORDER BY r.updated_at DESC
      LIMIT 100
    `;
    return result.rows;
  }
  const result = await sql<DecisionRoom>`
    SELECT r.*
    FROM decision_rooms r
    JOIN decision_room_members m ON m.room_id = r.id
    WHERE m.user_id = ${userId}
      AND m.status = 'joined'
      AND r.status NOT IN ('done', 'abandoned')
    ORDER BY r.updated_at DESC
    LIMIT 100
  `;
  return result.rows;
}

export async function updateDecisionRoomStatus(
  roomId: string,
  status: DecisionRoomStatus
): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_rooms SET status = ${status}, updated_at = NOW() WHERE id = ${roomId}
  `;
}

export async function updateDecisionRoomApprovalRule(
  roomId: string,
  rule: ApprovalRule
): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_rooms
    SET approval_rule = ${rule}, updated_at = NOW()
    WHERE id = ${roomId}
  `;
}

export async function setDecisionRoomBookingJob(
  roomId: string,
  bookingJobId: string
): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_rooms
    SET booking_job_id = ${bookingJobId}, status = 'executing', updated_at = NOW()
    WHERE id = ${roomId}
  `;
}

/**
 * Clears the room's booking_job_id (e.g. after a failed job is retried or
 * deleted) and rolls status back from 'executing' to 'approving' so the
 * AcceptedBlock shows the date-picker form again instead of "Booking in
 * progress".
 */
export async function clearDecisionRoomBookingJob(roomId: string): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_rooms
    SET booking_job_id = NULL, status = 'approving', updated_at = NOW()
    WHERE id = ${roomId}
  `;
}

/**
 * Clears any room that still points at a deleted booking job. Used when a task
 * is manually removed from /tasks so the Decision Room can start a fresh
 * booking instead of linking to a dangling job id.
 */
export async function clearDecisionRoomBookingJobByJobId(bookingJobId: string): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_rooms
    SET booking_job_id = NULL, status = 'approving', updated_at = NOW()
    WHERE booking_job_id = ${bookingJobId}
  `;
}

/**
 * Bulk variant for "Clear all tasks". Any room referencing one of the soon-to-
 * be-deleted jobs is reset back to the accepted-booking state.
 */
export async function clearDecisionRoomBookingJobsByIds(bookingJobIds: string[]): Promise<void> {
  await ensureDecisionRoomTables();
  if (bookingJobIds.length === 0) return;
  for (const bookingJobId of bookingJobIds) {
    await clearDecisionRoomBookingJobByJobId(bookingJobId);
  }
}

/**
 * Soft-delete a member: flips their row to status='left'. All existing
 * queries already filter to status='joined', so the ex-member silently drops
 * out of tallies, member strip, chat roster, etc. — no cascading edits.
 *
 * We keep their constraints / votes / messages for history so remaining
 * members can still see the discussion that happened while they were there.
 */
export async function leaveDecisionRoom(
  roomId: string,
  userId: string
): Promise<boolean> {
  await ensureDecisionRoomTables();
  const result = await sql`
    UPDATE decision_room_members
    SET status = 'left'
    WHERE room_id = ${roomId} AND user_id = ${userId} AND status = 'joined'
  `;
  if ((result.rowCount ?? 0) > 0) {
    await sql`UPDATE decision_rooms SET updated_at = NOW() WHERE id = ${roomId}`;
    return true;
  }
  return false;
}

/**
 * Hand the creator role to another joined member. If the current creator was
 * also the payer, the payer moves with them. Does NOT remove the old creator
 * from the room — callers (e.g. a creator "transfer-and-leave" flow) must
 * call leaveDecisionRoom afterwards if that's the intent.
 */
export async function transferRoomCreator(
  roomId: string,
  newCreatorId: string
): Promise<void> {
  await ensureDecisionRoomTables();
  // Pull current creator/payer so we know whether payer needs to follow.
  const room = await sql<{ creator_id: string; payer_id: string | null }>`
    SELECT creator_id, payer_id FROM decision_rooms WHERE id = ${roomId} LIMIT 1
  `;
  if (room.rows.length === 0) throw new Error("Room not found");
  const { creator_id: oldCreator, payer_id: oldPayer } = room.rows[0];
  const nextPayer = oldPayer === oldCreator || oldPayer === null ? newCreatorId : oldPayer;
  await sql`
    UPDATE decision_rooms
    SET creator_id = ${newCreatorId},
        payer_id = ${nextPayer},
        updated_at = NOW()
    WHERE id = ${roomId}
  `;
}

/**
 * Permanently remove a room and all dependent rows. Irreversible — callers
 * must confirm with the user AND restrict this to rooms that are already
 * done/abandoned (we enforce that at the API layer, not here, so internal
 * tooling can override).
 *
 * Order matters: delete children before parent to respect any FK behavior
 * even though current schema doesn't declare CASCADE.
 */
export async function deleteDecisionRoom(roomId: string): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`DELETE FROM decision_room_votes WHERE proposal_id IN (
    SELECT id FROM decision_room_proposals WHERE room_id = ${roomId}
  )`;
  await sql`DELETE FROM decision_room_proposals WHERE room_id = ${roomId}`;
  await sql`DELETE FROM decision_room_constraints WHERE room_id = ${roomId}`;
  await sql`DELETE FROM decision_room_messages WHERE room_id = ${roomId}`;
  await sql`DELETE FROM decision_room_members WHERE room_id = ${roomId}`;
  await sql`DELETE FROM decision_rooms WHERE id = ${roomId}`;
}

// ── CRUD: Members ──────────────────────────────────────────────────────────

export async function joinDecisionRoom(roomId: string, userId: string): Promise<DecisionRoomMember> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomMember>`
    INSERT INTO decision_room_members (room_id, user_id, role, status)
    VALUES (${roomId}, ${userId}, 'member', 'joined')
    ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'joined', joined_at = NOW()
    RETURNING *
  `;
  await sql`UPDATE decision_rooms SET updated_at = NOW() WHERE id = ${roomId}`;
  return result.rows[0];
}

export async function listRoomMembers(roomId: string): Promise<DecisionRoomMember[]> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomMember>`
    SELECT * FROM decision_room_members
    WHERE room_id = ${roomId} AND status = 'joined'
    ORDER BY joined_at ASC
  `;
  return result.rows;
}

export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  await ensureDecisionRoomTables();
  const result = await sql`
    SELECT 1 FROM decision_room_members
    WHERE room_id = ${roomId} AND user_id = ${userId} AND status = 'joined'
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/** True if the two users are both joined members of at least one common room. */
export async function usersShareRoom(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;
  await ensureDecisionRoomTables();
  const result = await sql`
    SELECT 1 FROM decision_room_members a
    JOIN decision_room_members b
      ON a.room_id = b.room_id
    WHERE a.user_id = ${userA} AND b.user_id = ${userB}
      AND a.status = 'joined' AND b.status = 'joined'
    LIMIT 1
  `;
  return result.rows.length > 0;
}

// ── CRUD: Constraints ──────────────────────────────────────────────────────

export async function upsertRoomConstraint(
  roomId: string,
  userId: string,
  dataJson: Record<string, unknown>,
  submitted: boolean
): Promise<DecisionRoomConstraintRow> {
  await ensureDecisionRoomTables();
  const json = JSON.stringify(dataJson);
  const result = await sql<DecisionRoomConstraintRow>`
    INSERT INTO decision_room_constraints (room_id, user_id, data_json, submitted, updated_at)
    VALUES (${roomId}, ${userId}, ${json}::jsonb, ${submitted}, NOW())
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET
      data_json  = ${json}::jsonb,
      submitted  = ${submitted},
      updated_at = NOW()
    RETURNING *
  `;
  await sql`UPDATE decision_rooms SET updated_at = NOW() WHERE id = ${roomId}`;
  return result.rows[0];
}

export async function listRoomConstraints(roomId: string): Promise<DecisionRoomConstraintRow[]> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomConstraintRow>`
    SELECT * FROM decision_room_constraints WHERE room_id = ${roomId}
  `;
  return result.rows;
}

// ── CRUD: Proposals ────────────────────────────────────────────────────────

export async function createRoomProposal(params: {
  id: string;
  roomId: string;
  contentJson: Record<string, unknown>;
  rationale?: string | null;
  conflictsJson?: unknown[] | null;
}): Promise<DecisionRoomProposal> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomProposal>`
    INSERT INTO decision_room_proposals
      (id, room_id, content_json, rationale, conflicts_json, status)
    VALUES
      (${params.id}, ${params.roomId}, ${JSON.stringify(params.contentJson)}::jsonb,
       ${params.rationale ?? null},
       ${params.conflictsJson ? JSON.stringify(params.conflictsJson) : null}::jsonb,
       'active')
    RETURNING *
  `;
  await sql`UPDATE decision_rooms SET status = 'approving', updated_at = NOW() WHERE id = ${params.roomId}`;
  return result.rows[0];
}

/**
 * Returns every proposal for a room (newest first) — including `rejected`
 * ones. The client renders the most recent rejected proposal above the
 * Regenerate button so members can see what was proposed and who voted
 * for what in the previous round.
 *
 * Historical misnomer kept for compatibility with call sites.
 */
export async function listActiveProposals(roomId: string): Promise<DecisionRoomProposal[]> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomProposal>`
    SELECT * FROM decision_room_proposals
    WHERE room_id = ${roomId} AND status IN ('active', 'accepted', 'rejected')
    ORDER BY created_at DESC
  `;
  return result.rows;
}

export async function getRoomProposal(proposalId: string): Promise<DecisionRoomProposal | null> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomProposal>`
    SELECT * FROM decision_room_proposals WHERE id = ${proposalId} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function updateProposalStatus(
  proposalId: string,
  status: ProposalStatus
): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    UPDATE decision_room_proposals SET status = ${status} WHERE id = ${proposalId}
  `;
}

// ── CRUD: Votes ────────────────────────────────────────────────────────────

export async function castRoomVote(params: {
  proposalId: string;
  userId: string;
  vote: VoteKind;
  optionId?: string | null;
  comment?: string | null;
}): Promise<DecisionRoomVote> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomVote>`
    INSERT INTO decision_room_votes (proposal_id, user_id, vote, option_id, comment, voted_at)
    VALUES (${params.proposalId}, ${params.userId}, ${params.vote}, ${params.optionId ?? null}, ${params.comment ?? null}, NOW())
    ON CONFLICT (proposal_id, user_id)
    DO UPDATE SET vote = ${params.vote}, option_id = ${params.optionId ?? null}, comment = ${params.comment ?? null}, voted_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

export async function listProposalVotes(proposalId: string): Promise<DecisionRoomVote[]> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomVote>`
    SELECT * FROM decision_room_votes WHERE proposal_id = ${proposalId}
  `;
  return result.rows;
}

export async function deleteProposalVote(proposalId: string, userId: string): Promise<void> {
  await ensureDecisionRoomTables();
  await sql`
    DELETE FROM decision_room_votes
    WHERE proposal_id = ${proposalId} AND user_id = ${userId}
  `;
}

// ── CRUD: Messages ─────────────────────────────────────────────────────────

export async function appendRoomMessage(params: {
  roomId: string;
  senderId: string | null;
  content: string;
  metaJson?: Record<string, unknown> | null;
}): Promise<DecisionRoomMessage> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomMessage>`
    INSERT INTO decision_room_messages (room_id, sender_id, content, meta_json)
    VALUES (${params.roomId}, ${params.senderId}, ${params.content},
            ${params.metaJson ? JSON.stringify(params.metaJson) : null}::jsonb)
    RETURNING *
  `;
  await sql`UPDATE decision_rooms SET updated_at = NOW() WHERE id = ${params.roomId}`;
  return result.rows[0];
}

export async function listRoomMessages(
  roomId: string,
  limit = 100
): Promise<DecisionRoomMessage[]> {
  await ensureDecisionRoomTables();
  const result = await sql<DecisionRoomMessage>`
    SELECT * FROM decision_room_messages
    WHERE room_id = ${roomId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return result.rows;
}

// ── Composite snapshot (polling endpoint) ──────────────────────────────────

export async function getRoomSnapshot(roomId: string): Promise<DecisionRoomSnapshot | null> {
  await ensureDecisionRoomTables();
  const room = await getDecisionRoomById(roomId);
  if (!room) return null;

  const [members, constraints, proposals] = await Promise.all([
    listRoomMembers(roomId),
    listRoomConstraints(roomId),
    listActiveProposals(roomId),
  ]);

  const proposalsWithVotes = await Promise.all(
    proposals.map(async (p) => ({ ...p, votes: await listProposalVotes(p.id) }))
  );

  const msgCountResult = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c FROM decision_room_messages WHERE room_id = ${roomId}
  `;
  const messageCount = parseInt(msgCountResult.rows[0]?.c ?? "0", 10);

  // Resolve member userIds → profiles so the UI can render display names.
  const memberProfiles = await getUserProfilesByIds(members.map((m) => m.user_id));

  // Version = max(updated_at across room + all child tables) — coarse but good enough for 3s polling.
  // We use room.updated_at (bumped on every child write via helpers above) as the version signal.
  const version = new Date(room.updated_at).getTime();

  return {
    room,
    members,
    member_profiles: memberProfiles,
    constraints,
    proposals: proposalsWithVotes,
    message_count: messageCount,
    version,
  };
}

// ── Phase 1.5: Recent collaborators ────────────────────────────────────────

/** People this user has shared a Room with, most-recent join first. */
export async function getRecentCollaborators(userId: string, limit = 20): Promise<string[]> {
  await ensureDecisionRoomTables();
  const result = await sql<{ user_id: string }>`
    SELECT DISTINCT ON (m2.user_id) m2.user_id
    FROM decision_room_members m1
    JOIN decision_room_members m2 ON m2.room_id = m1.room_id AND m2.user_id <> m1.user_id
    WHERE m1.user_id = ${userId} AND m1.status = 'joined' AND m2.status = 'joined'
    ORDER BY m2.user_id, m2.joined_at DESC
    LIMIT ${limit}
  `;
  return result.rows.map((r) => r.user_id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Contacts / user profiles (Phase 1.5 — Layer 2: address book w/ profile codes)
// ═══════════════════════════════════════════════════════════════════════════

export async function ensureUserProfilesTable(): Promise<void> {
  if (!userProfilesTableReady) {
    userProfilesTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_profiles (
          user_id       TEXT PRIMARY KEY,
          profile_code  TEXT NOT NULL UNIQUE,
          display_name  TEXT,
          avatar_url    TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_profiles_code_idx ON user_profiles (profile_code)`;
      // Backfill: add username for @handle lookup (e.g. @ziweib). Clerk owns
      // uniqueness globally, but we enforce a case-insensitive local unique
      // so two synced accounts can't collide.
      await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS username TEXT`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_lower_idx
        ON user_profiles (LOWER(username))
        WHERE username IS NOT NULL
      `;
    })().catch((err) => {
      userProfilesTableReady = null;
      throw err;
    });
  }
  await userProfilesTableReady;
}

export async function ensureUserContactsTable(): Promise<void> {
  if (!userContactsTableReady) {
    userContactsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_contacts (
          owner_id         TEXT NOT NULL,
          contact_user_id  TEXT NOT NULL,
          nickname         TEXT,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (owner_id, contact_user_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_contacts_owner_idx ON user_contacts (owner_id)`;
    })().catch((err) => {
      userContactsTableReady = null;
      throw err;
    });
  }
  await userContactsTableReady;
}

export interface UserProfile {
  user_id: string;
  profile_code: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Clerk-sourced handle (e.g. "ziweib"). Nullable for legacy rows. */
  username: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  owner_id: string;
  contact_user_id: string;
  nickname: string | null;
  created_at: string;
}

/** Contact joined with the peer's profile — what the UI actually renders. */
export interface ContactWithProfile {
  contact_user_id: string;
  nickname: string | null;
  profile_code: string;
  display_name: string | null;
  avatar_url: string | null;
  added_at: string;
}

/**
 * Upsert a user_profiles row. On first insert, generate a unique profile_code.
 * Safe to call on every sign-in (idempotent).
 */
export async function ensureUserProfile(
  userId: string,
  displayName: string | null,
  avatarUrl: string | null,
  username: string | null = null
): Promise<UserProfile> {
  await ensureUserProfilesTable();

  // Fast path: row already exists — just refresh display_name/avatar_url/username.
  const existing = await sql<UserProfile>`SELECT * FROM user_profiles WHERE user_id = ${userId} LIMIT 1`;
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const changed =
      row.display_name !== displayName ||
      row.avatar_url !== avatarUrl ||
      row.username !== username;
    if (changed) {
      const updated = await sql<UserProfile>`
        UPDATE user_profiles
        SET display_name = ${displayName},
            avatar_url = ${avatarUrl},
            username = ${username},
            updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING *
      `;
      return updated.rows[0];
    }
    return row;
  }

  // Slow path: create row with a fresh unique profile_code. Retry on collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomShortCode();
    try {
      const inserted = await sql<UserProfile>`
        INSERT INTO user_profiles (user_id, profile_code, display_name, avatar_url, username)
        VALUES (${userId}, ${code}, ${displayName}, ${avatarUrl}, ${username})
        RETURNING *
      `;
      return inserted.rows[0];
    } catch (err) {
      // Unique-violation on profile_code → retry with a new one.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("user_profiles_profile_code_key") && !msg.includes("unique")) throw err;
    }
  }
  throw new Error("Failed to generate a unique profile_code after 5 attempts");
}

export async function getUserProfileByCode(code: string): Promise<UserProfile | null> {
  await ensureUserProfilesTable();
  const result = await sql<UserProfile>`
    SELECT * FROM user_profiles WHERE profile_code = ${code.toUpperCase()} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/** Case-insensitive lookup by Clerk username (e.g. "@ziweib"). */
export async function getUserProfileByUsername(username: string): Promise<UserProfile | null> {
  await ensureUserProfilesTable();
  const result = await sql<UserProfile>`
    SELECT * FROM user_profiles WHERE LOWER(username) = LOWER(${username}) LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  await ensureUserProfilesTable();
  const result = await sql<UserProfile>`SELECT * FROM user_profiles WHERE user_id = ${userId} LIMIT 1`;
  return result.rows[0] ?? null;
}

/** Batch resolve userIds → profiles. Missing ids simply omitted from the map. */
export async function getUserProfilesByIds(userIds: string[]): Promise<Record<string, UserProfile>> {
  if (userIds.length === 0) return {};
  await ensureUserProfilesTable();
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await db.query<UserProfile>(
    `SELECT * FROM user_profiles WHERE user_id IN (${placeholders})`,
    userIds
  );
  const out: Record<string, UserProfile> = {};
  for (const row of result.rows) out[row.user_id] = row;
  return out;
}

export async function addContact(
  ownerId: string,
  contactUserId: string,
  nickname: string | null
): Promise<ContactRow> {
  if (ownerId === contactUserId) throw new Error("Cannot add yourself as a contact");
  await ensureUserContactsTable();
  const result = await sql<ContactRow>`
    INSERT INTO user_contacts (owner_id, contact_user_id, nickname)
    VALUES (${ownerId}, ${contactUserId}, ${nickname})
    ON CONFLICT (owner_id, contact_user_id)
    DO UPDATE SET nickname = COALESCE(EXCLUDED.nickname, user_contacts.nickname)
    RETURNING *
  `;
  return result.rows[0];
}

export async function updateContactNickname(
  ownerId: string,
  contactUserId: string,
  nickname: string | null
): Promise<ContactRow | null> {
  await ensureUserContactsTable();
  const result = await sql<ContactRow>`
    UPDATE user_contacts SET nickname = ${nickname}
    WHERE owner_id = ${ownerId} AND contact_user_id = ${contactUserId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

export async function removeContact(ownerId: string, contactUserId: string): Promise<boolean> {
  await ensureUserContactsTable();
  const result = await sql`
    DELETE FROM user_contacts WHERE owner_id = ${ownerId} AND contact_user_id = ${contactUserId}
  `;
  return (result.rowCount ?? 0) > 0;
}

export async function isContact(ownerId: string, contactUserId: string): Promise<boolean> {
  await ensureUserContactsTable();
  const result = await sql`
    SELECT 1 FROM user_contacts WHERE owner_id = ${ownerId} AND contact_user_id = ${contactUserId} LIMIT 1
  `;
  return result.rows.length > 0;
}

/** List my contacts joined with their profile data — ready for rendering. */
export async function listContactsWithProfiles(ownerId: string): Promise<ContactWithProfile[]> {
  await Promise.all([ensureUserContactsTable(), ensureUserProfilesTable()]);
  await backfillBidirectionalContactsOnce();
  const result = await sql<{
    contact_user_id: string;
    nickname: string | null;
    created_at: string;
    profile_code: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>`
    SELECT c.contact_user_id, c.nickname, c.created_at,
           p.profile_code, p.display_name, p.avatar_url
    FROM user_contacts c
    LEFT JOIN user_profiles p ON p.user_id = c.contact_user_id
    WHERE c.owner_id = ${ownerId}
    ORDER BY c.created_at DESC
  `;
  return result.rows.map((r) => ({
    contact_user_id: r.contact_user_id,
    nickname: r.nickname,
    profile_code: r.profile_code ?? "",
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    added_at: r.created_at,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Contact requests + blocks (friend-request model)
//
// We treat user_contacts as *bidirectional*: accepting a request inserts a
// row on both sides. Legacy rows that pre-date this change are backfilled on
// first touch so listContactsWithProfiles stays symmetric.
//
// Rules:
//   - Cannot send a request if a contact already exists in either direction.
//   - Cannot send if either party has blocked the other.
//   - If the target declined me within the last 7 days, I'm on cooldown.
//   - An existing pending request in either direction blocks new ones.
// ═══════════════════════════════════════════════════════════════════════════

export type ContactRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface ContactRequestRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: ContactRequestStatus;
  created_at: string;
  resolved_at: string | null;
  note: string | null;
}

export interface ContactRequestWithProfile extends ContactRequestRow {
  /** Profile of the *other* party relative to the caller. */
  peer_profile_code: string | null;
  peer_display_name: string | null;
  peer_avatar_url: string | null;
}

export interface ContactBlockRow {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface BlockedUserWithProfile extends ContactBlockRow {
  profile_code: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

const CONTACT_REQUEST_DECLINE_COOLDOWN_DAYS = 7;

export async function ensureContactRequestsTable(): Promise<void> {
  if (!contactRequestsTableReady) {
    contactRequestsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS contact_requests (
          id            TEXT PRIMARY KEY,
          from_user_id  TEXT NOT NULL,
          to_user_id    TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'pending',
          note          TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at   TIMESTAMPTZ,
          CHECK (from_user_id <> to_user_id),
          CHECK (status IN ('pending','accepted','declined','cancelled'))
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS contact_requests_to_status_idx ON contact_requests (to_user_id, status)`;
      await sql`CREATE INDEX IF NOT EXISTS contact_requests_from_status_idx ON contact_requests (from_user_id, status)`;
      // Only one pending request can exist between any ordered pair at a time.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_pending_uniq
        ON contact_requests (from_user_id, to_user_id)
        WHERE status = 'pending'
      `;
    })().catch((err) => {
      contactRequestsTableReady = null;
      throw err;
    });
  }
  await contactRequestsTableReady;
}

export async function ensureContactBlocksTable(): Promise<void> {
  if (!contactBlocksTableReady) {
    contactBlocksTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS contact_blocks (
          blocker_id  TEXT NOT NULL,
          blocked_id  TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (blocker_id, blocked_id),
          CHECK (blocker_id <> blocked_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS contact_blocks_blocked_idx ON contact_blocks (blocked_id)`;
    })().catch((err) => {
      contactBlocksTableReady = null;
      throw err;
    });
  }
  await contactBlocksTableReady;
}

/**
 * One-time backfill: user_contacts used to be stored unidirectionally. For any
 * (a, b) row without a matching (b, a), insert the reverse so listing works
 * symmetrically. Safe to run repeatedly — uses ON CONFLICT DO NOTHING.
 */
async function backfillBidirectionalContactsOnce(): Promise<void> {
  if (!userContactsBackfillRan) {
    userContactsBackfillRan = (async () => {
      await sql`
        INSERT INTO user_contacts (owner_id, contact_user_id, nickname)
        SELECT a.contact_user_id, a.owner_id, NULL
        FROM user_contacts a
        LEFT JOIN user_contacts b
          ON b.owner_id = a.contact_user_id
         AND b.contact_user_id = a.owner_id
        WHERE b.owner_id IS NULL
        ON CONFLICT (owner_id, contact_user_id) DO NOTHING
      `;
    })().catch((err) => {
      userContactsBackfillRan = null;
      throw err;
    });
  }
  await userContactsBackfillRan;
}

export async function addBidirectionalContact(
  aUserId: string,
  bUserId: string
): Promise<void> {
  if (aUserId === bUserId) throw new Error("Cannot add yourself as a contact");
  await ensureUserContactsTable();
  await sql`
    INSERT INTO user_contacts (owner_id, contact_user_id, nickname)
    VALUES (${aUserId}, ${bUserId}, NULL), (${bUserId}, ${aUserId}, NULL)
    ON CONFLICT (owner_id, contact_user_id) DO NOTHING
  `;
}

/**
 * Verify whether `fromUserId` is allowed to send a new contact request to
 * `toUserId` right now. Returns `{ ok: true }` or `{ ok: false, reason }`.
 * Callers should surface the reason verbatim to the user.
 */
export async function canSendContactRequest(
  fromUserId: string,
  toUserId: string
): Promise<{ ok: true } | { ok: false; reason: string; code: string }> {
  if (fromUserId === toUserId) {
    return { ok: false, code: "self", reason: "You can't add yourself." };
  }
  await Promise.all([
    ensureUserContactsTable(),
    ensureContactRequestsTable(),
    ensureContactBlocksTable(),
  ]);
  await backfillBidirectionalContactsOnce();

  const blocks = await sql<{ blocker_id: string }>`
    SELECT blocker_id FROM contact_blocks
    WHERE (blocker_id = ${fromUserId} AND blocked_id = ${toUserId})
       OR (blocker_id = ${toUserId} AND blocked_id = ${fromUserId})
    LIMIT 1
  `;
  if (blocks.rows.length > 0) {
    const iBlocked = blocks.rows[0].blocker_id === fromUserId;
    return {
      ok: false,
      code: iBlocked ? "you_blocked_them" : "they_blocked_you",
      reason: iBlocked
        ? "You blocked this user. Unblock them first."
        : "You can't send a request to this user.",
    };
  }

  const already = await sql`
    SELECT 1 FROM user_contacts
    WHERE (owner_id = ${fromUserId} AND contact_user_id = ${toUserId})
       OR (owner_id = ${toUserId} AND contact_user_id = ${fromUserId})
    LIMIT 1
  `;
  if (already.rows.length > 0) {
    return { ok: false, code: "already_contact", reason: "Already in your contacts." };
  }

  const pending = await sql<{ from_user_id: string }>`
    SELECT from_user_id FROM contact_requests
    WHERE status = 'pending'
      AND ((from_user_id = ${fromUserId} AND to_user_id = ${toUserId})
        OR (from_user_id = ${toUserId} AND to_user_id = ${fromUserId}))
    LIMIT 1
  `;
  if (pending.rows.length > 0) {
    const mine = pending.rows[0].from_user_id === fromUserId;
    return {
      ok: false,
      code: mine ? "already_pending_outgoing" : "already_pending_incoming",
      reason: mine
        ? "You already have a pending request to this user."
        : "This user already sent you a request — accept it from your inbox.",
    };
  }

  const cutoff = new Date(
    Date.now() - CONTACT_REQUEST_DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const cooldown = await sql<{ resolved_at: string }>`
    SELECT resolved_at FROM contact_requests
    WHERE from_user_id = ${fromUserId}
      AND to_user_id = ${toUserId}
      AND status = 'declined'
      AND resolved_at > ${cutoff}
    ORDER BY resolved_at DESC
    LIMIT 1
  `;
  if (cooldown.rows.length > 0) {
    return {
      ok: false,
      code: "cooldown",
      reason: `This user recently declined your request. Try again after ${CONTACT_REQUEST_DECLINE_COOLDOWN_DAYS} days.`,
    };
  }

  return { ok: true };
}

export async function createContactRequest(
  fromUserId: string,
  toUserId: string,
  note: string | null
): Promise<ContactRequestRow> {
  await ensureContactRequestsTable();
  const id = `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const result = await sql<ContactRequestRow>`
    INSERT INTO contact_requests (id, from_user_id, to_user_id, note, status)
    VALUES (${id}, ${fromUserId}, ${toUserId}, ${note}, 'pending')
    RETURNING *
  `;
  return result.rows[0];
}

export async function getContactRequestById(
  id: string
): Promise<ContactRequestRow | null> {
  await ensureContactRequestsTable();
  const result = await sql<ContactRequestRow>`
    SELECT * FROM contact_requests WHERE id = ${id} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function updateContactRequestStatus(
  id: string,
  status: Exclude<ContactRequestStatus, "pending">
): Promise<ContactRequestRow | null> {
  await ensureContactRequestsTable();
  const result = await sql<ContactRequestRow>`
    UPDATE contact_requests
    SET status = ${status}, resolved_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

export async function listIncomingContactRequests(
  userId: string
): Promise<ContactRequestWithProfile[]> {
  await Promise.all([ensureContactRequestsTable(), ensureUserProfilesTable()]);
  const result = await sql<ContactRequestWithProfile>`
    SELECT r.id, r.from_user_id, r.to_user_id, r.status, r.created_at, r.resolved_at, r.note,
           p.profile_code AS peer_profile_code,
           p.display_name AS peer_display_name,
           p.avatar_url   AS peer_avatar_url
    FROM contact_requests r
    LEFT JOIN user_profiles p ON p.user_id = r.from_user_id
    WHERE r.to_user_id = ${userId} AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `;
  return result.rows;
}

export async function listOutgoingContactRequests(
  userId: string
): Promise<ContactRequestWithProfile[]> {
  await Promise.all([ensureContactRequestsTable(), ensureUserProfilesTable()]);
  const result = await sql<ContactRequestWithProfile>`
    SELECT r.id, r.from_user_id, r.to_user_id, r.status, r.created_at, r.resolved_at, r.note,
           p.profile_code AS peer_profile_code,
           p.display_name AS peer_display_name,
           p.avatar_url   AS peer_avatar_url
    FROM contact_requests r
    LEFT JOIN user_profiles p ON p.user_id = r.to_user_id
    WHERE r.from_user_id = ${userId} AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `;
  return result.rows;
}

/** Map of peerUserId → "pending_outgoing" | "pending_incoming". Used by room UI. */
export async function getPendingRequestPeers(
  userId: string
): Promise<Record<string, "pending_outgoing" | "pending_incoming">> {
  await ensureContactRequestsTable();
  const result = await sql<{ from_user_id: string; to_user_id: string }>`
    SELECT from_user_id, to_user_id FROM contact_requests
    WHERE status = 'pending' AND (from_user_id = ${userId} OR to_user_id = ${userId})
  `;
  const out: Record<string, "pending_outgoing" | "pending_incoming"> = {};
  for (const r of result.rows) {
    if (r.from_user_id === userId) out[r.to_user_id] = "pending_outgoing";
    else out[r.from_user_id] = "pending_incoming";
  }
  return out;
}

export async function hasBlock(
  blockerUserId: string,
  blockedUserId: string
): Promise<boolean> {
  await ensureContactBlocksTable();
  const result = await sql`
    SELECT 1 FROM contact_blocks
    WHERE blocker_id = ${blockerUserId} AND blocked_id = ${blockedUserId}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/**
 * Block a user. Also: clears any pending contact requests in either direction
 * and removes the pair from user_contacts (both sides). The block persists
 * until explicitly removed.
 */
export async function createBlock(
  blockerUserId: string,
  blockedUserId: string
): Promise<void> {
  if (blockerUserId === blockedUserId) throw new Error("Cannot block yourself");
  await Promise.all([
    ensureContactBlocksTable(),
    ensureContactRequestsTable(),
    ensureUserContactsTable(),
  ]);
  await sql`
    INSERT INTO contact_blocks (blocker_id, blocked_id)
    VALUES (${blockerUserId}, ${blockedUserId})
    ON CONFLICT DO NOTHING
  `;
  // Auto-cancel any pending request between the two, in either direction.
  await sql`
    UPDATE contact_requests
    SET status = 'cancelled', resolved_at = NOW()
    WHERE status = 'pending'
      AND ((from_user_id = ${blockerUserId} AND to_user_id = ${blockedUserId})
        OR (from_user_id = ${blockedUserId} AND to_user_id = ${blockerUserId}))
  `;
  // Drop the contact relationship on both sides.
  await sql`
    DELETE FROM user_contacts
    WHERE (owner_id = ${blockerUserId} AND contact_user_id = ${blockedUserId})
       OR (owner_id = ${blockedUserId} AND contact_user_id = ${blockerUserId})
  `;
}

export async function removeBlock(
  blockerUserId: string,
  blockedUserId: string
): Promise<boolean> {
  await ensureContactBlocksTable();
  const result = await sql`
    DELETE FROM contact_blocks
    WHERE blocker_id = ${blockerUserId} AND blocked_id = ${blockedUserId}
  `;
  return (result.rowCount ?? 0) > 0;
}

export async function listMyBlocks(userId: string): Promise<BlockedUserWithProfile[]> {
  await Promise.all([ensureContactBlocksTable(), ensureUserProfilesTable()]);
  const result = await sql<BlockedUserWithProfile>`
    SELECT b.blocker_id, b.blocked_id, b.created_at,
           p.profile_code, p.display_name, p.avatar_url
    FROM contact_blocks b
    LEFT JOIN user_profiles p ON p.user_id = b.blocked_id
    WHERE b.blocker_id = ${userId}
    ORDER BY b.created_at DESC
  `;
  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Groups (Phase 2 — named reusable sets of contacts for 3-5 person decisions)
// ═══════════════════════════════════════════════════════════════════════════

export async function ensureUserGroupsTable(): Promise<void> {
  if (!userGroupsTableReady) {
    userGroupsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_groups (
          id          TEXT PRIMARY KEY,
          owner_id    TEXT NOT NULL,
          name        TEXT NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_groups_owner_idx ON user_groups (owner_id)`;
    })().catch((err) => {
      userGroupsTableReady = null;
      throw err;
    });
  }
  await userGroupsTableReady;
}

export async function ensureUserGroupMembersTable(): Promise<void> {
  if (!userGroupMembersTableReady) {
    userGroupMembersTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_group_members (
          group_id         TEXT NOT NULL,
          contact_user_id  TEXT NOT NULL,
          added_at         TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (group_id, contact_user_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS user_group_members_group_idx ON user_group_members (group_id)`;
    })().catch((err) => {
      userGroupMembersTableReady = null;
      throw err;
    });
  }
  await userGroupMembersTableReady;
}

export interface UserGroup {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface UserGroupWithCount extends UserGroup {
  member_count: number;
}

export async function createGroup(ownerId: string, name: string): Promise<UserGroup> {
  await ensureUserGroupsTable();
  const id = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const result = await sql<UserGroup>`
    INSERT INTO user_groups (id, owner_id, name)
    VALUES (${id}, ${ownerId}, ${name})
    RETURNING *
  `;
  return result.rows[0];
}

export async function listMyGroups(ownerId: string): Promise<UserGroupWithCount[]> {
  await Promise.all([ensureUserGroupsTable(), ensureUserGroupMembersTable()]);
  const result = await sql<UserGroupWithCount>`
    SELECT g.*, COALESCE(COUNT(m.contact_user_id), 0)::int AS member_count
    FROM user_groups g
    LEFT JOIN user_group_members m ON m.group_id = g.id
    WHERE g.owner_id = ${ownerId}
    GROUP BY g.id
    ORDER BY g.updated_at DESC
  `;
  return result.rows;
}

export async function getGroup(ownerId: string, groupId: string): Promise<UserGroup | null> {
  await ensureUserGroupsTable();
  const result = await sql<UserGroup>`
    SELECT * FROM user_groups WHERE id = ${groupId} AND owner_id = ${ownerId} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function renameGroup(
  ownerId: string,
  groupId: string,
  name: string
): Promise<UserGroup | null> {
  await ensureUserGroupsTable();
  const result = await sql<UserGroup>`
    UPDATE user_groups SET name = ${name}, updated_at = NOW()
    WHERE id = ${groupId} AND owner_id = ${ownerId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

export async function deleteGroup(ownerId: string, groupId: string): Promise<boolean> {
  await Promise.all([ensureUserGroupsTable(), ensureUserGroupMembersTable()]);
  // Remove members first to keep FK-free schema consistent.
  await sql`DELETE FROM user_group_members WHERE group_id = ${groupId}`;
  const result = await sql`
    DELETE FROM user_groups WHERE id = ${groupId} AND owner_id = ${ownerId}
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Add one or more contacts to a group. Skips ids that aren't the owner's
 * contacts (prevents sneaking strangers into a group).
 */
export async function addGroupMembers(
  ownerId: string,
  groupId: string,
  contactUserIds: string[]
): Promise<number> {
  if (contactUserIds.length === 0) return 0;
  await Promise.all([
    ensureUserGroupsTable(),
    ensureUserGroupMembersTable(),
    ensureUserContactsTable(),
  ]);

  // Verify ownership of the group.
  const group = await getGroup(ownerId, groupId);
  if (!group) throw new Error("Group not found");

  // Intersect the requested ids with the owner's actual contacts.
  const placeholders = contactUserIds.map((_, i) => `$${i + 2}`).join(",");
  const valid = await db.query<{ contact_user_id: string }>(
    `SELECT contact_user_id FROM user_contacts
      WHERE owner_id = $1 AND contact_user_id IN (${placeholders})`,
    [ownerId, ...contactUserIds]
  );
  const validIds = valid.rows.map((r) => r.contact_user_id);
  if (validIds.length === 0) return 0;

  let inserted = 0;
  for (const cid of validIds) {
    const res = await sql`
      INSERT INTO user_group_members (group_id, contact_user_id)
      VALUES (${groupId}, ${cid})
      ON CONFLICT (group_id, contact_user_id) DO NOTHING
    `;
    inserted += res.rowCount ?? 0;
  }
  if (inserted > 0) {
    await sql`UPDATE user_groups SET updated_at = NOW() WHERE id = ${groupId}`;
  }
  return inserted;
}

export async function removeGroupMember(
  ownerId: string,
  groupId: string,
  contactUserId: string
): Promise<boolean> {
  await Promise.all([ensureUserGroupsTable(), ensureUserGroupMembersTable()]);
  const group = await getGroup(ownerId, groupId);
  if (!group) return false;
  const result = await sql`
    DELETE FROM user_group_members
    WHERE group_id = ${groupId} AND contact_user_id = ${contactUserId}
  `;
  if ((result.rowCount ?? 0) > 0) {
    await sql`UPDATE user_groups SET updated_at = NOW() WHERE id = ${groupId}`;
    return true;
  }
  return false;
}

/** List a group's members joined with their profile + nickname — ready to render. */
export async function listGroupMembersWithProfiles(
  ownerId: string,
  groupId: string
): Promise<ContactWithProfile[]> {
  await Promise.all([
    ensureUserGroupsTable(),
    ensureUserGroupMembersTable(),
    ensureUserContactsTable(),
    ensureUserProfilesTable(),
  ]);
  const group = await getGroup(ownerId, groupId);
  if (!group) return [];
  const result = await sql<{
    contact_user_id: string;
    nickname: string | null;
    added_at: string;
    profile_code: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }>`
    SELECT gm.contact_user_id,
           c.nickname,
           gm.added_at,
           p.profile_code,
           p.display_name,
           p.avatar_url
    FROM user_group_members gm
    LEFT JOIN user_contacts c
      ON c.owner_id = ${ownerId} AND c.contact_user_id = gm.contact_user_id
    LEFT JOIN user_profiles p
      ON p.user_id = gm.contact_user_id
    WHERE gm.group_id = ${groupId}
    ORDER BY gm.added_at ASC
  `;
  return result.rows.map((r) => ({
    contact_user_id: r.contact_user_id,
    nickname: r.nickname,
    profile_code: r.profile_code ?? "",
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    added_at: r.added_at,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Decision Rooms v2 · Stage 2 — chat-flow CRUD
// Used by the homepage-chat → DR pipeline: each chat turn upserts the user's
// IntentState for the active room, and private messages are persisted per
// member for the room's private channel (never visible to other members).
// ═══════════════════════════════════════════════════════════════════════════

export type PrivateMessageRole = "user" | "assistant" | "system";

export interface MemberIntentStateRow {
  user_id: string;
  intent_state_json: Record<string, unknown>;
  updated_at: string;
}

/** Upsert a member's IntentState snapshot for a room. Idempotent — latest write wins. */
export async function upsertMemberIntentState(params: {
  roomId: string;
  userId: string;
  intentStateJson: Record<string, unknown>;
}): Promise<void> {
  await ensureRoomMemberIntentStateTable();
  const payload = JSON.stringify(params.intentStateJson);
  await sql`
    INSERT INTO room_member_intent_state (room_id, user_id, intent_state_json, updated_at)
    VALUES (${params.roomId}, ${params.userId}, ${payload}::jsonb, NOW())
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET intent_state_json = EXCLUDED.intent_state_json,
          updated_at        = NOW()
  `;
}

/** Read one member's IntentState for a room. */
export async function getMemberIntentState(
  roomId: string,
  userId: string,
): Promise<MemberIntentStateRow | null> {
  await ensureRoomMemberIntentStateTable();
  const result = await sql<MemberIntentStateRow>`
    SELECT user_id, intent_state_json, updated_at
    FROM room_member_intent_state
    WHERE room_id = ${roomId} AND user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/** List all members' IntentStates for a room. Used by trip-synthesis aggregation. */
export async function listMemberIntentStates(
  roomId: string,
): Promise<MemberIntentStateRow[]> {
  await ensureRoomMemberIntentStateTable();
  const result = await sql<MemberIntentStateRow>`
    SELECT user_id, intent_state_json, updated_at
    FROM room_member_intent_state
    WHERE room_id = ${roomId}
    ORDER BY updated_at ASC
  `;
  return result.rows;
}

export interface PrivateMessageRow {
  id: string;
  role: PrivateMessageRole;
  content: string;
  created_at: string;
}

/** Append a private-channel message (user's side of chat with agent). */
export async function insertPrivateMessage(params: {
  roomId: string;
  userId: string;
  role: PrivateMessageRole;
  content: string;
}): Promise<void> {
  await ensureDecisionRoomPrivateMessagesTable();
  await sql`
    INSERT INTO decision_room_private_messages (room_id, user_id, role, content)
    VALUES (${params.roomId}, ${params.userId}, ${params.role}, ${params.content})
  `;
}

/**
 * Read the private-channel message history for a (room, user). Ordered oldest
 * first (chronological), capped at `limit` (default 200). Privacy: caller MUST
 * authenticate `userId` matches the requester — this function does not check.
 */
export async function listPrivateMessages(
  roomId: string,
  userId: string,
  limit: number = 200,
): Promise<PrivateMessageRow[]> {
  await ensureDecisionRoomPrivateMessagesTable();
  const result = await sql<PrivateMessageRow>`
    SELECT id::text AS id, role, content, created_at
    FROM decision_room_private_messages
    WHERE room_id = ${roomId} AND user_id = ${userId}
    ORDER BY id ASC
    LIMIT ${limit}
  `;
  return result.rows;
}
