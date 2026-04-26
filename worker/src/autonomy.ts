/**
 * Agent Autonomy Settings
 *
 * Defines the explicit boundaries within which the agent may act without
 * asking the user. Every autonomous decision references these settings in
 * its decision log so users always know *why* the agent did something.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type AutopilotLevel = "ask" | "smart" | "full";

export interface RestaurantAutonomy {
  /** Max minutes the agent may shift the booking time in either direction.
   *  0 = never adjust time automatically. */
  timeWindowMinutes: 0 | 30 | 60 | 90;
  /** If true, the agent may switch to a backup venue when the primary fails. */
  allowVenueSwitch: boolean;
  /** Agent will never book later than this time (24h "HH:MM"). */
  latestTimeHHMM: string;
  /** Agent will never book earlier than this time (24h "HH:MM"). */
  earliestTimeHHMM: string;
  /** Max % over stated budget the agent may book. 0 = strictly no over-budget. */
  budgetFlexPct: 0 | 5 | 10 | 20;
  /** If true, agent only considers indoor venues. */
  requireIndoor: boolean;
}

export interface HotelAutonomy {
  /** Max % over stated budget the agent may book.
   *  0 = strictly no over-budget. */
  budgetFlexPct: 0 | 5 | 10 | 20;
  /** If true, agent may switch to a hotel in the same city but different area. */
  allowAreaSwitch: boolean;
  /** If true, agent may search in a broader region when local options fail. */
  allowCrossRegion: boolean;
  /** Agent will refuse hotels rated below this on a 0–5 scale. */
  minStarRating: 0 | 3 | 3.5 | 4 | 4.5;
  /** If true, agent only considers hotels with parking. */
  requireParking: boolean;
}

export interface FlightAutonomy {
  /** Max minutes the agent may shift departure time in either direction.
   *  0 = never adjust departure. */
  departureFlexMinutes: 0 | 60 | 120 | 180;
  /** If true, agent may try 1-stop options when no direct flights are available. */
  allowLayover: boolean;
  /** If true, agent may try nearby airports (e.g. JFK ↔ LGA ↔ EWR). */
  allowAlternateAirport: boolean;
}

export interface ActivityAutonomy {
  /** Max minutes the agent may shift the activity time in either direction. */
  timeWindowMinutes: 0 | 30 | 60 | 90;
  /** If true, agent may switch to a backup activity venue when the primary fails. */
  allowVenueSwitch: boolean;
  /** If true, agent only considers indoor activities. */
  requireIndoor: boolean;
}

export interface AgentAutonomySettings {
  /** How much the agent does autonomously before checking in with the user. */
  autopilot: AutopilotLevel;
  restaurant: RestaurantAutonomy;
  hotel: HotelAutonomy;
  flight: FlightAutonomy;
  activity: ActivityAutonomy;
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_AUTONOMY: AgentAutonomySettings = {
  autopilot: "smart",
  restaurant: {
    timeWindowMinutes: 60,
    allowVenueSwitch: true,
    latestTimeHHMM: "22:00",
    earliestTimeHHMM: "11:00",
    budgetFlexPct: 0,
    requireIndoor: false,
  },
  hotel: {
    budgetFlexPct: 10,
    allowAreaSwitch: true,
    allowCrossRegion: false,
    minStarRating: 3,
    requireParking: false,
  },
  flight: {
    departureFlexMinutes: 60,
    allowLayover: false,
    allowAlternateAirport: false,
  },
  activity: {
    timeWindowMinutes: 60,
    allowVenueSwitch: true,
    requireIndoor: false,
  },
};

// ── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "agent_autonomy_settings";

export function loadAutonomySettings(): AgentAutonomySettings {
  if (typeof window === "undefined") return DEFAULT_AUTONOMY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTONOMY;
    const saved = JSON.parse(raw) as Partial<AgentAutonomySettings>;
    return {
      autopilot: saved.autopilot ?? DEFAULT_AUTONOMY.autopilot,
      restaurant: { ...DEFAULT_AUTONOMY.restaurant, ...saved.restaurant },
      hotel: { ...DEFAULT_AUTONOMY.hotel, ...saved.hotel },
      flight: { ...DEFAULT_AUTONOMY.flight, ...saved.flight },
      activity: { ...DEFAULT_AUTONOMY.activity, ...saved.activity },
    };
  } catch {
    return DEFAULT_AUTONOMY;
  }
}

export function saveAutonomySettings(settings: AgentAutonomySettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ── Helpers used by the /start route ──────────────────────────────────────

/** Convert "HH:MM" to minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Filter a list of time fallbacks according to restaurant autonomy settings.
 * Removes times that are:
 *  - further than timeWindowMinutes from the base time
 *  - later than latestTimeHHMM
 *  - earlier than earliestTimeHHMM
 */
export function filterTimeFallbacks(
  baseTime: string,
  candidates: string[],
  settings: RestaurantAutonomy
): string[] {
  if (settings.timeWindowMinutes === 0) return [];

  const baseMin = toMinutes(baseTime);
  const latestMin = toMinutes(settings.latestTimeHHMM);
  const earliestMin = toMinutes(settings.earliestTimeHHMM);
  const window = settings.timeWindowMinutes;

  return candidates.filter((t) => {
    const m = toMinutes(t);
    return (
      Math.abs(m - baseMin) <= window &&
      m <= latestMin &&
      m >= earliestMin
    );
  });
}

// ── Explanation template builder ───────────────────────────────────────────

/**
 * Generate a human-readable explanation for each agent decision that cites
 * the relevant autonomy setting. This is what goes in the decision log's
 * `message` field instead of just "tried X".
 */
export const Explain = {
  timeTry(venue: string, time: string): string {
    return `Tried ${venue} at ${time}`;
  },

  timeAdjusted(venue: string, fromTime: string, toTime: string, windowMin: number): string {
    return `${fromTime} unavailable at ${venue}. ±${windowMin}min adjustment on → trying ${toTime}`;
  },

  timeAdjustedBlocked(venue: string, fromTime: string, toTime: string, reason: "window" | "latest" | "earliest"): string {
    const why =
      reason === "window" ? "outside your allowed time window" :
      reason === "latest" ? "past your latest acceptable time" :
      "before your earliest acceptable time";
    return `${toTime} skipped (${why}) — your settings limit adjustments from ${fromTime}`;
  },

  venueSwitched(from: string, to: string): string {
    return `${from} unavailable. Venue switching on → trying ${to}`;
  },

  venueSwitchBlocked(from: string): string {
    return `${from} unavailable. Venue switching is off in your settings — creating manual booking option`;
  },

  retry(attempt: number, max: number, error: string): string {
    return `Transient error (${error}). Retrying… (attempt ${attempt} of ${max})`;
  },

  allFailed(venue: string, triedCount: number): string {
    return `All ${triedCount} option${triedCount !== 1 ? "s" : ""} failed for ${venue}. Generating manual booking link.`;
  },

  noTimeAdjustmentAllowed(venue: string, time: string): string {
    return `${time} unavailable at ${venue}. Time adjustment is off in your settings — skipping to next option`;
  },
};
