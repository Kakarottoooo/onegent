/**
 * Per-scenario shapes for `decision_room_constraints.data_json`.
 *
 * The DB column is `JSONB`, so these are advisory TypeScript contracts used by
 * both the frontend constraint editor and the backend flattener
 * (`constraintRowToText` in ./propose.ts). Adding a new Room type = adding a
 * new shape here and a new branch in `constraintRowToText`.
 */

import type { RoomScenarioId } from "@/lib/agent/scenario-configs/room-conflict";

export interface RestaurantConstraintData {
  budget_max?: number; // per-person USD ceiling
  cuisines_like?: string[];
  cuisines_dislike?: string[];
  dietary?: string[]; // e.g. "vegan", "halal", "gluten-free"
  vibe?: string; // "quiet" | "lively" | "romantic" | "casual" | ...
  time_preference?: string; // e.g. "early dinner", "late-night"
  notes?: string;
}

export interface HotelConstraintData {
  /** Max price per night, in USD. Group cap = LOWEST across members. */
  budget_max_per_night?: number;
  /** Free-text neighborhood preference, e.g. "downtown", "near airport". */
  neighborhood?: string;
  /** Minimum star rating (1-5). Group floor = HIGHEST across members. */
  star_rating_min?: number;
  /** "quiet" | "lively" | "romantic" | "family-friendly" | "business" */
  vibe?: string;
  /** UNION across members: pool, gym, breakfast, parking, pet-friendly, wifi, etc. */
  amenities?: string[];
  /** Catch-all free-text notes (e.g. "wheelchair accessible", "honeymoon suite"). */
  notes?: string;
}

export interface FlightConstraintData {
  /** Max total price per person, USD. Group cap = LOWEST across members. */
  budget_max_per_person?: number;
  /** Stop ceiling: 0 = nonstop only, 1 = at most one stop, 2 = any. Group = STRICTEST. */
  max_stops?: 0 | 1 | 2;
  /** Earliest departure local time, "HH:MM" 24h. Intersection across members. */
  earliest_departure?: string;
  /** Latest departure local time, "HH:MM" 24h. Intersection across members. */
  latest_departure?: string;
  /** Any member =true triggers avoidance for the group. */
  avoid_red_eye?: boolean;
  /** Preferred cabin class. Group floor = HIGHEST (first > business > premium_economy > economy). */
  cabin_class_min?: "economy" | "premium_economy" | "business" | "first";
  /** UNION soft bias: IATA/airline names preferred. */
  preferred_airlines?: string[];
  /** Hard exclusion: airlines the person refuses to fly. */
  avoid_airlines?: string[];
  /** Catch-all free-text notes (e.g. "aisle seat", "extra legroom"). */
  notes?: string;
}

export type RoomConstraintData<T extends RoomScenarioId = RoomScenarioId> =
  T extends "restaurant" ? RestaurantConstraintData :
  T extends "hotel" ? HotelConstraintData :
  T extends "flight" ? FlightConstraintData :
  never;
