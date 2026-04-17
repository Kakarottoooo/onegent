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
  type: "flight" | "hotel" | "restaurant" | "universal";
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
