/**
 * TripPackage planner — Phase 2 (per-category options).
 *
 * Runs 4 independent pipelines in parallel (hotel / flight / restaurant /
 * activity) and returns a TripPackage with up to 5 option cards per category.
 * The client UI shows 4 sections; the user picks 1 hotel + 1 flight (or
 * skips) and 0-3 of each of restaurant / activity.
 *
 * Failure isolation: Promise.allSettled + per-pipeline 45s timeout, so one
 * slow upstream (e.g. MiniMax flaky) can't wedge the whole plan call. When a
 * pipeline fails the corresponding option array is empty and its error is
 * surfaced in `errors` for the UI to render a "No results — retry?" state.
 */
import { randomUUID } from "crypto";
import type {
  ActivityIntent,
  ActivityRecommendationCard,
  FlightIntent,
  FlightRecommendationCard,
  HotelIntent,
  HotelRecommendationCard,
  RecommendationCard,
  TripPackage,
  TripPackageErrors,
  UserRequirements,
} from "../../types";
import { CITIES, DEFAULT_CITY } from "../../cities";
import { runHotelPipeline } from "../pipelines/hotel";
import { runFlightPipeline } from "../pipelines/flight";
import { runActivityPipeline } from "../pipelines/activity";
import { gatherCandidates, rankAndExplain } from "../pipelines/restaurant";
import { resolveDateHint, type TripIntentState } from "../trip-intent-state";

const OPTIONS_PER_CATEGORY = 5;
const PIPELINE_TIMEOUT_MS = 45_000;

export interface BuildTripPackageResult {
  package: TripPackage;
  errors: TripPackageErrors;
}

/**
 * Build a TripPackage from a filled TripIntentState.
 * Caller MUST validate with getMissingFields(state) first.
 */
export async function buildTripPackage(
  state: TripIntentState,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<BuildTripPackageResult> {
  // Derive concrete dates. Defensive normalize in case a relative string
  // ("next weekend") slipped past upstream resolvers.
  const startDate = resolveDateHint(state.start_date);
  if (!startDate) {
    throw new Error(
      `TripPackage planner: start_date "${state.start_date ?? "(missing)"}" is not a valid date.`
    );
  }
  const endDateRaw = state.end_date ? resolveDateHint(state.end_date) : null;
  const endDate = endDateRaw ?? addDays(startDate, state.nights ?? 1);
  const nights = state.nights ?? daysBetween(startDate, endDate);
  const travelers = state.travelers ?? 1;

  const cityId = resolveCityId(state.destination_city!);
  const cityFullName = CITIES[cityId]?.fullName ?? state.destination_city!;

  // Build per-pipeline intents
  const hotelIntent = buildHotelIntent(state, startDate, endDate, nights, travelers);
  const flightIntent = buildFlightIntent(state, startDate, endDate, travelers);
  const restaurantReqs = buildRestaurantReqs(state, travelers);
  const activityIntent = buildActivityIntent(state, startDate, endDate, travelers);

  const hotelStart = Date.now();
  const flightStart = Date.now();
  const restaurantStart = Date.now();
  const activityStart = Date.now();

  const [hotelOutcome, flightOutcome, restaurantOutcome, activityOutcome] = await Promise.allSettled([
    withTimeout(
      runHotelPipeline(hotelIntent, conversationHistory, cityFullName),
      PIPELINE_TIMEOUT_MS,
      "hotel pipeline timed out after 45s"
    ).then((v) => {
      console.log(`[trip-package] hotel pipeline done in ${Date.now() - hotelStart}ms`, {
        results: v.hotelRecommendations?.length ?? 0,
      });
      return v;
    }).catch((err) => {
      console.error(`[trip-package] hotel pipeline failed after ${Date.now() - hotelStart}ms:`, err);
      throw err;
    }),
    withTimeout(
      runFlightPipeline(flightIntent),
      PIPELINE_TIMEOUT_MS,
      "flight pipeline timed out after 45s"
    ).then((v) => {
      console.log(`[trip-package] flight pipeline done in ${Date.now() - flightStart}ms`, {
        results: v.flightRecommendations?.length ?? 0,
        missing: v.missing_fields,
      });
      return v;
    }).catch((err) => {
      console.error(`[trip-package] flight pipeline failed after ${Date.now() - flightStart}ms:`, err);
      throw err;
    }),
    withTimeout(
      gatherCandidates(restaurantReqs, cityId, null, undefined).then((r) =>
        rankAndExplain(
          restaurantReqs,
          r.restaurants,
          r.semanticSignals,
          conversationHistory,
          cityFullName
        )
      ),
      PIPELINE_TIMEOUT_MS,
      "restaurant pipeline timed out after 45s"
    ).then((v) => {
      console.log(`[trip-package] restaurant pipeline done in ${Date.now() - restaurantStart}ms`, {
        results: v.cards?.length ?? 0,
      });
      return v;
    }).catch((err) => {
      console.error(`[trip-package] restaurant pipeline failed after ${Date.now() - restaurantStart}ms:`, err);
      throw err;
    }),
    withTimeout(
      runActivityPipeline(activityIntent),
      PIPELINE_TIMEOUT_MS,
      "activity pipeline timed out after 45s"
    ).then((v) => {
      console.log(`[trip-package] activity pipeline done in ${Date.now() - activityStart}ms`, {
        results: v.activityRecommendations?.length ?? 0,
        missing: v.missing_fields,
      });
      return v;
    }).catch((err) => {
      console.error(`[trip-package] activity pipeline failed after ${Date.now() - activityStart}ms:`, err);
      throw err;
    }),
  ]);

  const hotel = extractHotel(hotelOutcome);
  const flight = extractFlight(flightOutcome);
  const restaurant = extractRestaurant(restaurantOutcome);
  const activity = extractActivity(activityOutcome);

  const errors: TripPackageErrors = {
    hotel: hotel.error,
    flight: flight.error,
    restaurant: restaurant.error,
    activity: activity.error,
  };

  const pkg: TripPackage = {
    id: randomUUID(),
    scenario: "trip",
    destination_city: state.destination_city!,
    departure_city: state.departure_city!,
    date_range: { from: startDate, to: endDate },
    traveler_count: travelers,
    hotel_options: hotel.options.slice(0, OPTIONS_PER_CATEGORY),
    flight_options: flight.options.slice(0, OPTIONS_PER_CATEGORY),
    restaurant_options: restaurant.options.slice(0, OPTIONS_PER_CATEGORY),
    activity_options: activity.options.slice(0, OPTIONS_PER_CATEGORY),
    errors,
    planning_assumptions: state.planning_assumptions,
  };

  return { package: pkg, errors };
}

// ─── Pipeline intent builders ─────────────────────────────────────────────

function buildHotelIntent(
  state: TripIntentState,
  startDate: string,
  endDate: string,
  nights: number,
  travelers: number
): HotelIntent {
  const location = state.hotel_neighborhood
    ? `${state.hotel_neighborhood}, ${state.destination_city}`
    : state.destination_city!;
  return {
    category: "hotel",
    location,
    check_in: startDate,
    check_out: endDate,
    nights,
    guests: travelers,
    star_rating: state.hotel_star_rating,
    neighborhood: state.hotel_neighborhood,
    budget_total: state.budget_total,
    purpose: "city_trip",
    priorities: [state.vibe],
  };
}

function buildFlightIntent(
  state: TripIntentState,
  startDate: string,
  endDate: string,
  travelers: number
): FlightIntent {
  return {
    category: "flight",
    departure_city: state.departure_city,
    arrival_city: state.destination_city,
    date: startDate,
    return_date: endDate,
    is_round_trip: true,
    passengers: travelers,
    cabin_class: state.vibe === "upscale" ? "business" : "economy",
    prefer_direct: state.vibe === "upscale" ? true : undefined,
  };
}

function buildRestaurantReqs(
  state: TripIntentState,
  travelers: number
): UserRequirements {
  const cuisine =
    state.cuisine_preferences.length > 0
      ? state.cuisine_preferences.join(", ")
      : state.vibe === "upscale"
      ? "fine dining"
      : state.vibe === "local"
      ? "local cuisine"
      : "popular local dining";

  return {
    cuisine,
    location: state.destination_city,
    purpose: "dining",
    atmosphere:
      state.vibe === "upscale"
        ? ["upscale", "refined"]
        : state.vibe === "trendy"
        ? ["trendy", "lively"]
        : state.vibe === "local"
        ? ["casual", "neighborhood"]
        : ["popular", "well-reviewed"],
    party_size: travelers,
  };
}

function buildActivityIntent(
  state: TripIntentState,
  startDate: string,
  endDate: string,
  travelers: number
): ActivityIntent {
  const joined = state.activities.join(" ").toLowerCase();
  let event_type: ActivityIntent["event_type"];
  if (/opera|broadway|musical|theater|play/.test(joined)) event_type = "theater";
  else if (/concert|music|band|singer/.test(joined)) event_type = "concert";
  else if (/sport|game|nba|nfl|nhl|mlb|basketball|football|baseball|hockey/.test(joined)) event_type = "sports";
  else if (/comedy|stand.?up/.test(joined)) event_type = "comedy";
  else if (/festival|fest/.test(joined)) event_type = "festival";
  // Best-effort event name: first non-trivial word (e.g. "Hamilton", "Knicks").
  const firstSpecific = state.activities.find(
    (a) => a.length > 3 && !/^(food|dining|restaurant|show|activity|activities|event|events)$/i.test(a)
  );

  return {
    category: "activity",
    event_type,
    event_name: firstSpecific,
    city: state.destination_city,
    date_from: startDate,
    date_to: endDate,
    num_tickets: travelers,
  };
}

// ─── Pipeline outcome → option list + error message ───────────────────────

function extractHotel(
  outcome: PromiseSettledResult<Awaited<ReturnType<typeof runHotelPipeline>>>
): { options: HotelRecommendationCard[]; error: string | null } {
  if (outcome.status === "rejected") {
    return { options: [], error: msg(outcome.reason, "hotel search failed") };
  }
  const cards = outcome.value.hotelRecommendations ?? [];
  if (cards.length === 0) return { options: [], error: "No matching hotels were returned." };
  return { options: cards, error: null };
}

function extractFlight(
  outcome: PromiseSettledResult<Awaited<ReturnType<typeof runFlightPipeline>>>
): { options: FlightRecommendationCard[]; error: string | null } {
  if (outcome.status === "rejected") {
    return { options: [], error: msg(outcome.reason, "flight search failed") };
  }
  const cards = outcome.value.flightRecommendations ?? [];
  if (cards.length === 0) {
    const missing = outcome.value.missing_fields;
    if (missing && missing.length > 0) {
      return { options: [], error: `Flight search missing: ${missing.join(", ")}` };
    }
    return { options: [], error: "No matching flights were returned." };
  }
  return { options: cards, error: null };
}

function extractRestaurant(
  outcome: PromiseSettledResult<{ cards: RecommendationCard[]; suggested_refinements: string[] }>
): { options: RecommendationCard[]; error: string | null } {
  if (outcome.status === "rejected") {
    return { options: [], error: msg(outcome.reason, "restaurant search failed") };
  }
  const cards = outcome.value.cards ?? [];
  if (cards.length === 0) {
    return { options: [], error: "No matching restaurants were returned." };
  }
  return { options: cards, error: null };
}

function extractActivity(
  outcome: PromiseSettledResult<Awaited<ReturnType<typeof runActivityPipeline>>>
): { options: ActivityRecommendationCard[]; error: string | null } {
  if (outcome.status === "rejected") {
    return { options: [], error: msg(outcome.reason, "activity search failed") };
  }
  const cards = outcome.value.activityRecommendations ?? [];
  if (cards.length === 0) {
    const missing = outcome.value.missing_fields;
    if (missing && missing.length > 0) {
      return { options: [], error: `Activity search missing: ${missing.join(", ")}` };
    }
    return { options: [], error: "No matching activities were returned." };
  }
  return { options: cards, error: null };
}

function msg(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message.slice(0, 200);
  if (typeof reason === "string") return reason.slice(0, 200);
  return fallback;
}

// ─── Destination city → CITIES id ─────────────────────────────────────────
// Maps "New York" → "newyork", "San Francisco" → "sf", etc. Used to route the
// restaurant pipeline's location search to the correct CITIES config.

function resolveCityId(cityName: string): string {
  const trimmed = cityName.trim().toLowerCase();
  const normalized = trimmed.replace(/\s+/g, "").replace(/[,.].*$/, "");
  if (CITIES[normalized]) return normalized;
  for (const [id, cfg] of Object.entries(CITIES)) {
    if (cfg.label.toLowerCase() === trimmed) return id;
    if (cfg.fullName.toLowerCase().startsWith(trimmed)) return id;
  }
  // Special-case NYC variants the CITIES table doesn't have under "newyorkcity".
  if (/^(new\s?york|nyc|ny)$/i.test(cityName.trim())) return "newyork";
  return DEFAULT_CITY;
}

// ─── Date + timeout helpers ───────────────────────────────────────────────

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}
