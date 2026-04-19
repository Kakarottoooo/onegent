/**
 * Hotel search adapter for Decision Room.
 *
 * The merge engines (`two-party.ts` / `n-party.ts`) produce a compound natural-
 * language query from N users' soft constraints. This adapter takes that
 * query, parses it into a `HotelIntent`, overrides the hard fields with the
 * Room's authoritative context (check_in/out/guests/location), runs the
 * existing hotel pipeline, and returns card candidates.
 *
 * Dates and guest count are Room context, NOT per-member constraints — all
 * members are booking the SAME stay. See `ROOM_CONFLICT_CONFIGS.hotel` for
 * the corresponding prompt directive.
 */

import { CITIES, DEFAULT_CITY } from "@/lib/cities";
import { parseHotelIntent } from "@/lib/agent/parse/hotel";
import { runHotelPipeline } from "@/lib/agent/pipelines/hotel";
import type { HotelIntent, HotelRecommendationCard } from "@/lib/types";

export interface HotelRoomContext {
  /** CITIES.id, e.g. "losangeles". Falls back to DEFAULT_CITY. */
  cityId?: string;
  /** Free-text destination (e.g. "Tokyo", "Paris"). Overrides cityId when set. */
  destination?: string;
  /** YYYY-MM-DD. If unset, parser attempts to extract from mergedQuery. */
  checkIn?: string;
  checkOut?: string;
  /** Number of guests. Defaults to room member count when caller knows it. */
  guests?: number;
}

export interface HotelSearchResult {
  cards: HotelRecommendationCard[];
  /** The HotelIntent actually used for the search — useful for debugging. */
  intent: HotelIntent;
}

/**
 * Run a hotel search for a Decision Room.
 *
 * Call sequence:
 *   1. parse soft constraints (budget, vibe, amenities, star rating) from
 *      the merged natural-language query via MiniMax
 *   2. override hard fields (location, check_in, check_out, guests) with
 *      Room context — context is authoritative
 *   3. runHotelPipeline returns ranked candidates
 */
export async function runAgentForHotel(
  mergedQuery: string,
  context: HotelRoomContext,
): Promise<HotelSearchResult> {
  const city = CITIES[context.cityId ?? ""] ?? CITIES[DEFAULT_CITY];
  const cityFullName = context.destination || city.fullName;

  // Step 1 — soft constraint extraction from natural language
  const parsed = await parseHotelIntent(mergedQuery, cityFullName);

  // Step 2 — Room context overrides. Dates + guests + location are group-level
  // facts, not individual constraints, so the caller's context wins.
  const intent: HotelIntent = {
    ...parsed,
    category: "hotel",
    location: cityFullName,
    check_in: context.checkIn ?? parsed.check_in,
    check_out: context.checkOut ?? parsed.check_out,
    guests: context.guests ?? parsed.guests,
  };

  // Step 3 — existing pipeline
  const { hotelRecommendations } = await runHotelPipeline(intent, [], cityFullName);

  return { cards: hotelRecommendations, intent };
}
