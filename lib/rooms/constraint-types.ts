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

export type RoomConstraintData<T extends RoomScenarioId = RoomScenarioId> =
  T extends "restaurant" ? RestaurantConstraintData :
  T extends "hotel" ? HotelConstraintData :
  never;
