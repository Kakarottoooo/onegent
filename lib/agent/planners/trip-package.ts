/**
 * TripPackage planner — Phase 1 minimal version.
 *
 * Takes a fully-filled TripIntentState and produces a single-tier TripPackage
 * containing one hotel + one flight. Restaurants / activities are out of scope
 * for Phase 1 (Phase 2 will add them).
 *
 * Design:
 *   - hotel + flight pipelines run in parallel via Promise.allSettled so one
 *     failure doesn't sink the other (pattern ADR-6, applied to planning too)
 *   - a missing pipeline returns null in the tier, not an error — the card UI
 *     shows "Flight search failed — retry?" rather than blocking the whole
 *     package
 *   - tier selection: Phase 1 picks the rank=1 recommendation from each
 *     pipeline. Phase 2 will pick per-tier (rank=1 for mid, vibe-weighted for
 *     upscale/local/trendy).
 */
import { randomUUID } from "crypto";
import type {
  FlightIntent,
  FlightRecommendationCard,
  HotelIntent,
  HotelRecommendationCard,
  TripPackage,
  TripTier,
  TripTierId,
} from "../../types";
import { runHotelPipeline } from "../pipelines/hotel";
import { runFlightPipeline } from "../pipelines/flight";
import { resolveDateHint, type TripIntentState } from "../trip-intent-state";

export interface BuildTripPackageResult {
  package: TripPackage;
  /** Per-leg errors surfaced to the UI so the card can show what failed. */
  errors: {
    hotel: string | null;
    flight: string | null;
  };
}

/**
 * Build a single-tier TripPackage from a filled TripIntentState.
 * Caller MUST have validated with getMissingFields(state) first.
 */
export async function buildTripPackage(
  state: TripIntentState,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<BuildTripPackageResult> {
  // Derive concrete dates. Defensive re-normalize in case an upstream caller
  // handed us a relative string ("next weekend"). If resolution still fails,
  // throw a clear error instead of crashing inside `new Date()`.
  const startDate = resolveDateHint(state.start_date);
  if (!startDate) {
    throw new Error(
      `TripPackage planner: start_date "${state.start_date ?? "(missing)"}" is not a valid date — ask the user to pin down an absolute date (e.g. "2026-04-25") and retry.`
    );
  }
  const endDateRaw = state.end_date ? resolveDateHint(state.end_date) : null;
  const endDate = endDateRaw ?? addDays(startDate, state.nights ?? 1);
  const nights = state.nights ?? daysBetween(startDate, endDate);
  const travelers = state.travelers ?? 1;

  const hotelIntent = buildHotelIntent(state, startDate, endDate, nights, travelers);
  const flightIntent = buildFlightIntent(state, startDate, endDate, travelers);

  // Per-pipeline timeout so one hung upstream (SerpAPI 503, MiniMax slow) can't
  // wedge the whole /api/chat/trip/plan call indefinitely.
  const PIPELINE_TIMEOUT_MS = 45_000;

  const hotelStart = Date.now();
  const flightStart = Date.now();

  const [hotelOutcome, flightOutcome] = await Promise.allSettled([
    withTimeout(
      runHotelPipeline(hotelIntent, conversationHistory, state.destination_city!),
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
  ]);

  const hotelCard = pickHotelForTier(hotelOutcome);
  const flightCard = pickFlightForTier(flightOutcome);

  const tier: TripTier = {
    tier_id: vibeToTierId(state.vibe),
    tier_label: vibeToLabel(state.vibe),
    tier_description: vibeToDescription(state.vibe),
    hotel: hotelCard.card,
    flight: flightCard.card,
    restaurants: [], // Phase 2
    activities: state.activities.length > 0 ? [] : null, // null = user had no activity intent
    total_cost_estimate: estimateTotal(hotelCard.card, flightCard.card, nights, travelers),
  };

  const pkg: TripPackage = {
    id: randomUUID(),
    scenario: "trip",
    destination_city: state.destination_city!,
    departure_city: state.departure_city!,
    date_range: { from: startDate, to: endDate },
    traveler_count: travelers,
    tiers: [tier],
    planning_assumptions: state.planning_assumptions,
  };

  return {
    package: pkg,
    errors: {
      hotel: hotelCard.error,
      flight: flightCard.error,
    },
  };
}

// ─── Pipeline adapters ────────────────────────────────────────────────────

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

// ─── Tier picking ─────────────────────────────────────────────────────────

function pickHotelForTier(
  outcome: PromiseSettledResult<
    Awaited<ReturnType<typeof runHotelPipeline>>
  >
): { card: HotelRecommendationCard | null; error: string | null } {
  if (outcome.status === "rejected") {
    return {
      card: null,
      error: extractErrorMessage(outcome.reason, "hotel search failed"),
    };
  }
  const cards = outcome.value.hotelRecommendations ?? [];
  if (cards.length === 0) {
    return { card: null, error: "No matching hotels were returned." };
  }
  return { card: cards[0], error: null };
}

function pickFlightForTier(
  outcome: PromiseSettledResult<
    Awaited<ReturnType<typeof runFlightPipeline>>
  >
): { card: FlightRecommendationCard | null; error: string | null } {
  if (outcome.status === "rejected") {
    return {
      card: null,
      error: extractErrorMessage(outcome.reason, "flight search failed"),
    };
  }
  const cards = outcome.value.flightRecommendations ?? [];
  if (cards.length === 0) {
    const missing = outcome.value.missing_fields;
    if (missing && missing.length > 0) {
      return { card: null, error: `Flight search missing: ${missing.join(", ")}` };
    }
    return { card: null, error: "No matching flights were returned." };
  }
  return { card: cards[0], error: null };
}

function extractErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message.slice(0, 200);
  if (typeof reason === "string") return reason.slice(0, 200);
  return fallback;
}

// ─── Vibe → tier metadata ─────────────────────────────────────────────────

function vibeToTierId(vibe: TripIntentState["vibe"]): TripTierId {
  if (vibe === "upscale") return "upscale";
  if (vibe === "local") return "local";
  return "trendy"; // "mixed" and "trendy" both map to trendy for the mid-tier label
}

function vibeToLabel(vibe: TripIntentState["vibe"]): string {
  if (vibe === "upscale") return "Upscale";
  if (vibe === "local") return "Local vibe";
  return "Trendy";
}

function vibeToDescription(vibe: TripIntentState["vibe"]): string {
  if (vibe === "upscale") {
    return "Highest hotel quality and premium cabin flight. Costs more but delivers the most polished experience.";
  }
  if (vibe === "local") {
    return "Neighborhood hotel, authentic vibe. Avoids tourist traps and keeps the budget lean.";
  }
  return "Hip neighborhood hotel + solid economy flight. Balanced pick for most travelers.";
}

// ─── Cost estimation ──────────────────────────────────────────────────────

function estimateTotal(
  hotel: HotelRecommendationCard | null,
  flight: FlightRecommendationCard | null,
  nights: number,
  travelers: number
): number | undefined {
  if (!hotel && !flight) return undefined;
  let total = 0;
  if (hotel) total += (hotel.hotel.total_price || hotel.hotel.price_per_night * nights);
  if (flight) total += flight.flight.price * travelers;
  return total > 0 ? Math.round(total) : undefined;
}

// ─── Date helpers (duplicated from trip-intent-state to keep deps local) ──

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

/**
 * Race a promise against a timeout. Rejects with a clear message if the inner
 * promise doesn't settle in `ms` — catch it at the call site so the sibling
 * pipeline still reports normally.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(label)), ms)
    ),
  ]);
}
