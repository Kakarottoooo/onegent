/**
 * Flight search adapter for Decision Room.
 *
 * Mirror of `hotel-search.ts`: the merge engine produces a compound natural-
 * language query from N members' soft flight constraints. This adapter parses
 * that query into a `FlightIntent`, overrides the hard fields with the Room's
 * authoritative context (departure/arrival city, date, return_date,
 * is_round_trip, passengers, cabin_class), runs `runFlightPipeline`, and
 * returns ranked candidate cards.
 *
 * Route, dates, passenger count, and round-trip flag are group-level facts
 * (stored in `room.context_json`), NOT per-member constraints — all members
 * fly the SAME itinerary. See `ROOM_CONFLICT_CONFIGS.flight` for the
 * corresponding prompt directive.
 */

import { CITIES, DEFAULT_CITY } from "@/lib/cities";
import { parseFlightIntent } from "@/lib/agent/parse/flight";
import { runFlightPipeline } from "@/lib/agent/pipelines/flight";
import type { FlightIntent, FlightRecommendationCard } from "@/lib/types";

export interface FlightRoomContext {
  /** CITIES.id used as the "default city" hint to the parser. Falls back to DEFAULT_CITY. */
  cityId?: string;
  /** Free-text departure city or IATA code (e.g. "San Francisco", "SFO"). Authoritative. */
  departureCity?: string;
  /** Free-text arrival city or IATA code (e.g. "Tokyo", "NRT"). Authoritative. */
  arrivalCity?: string;
  /** YYYY-MM-DD departure date. Authoritative. */
  date?: string;
  /** YYYY-MM-DD return date. Only meaningful when `isRoundTrip=true`. */
  returnDate?: string;
  /** true = round trip, false = one-way. */
  isRoundTrip?: boolean;
  /** Total passengers on the booking. Defaults to member count when caller knows it. */
  passengers?: number;
  /** Floor cabin class. Parser may upgrade from soft constraints. */
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

export interface FlightSearchResult {
  cards: FlightRecommendationCard[];
  /** The FlightIntent actually used — useful for debugging. */
  intent: FlightIntent;
  /** Fields the pipeline could not find — empty when search succeeded. */
  missingFields: string[];
  /** true when caller wanted nonstop but none was available. */
  noDirectAvailable: boolean;
}

/**
 * Run a flight search for a Decision Room.
 *
 * Call sequence:
 *   1. parse soft constraints (stops/time-window/red-eye/cabin) from the
 *      merged natural-language query via MiniMax
 *   2. override hard fields (route, dates, passengers, round-trip flag,
 *      cabin floor) with Room context — context is authoritative
 *   3. runFlightPipeline returns ranked candidates
 */
export async function runAgentForFlight(
  mergedQuery: string,
  context: FlightRoomContext,
): Promise<FlightSearchResult> {
  const city = CITIES[context.cityId ?? ""] ?? CITIES[DEFAULT_CITY];
  const cityFullName = context.departureCity || city.fullName;

  const parsed = await parseFlightIntent(mergedQuery, cityFullName);

  // Raise cabin_class floor to the Room-context minimum. Parser value wins
  // only when it's already >= floor. `premium_economy` is a member-facing
  // preference, but SerpAPI/FlightIntent only exposes three tiers — collapse it
  // down to `economy`.
  const CABIN_RANK = { economy: 0, premium_economy: 1, business: 2, first: 3 } as const;
  const collapse = (c: keyof typeof CABIN_RANK | undefined): FlightIntent["cabin_class"] | undefined =>
    c === "premium_economy" ? "economy" : c;
  const floor = context.cabinClass;
  const parsedCabin = parsed.cabin_class as keyof typeof CABIN_RANK | undefined;
  const winner: keyof typeof CABIN_RANK | undefined = floor
    ? parsedCabin && CABIN_RANK[parsedCabin] >= CABIN_RANK[floor]
      ? parsedCabin
      : floor
    : parsedCabin;
  const chosenCabin = collapse(winner);

  const intent: FlightIntent = {
    ...parsed,
    category: "flight",
    departure_city: context.departureCity ?? parsed.departure_city,
    arrival_city: context.arrivalCity ?? parsed.arrival_city,
    date: context.date ?? parsed.date,
    return_date: context.returnDate ?? parsed.return_date,
    is_round_trip: context.isRoundTrip ?? parsed.is_round_trip,
    passengers: context.passengers ?? parsed.passengers,
    cabin_class: chosenCabin,
  };

  const { flightRecommendations, missing_fields, no_direct_available } =
    await runFlightPipeline(intent);

  return {
    cards: flightRecommendations,
    intent,
    missingFields: missing_fields,
    noDirectAvailable: no_direct_available,
  };
}
