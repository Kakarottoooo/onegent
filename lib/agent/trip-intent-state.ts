/**
 * TripIntentState — multi-turn state machine for trip packaging (Stage 1).
 *
 * The homepage chat flow for a trip spans multiple turns:
 *   turn 1: "I want to go to NY for 3 days"        → destination + nights known
 *   turn 2: "from SFO, 2 people, mid budget"        → origin + party + vibe filled
 *
 * Each turn the NLU produces a CityTripIntent-shaped partial; we merge it into
 * an accumulating TripIntentState. When all required fields are present the
 * commit endpoint hands the state to the planner; otherwise we emit a single
 * clarification message that lists *all* still-missing fields at once (per
 * ADR-3 — user prefers a form-like experience to a chatty one).
 */
import type { CityTripIntent } from "../types";

export type TripVibe = "trendy" | "upscale" | "local" | "mixed";

export interface TripIntentState {
  destination_city?: string;
  departure_city?: string;
  start_date?: string;
  end_date?: string;
  nights?: number;
  travelers?: number;
  hotel_star_rating?: number;
  hotel_neighborhood?: string;
  activities: string[];
  cuisine_preferences: string[];
  vibe: TripVibe;
  budget_total?: number;
  planning_assumptions: string[];
}

/** Hard-required fields for trip packaging. Missing any of these blocks the
 *  planner from running — we must ask the user for them. */
export type TripRequiredField =
  | "destination_city"
  | "date_range"
  | "departure_city"
  | "traveler_count";

export function emptyTripState(): TripIntentState {
  return {
    activities: [],
    cuisine_preferences: [],
    vibe: "mixed",
    planning_assumptions: [],
  };
}

/**
 * Merge a partial update into an existing trip state. Rules:
 *   - scalar fields: new value wins if defined, else keep previous
 *   - string arrays (activities, cuisine_preferences, planning_assumptions):
 *     union with previous, preserving order (new entries appended)
 *   - vibe: upgrade from "mixed" to any specific vibe, else keep previous
 */
export function mergeTripIntent(
  prev: TripIntentState,
  next: Partial<TripIntentState>
): TripIntentState {
  const merged: TripIntentState = { ...prev };

  const scalar: (keyof TripIntentState)[] = [
    "destination_city",
    "departure_city",
    "start_date",
    "end_date",
    "nights",
    "travelers",
    "hotel_star_rating",
    "hotel_neighborhood",
    "budget_total",
  ];
  for (const key of scalar) {
    const v = next[key];
    if (v !== undefined && v !== null && v !== "") {
      // Narrow through unknown because TS can't infer the keyed type from the loop.
      (merged as unknown as Record<string, unknown>)[key] = v;
    }
  }

  if (next.vibe && next.vibe !== "mixed") {
    merged.vibe = next.vibe;
  } else if (next.vibe === "mixed" && !merged.vibe) {
    merged.vibe = "mixed";
  }

  merged.activities = unionStrings(prev.activities, next.activities);
  merged.cuisine_preferences = unionStrings(prev.cuisine_preferences, next.cuisine_preferences);
  merged.planning_assumptions = unionStrings(
    prev.planning_assumptions,
    next.planning_assumptions
  );

  return merged;
}

function unionStrings(prev: string[], next: string[] | undefined): string[] {
  if (!next || next.length === 0) return prev;
  const seen = new Set(prev.map((s) => s.toLowerCase()));
  const out = [...prev];
  for (const s of next) {
    if (typeof s !== "string") continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Return the list of hard-required fields still missing from `state`.
 * Called by the commit endpoint to decide: ask for more info vs run planner.
 */
export function getMissingFields(state: TripIntentState): TripRequiredField[] {
  const missing: TripRequiredField[] = [];
  if (!state.destination_city || state.destination_city.trim() === "") {
    missing.push("destination_city");
  }
  const hasFrom = !!state.start_date;
  const hasTo = !!state.end_date;
  const hasNights = typeof state.nights === "number" && state.nights > 0;
  // date_range is satisfied if we have (from + to) OR (from + nights).
  if (!hasFrom || (!hasTo && !hasNights)) {
    missing.push("date_range");
  }
  if (!state.departure_city || state.departure_city.trim() === "") {
    missing.push("departure_city");
  }
  if (typeof state.travelers !== "number" || state.travelers < 1) {
    missing.push("traveler_count");
  }
  return missing;
}

/**
 * Produce a single clarification message that lists every missing field at
 * once. Per ADR-3, we surface all gaps in one shot — the user fills them in
 * one reply, minimizing conversation round-trips.
 *
 * Optional fields (budget_tier, activity_interest) are always listed at the
 * end with "(optional)" tags, so the user can leave them blank.
 */
export function buildClarificationMessage(missing: TripRequiredField[]): string {
  const lines: string[] = [];
  lines.push("Got it — I can package a trip for you. I need a few details; please fill in whatever you can in one reply:");
  lines.push("");

  const bullets: string[] = [];
  const ask = (label: string) => bullets.push(`- ${label}`);

  // Required fields, in a stable order
  if (missing.includes("destination_city")) ask("Where are you going? (city)");
  if (missing.includes("date_range")) ask("What dates? (e.g. \"Apr 25–28\" or \"next weekend, 3 nights\")");
  if (missing.includes("departure_city")) ask("Where are you flying from? (city or airport code)");
  if (missing.includes("traveler_count")) ask("How many people?");

  // Optional fields — always included so user can volunteer them
  ask("Budget tier — upscale / mid / budget? (optional, defaults to mid)");
  ask("Any shows, sports, or activities you want tickets for? (optional — leave blank and I'll suggest popular ones)");

  lines.push(...bullets);
  return lines.join("\n");
}

/**
 * Normalize a CityTripIntent produced by the NLU into a TripIntentState.
 * Safe to call every turn: missing fields in the intent come through as
 * undefined and are ignored by `mergeTripIntent`.
 */
export function cityTripIntentToState(
  intent: Partial<CityTripIntent> & { departure_city?: string }
): TripIntentState {
  const state = emptyTripState();
  if (intent.destination_city) state.destination_city = intent.destination_city;
  if (intent.departure_city) state.departure_city = intent.departure_city;
  if (intent.start_date) state.start_date = intent.start_date;
  if (intent.end_date) state.end_date = intent.end_date;
  if (typeof intent.nights === "number") state.nights = intent.nights;
  if (typeof intent.travelers === "number") state.travelers = intent.travelers;
  if (typeof intent.hotel_star_rating === "number") state.hotel_star_rating = intent.hotel_star_rating;
  if (intent.hotel_neighborhood) state.hotel_neighborhood = intent.hotel_neighborhood;
  if (typeof intent.budget_total === "number") state.budget_total = intent.budget_total;
  if (Array.isArray(intent.activities)) state.activities = intent.activities.slice();
  if (Array.isArray(intent.cuisine_preferences)) {
    state.cuisine_preferences = intent.cuisine_preferences.slice();
  }
  if (Array.isArray(intent.planning_assumptions)) {
    state.planning_assumptions = intent.planning_assumptions.slice();
  }
  if (intent.vibe === "trendy" || intent.vibe === "upscale" || intent.vibe === "local") {
    state.vibe = intent.vibe;
  }
  return state;
}

/**
 * Convert a fully-filled TripIntentState back into a CityTripIntent shape
 * for the existing planner. Assumes getMissingFields(state) is empty.
 */
export function stateToCityTripIntent(state: TripIntentState): CityTripIntent {
  const startDate = state.start_date;
  const endDate =
    state.end_date ??
    (state.start_date && state.nights
      ? addDays(state.start_date, state.nights)
      : undefined);
  const nights =
    state.nights ??
    (startDate && endDate ? daysBetween(startDate, endDate) : undefined);

  return {
    category: "trip",
    scenario: "city_trip",
    scenario_goal: `Plan a ${nights ?? "multi"}-night trip to ${state.destination_city ?? "the destination"}.`,
    destination_city: state.destination_city ?? "the destination",
    departure_city: state.departure_city,
    start_date: startDate,
    end_date: endDate,
    nights,
    travelers: state.travelers ?? 1,
    hotel_star_rating: state.hotel_star_rating,
    hotel_neighborhood: state.hotel_neighborhood,
    activities: state.activities,
    cuisine_preferences: state.cuisine_preferences,
    vibe: state.vibe,
    budget_total: state.budget_total,
    planning_assumptions: state.planning_assumptions,
    needs_clarification: false,
    missing_fields: [],
  };
}

function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

// ─── Date resolution ──────────────────────────────────────────────────────
// NLU LLMs often emit relative strings like "next Saturday" / "next weekend" /
// "tomorrow" rather than ISO dates. We resolve them here rather than pushing
// the burden onto the model (which is unreliable across turns and languages).
// Returns YYYY-MM-DD or null if the input can't be normalized.

const WEEKDAY_ALIASES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function resolveDateHint(
  input: string | null | undefined,
  today: Date = new Date()
): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;

  // MM/DD — assume current year, roll to next year if already past
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const year = today.getFullYear();
    const candidate = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    return candidate < toIso(today) ? `${year + 1}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}` : candidate;
  }

  const lower = raw.toLowerCase();

  // today / tomorrow / day after tomorrow
  if (lower === "today") return toIso(today);
  if (lower === "tomorrow") return toIso(offsetDays(today, 1));
  if (lower === "day after tomorrow" || lower === "the day after tomorrow") {
    return toIso(offsetDays(today, 2));
  }

  // "in N days"
  const inDays = lower.match(/^in\s+(\d+)\s+days?$/);
  if (inDays) return toIso(offsetDays(today, Number(inDays[1])));

  // "next week" / "this week" → Monday of that week
  if (lower === "next week") return toIso(nextWeekday(today, 1, /* allow_today */ false, /* offset_weeks */ 1));
  if (lower === "this week") return toIso(nextWeekday(today, 1, /* allow_today */ true, /* offset_weeks */ 0));

  // "next weekend" / "this weekend" → Saturday of that weekend
  if (lower === "next weekend") return toIso(nextWeekday(today, 6, /* allow_today */ false, /* offset_weeks */ 1));
  if (lower === "this weekend" || lower === "weekend") {
    return toIso(nextWeekday(today, 6, /* allow_today */ true, /* offset_weeks */ 0));
  }

  // "next <weekday>" / "this <weekday>"
  const nextMatch = lower.match(/^next\s+(\w+)$/);
  if (nextMatch) {
    const wd = WEEKDAY_ALIASES[nextMatch[1]];
    if (wd !== undefined) return toIso(nextWeekday(today, wd, false, 1));
  }
  const thisMatch = lower.match(/^this\s+(\w+)$/);
  if (thisMatch) {
    const wd = WEEKDAY_ALIASES[thisMatch[1]];
    if (wd !== undefined) return toIso(nextWeekday(today, wd, true, 0));
  }
  // bare weekday name ("saturday") → next occurrence
  const bareWd = WEEKDAY_ALIASES[lower];
  if (bareWd !== undefined) return toIso(nextWeekday(today, bareWd, true, 0));

  // Fall back to JS Date parsing (handles "May 20 2026", "2026-04-22" etc.)
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return toIso(d);

  return null;
}

function toIso(d: Date): string {
  // Use UTC components so DST transitions don't shift the calendar day.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function offsetDays(from: Date, days: number): Date {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Return the next date whose weekday matches `targetWeekday`.
 *   allowToday=true  → today counts if it matches (returns today for matching today)
 *   offsetWeeks=N    → add N additional weeks on top (e.g. "next saturday" = 1)
 */
function nextWeekday(
  from: Date,
  targetWeekday: number,
  allowToday: boolean,
  offsetWeeks: number
): Date {
  const base = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  const todayDow = base.getUTCDay();
  let delta = (targetWeekday - todayDow + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  delta += offsetWeeks * 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base;
}
