/**
 * Decision Room proposal generator.
 *
 * Flattens each member's structured constraints into a natural-language clause,
 * merges them via the 2-party or N-party engine, runs the scenario-specific
 * search pipeline, and returns up to 5 option cards for the group to pick from.
 * Members vote for their preferred option; acceptance follows the room's
 * `approval_rule` (unanimous = everyone picks the same option; majority = one
 * option's supporters exceed N/2).
 *
 * Engine choice:
 *   N = 2 → `mergeTwoPartyQuery` / `runAgentForTwoParty` (pair-tuned prompt)
 *   N ≥ 3 → `mergeNPartyQuery`   / `runAgentForNParty`   (group-tuned prompt)
 *
 * Scenario choice (dispatched on `room.type`):
 *   restaurant → existing restaurant agent (runAgentFor*Party)
 *   hotel      → `runAgentForHotel` with Room-context overrides for dates/guests
 */

import { randomUUID } from "crypto";
import {
  runAgentForTwoParty,
  mergeTwoPartyQuery,
} from "@/lib/agent/two-party";
import {
  runAgentForNParty,
  mergeNPartyQuery,
} from "@/lib/agent/n-party";
import { runAgentForHotel } from "@/lib/rooms/hotel-search";
import { runAgentForFlight } from "@/lib/rooms/flight-search";
import { runAgentForActivity } from "@/lib/rooms/activity-search";
import type {
  RecommendationCard,
  HotelRecommendationCard,
  FlightRecommendationCard,
  ActivityRecommendationCard,
  ActivityEventType,
} from "@/lib/types";
import type { DecisionRoom, DecisionRoomConstraintRow } from "@/lib/db";
import type { RoomScenarioId } from "@/lib/agent/scenario-configs/room-conflict";
import type {
  RestaurantConstraintData,
  HotelConstraintData,
  FlightConstraintData,
  ActivityConstraintData,
} from "@/lib/rooms/constraint-types";

/** A proposal card is one of the scenario-specific card shapes. */
export type ProposalCard =
  | RecommendationCard
  | HotelRecommendationCard
  | FlightRecommendationCard
  | ActivityRecommendationCard;

export interface ProposalOption {
  id: string;
  card: ProposalCard;
}

export interface ProposalGenerationResult {
  options: ProposalOption[];
  rationale: string;
  conflicts: Array<{ field: string; reason: string; affected_users: string[] }>;
}

function restaurantRowToText(d: RestaurantConstraintData): string {
  const parts: string[] = [];
  if (typeof d.budget_max === "number") parts.push(`budget under $${d.budget_max} per person`);
  if (d.cuisines_like?.length) parts.push(`likes ${d.cuisines_like.join(", ")}`);
  if (d.cuisines_dislike?.length) parts.push(`avoids ${d.cuisines_dislike.join(", ")}`);
  if (d.dietary?.length) parts.push(`dietary: ${d.dietary.join(", ")}`);
  if (d.vibe) parts.push(`${d.vibe} vibe`);
  if (d.time_preference) parts.push(`time: ${d.time_preference}`);
  if (d.notes) parts.push(d.notes);
  return parts.join("; ") || "no specific constraints";
}

function hotelRowToText(d: HotelConstraintData): string {
  const parts: string[] = [];
  if (typeof d.budget_max_per_night === "number") parts.push(`budget under $${d.budget_max_per_night} per night`);
  if (typeof d.star_rating_min === "number") parts.push(`at least ${d.star_rating_min}-star`);
  if (d.neighborhood) parts.push(`near ${d.neighborhood}`);
  if (d.vibe) parts.push(`${d.vibe} vibe`);
  if (d.amenities?.length) parts.push(`amenities: ${d.amenities.join(", ")}`);
  if (d.notes) parts.push(d.notes);
  return parts.join("; ") || "no specific constraints";
}

function activityRowToText(d: ActivityConstraintData): string {
  const parts: string[] = [];
  if (typeof d.budget_max_per_ticket === "number") parts.push(`budget under $${d.budget_max_per_ticket} per ticket`);
  if (d.seat_type === "premium") parts.push(`premium seating`);
  else if (d.seat_type === "standard") parts.push(`standard seating`);
  else if (d.seat_type === "economy") parts.push(`economy seating`);
  if (d.section_preferences?.length) parts.push(`prefer sections: ${d.section_preferences.join(", ")}`);
  if (d.avoid_sections?.length) parts.push(`avoid sections: ${d.avoid_sections.join(", ")}`);
  if (d.accessibility?.wheelchair) parts.push(`wheelchair accessible required`);
  if (d.accessibility?.companion_seat) parts.push(`companion seat required`);
  if (d.delivery_preference) parts.push(`delivery: ${d.delivery_preference}`);
  if (d.notes) parts.push(d.notes);
  return parts.join("; ") || "no specific constraints";
}

function flightRowToText(d: FlightConstraintData): string {
  const parts: string[] = [];
  if (typeof d.budget_max_per_person === "number") parts.push(`budget under $${d.budget_max_per_person} per person`);
  if (d.cabin_class_min) parts.push(`at least ${d.cabin_class_min.replace("_", " ")} class`);
  if (d.max_stops === 0) parts.push(`nonstop only`);
  else if (d.max_stops === 1) parts.push(`at most one stop`);
  if (d.earliest_departure) parts.push(`depart no earlier than ${d.earliest_departure}`);
  if (d.latest_departure) parts.push(`depart no later than ${d.latest_departure}`);
  if (d.avoid_red_eye) parts.push(`avoid red-eye flights`);
  if (d.preferred_airlines?.length) parts.push(`prefer airlines: ${d.preferred_airlines.join(", ")}`);
  if (d.avoid_airlines?.length) parts.push(`avoid airlines: ${d.avoid_airlines.join(", ")}`);
  if (d.notes) parts.push(d.notes);
  return parts.join("; ") || "no specific constraints";
}

/**
 * Flatten a structured constraint object into a natural-language clause.
 * Scenario-agnostic — dispatches on the caller-provided `scenarioId`.
 */
export function constraintRowToText(
  row: DecisionRoomConstraintRow,
  scenarioId: RoomScenarioId,
): string {
  switch (scenarioId) {
    case "restaurant":
      return restaurantRowToText(row.data_json as RestaurantConstraintData);
    case "hotel":
      return hotelRowToText(row.data_json as HotelConstraintData);
    case "flight":
      return flightRowToText(row.data_json as FlightConstraintData);
    case "activity":
      return activityRowToText(row.data_json as ActivityConstraintData);
  }
}

/** Narrow `room.type` to our supported scenario union. */
function assertScenarioId(t: string): RoomScenarioId {
  if (t === "restaurant" || t === "hotel" || t === "flight" || t === "activity") return t;
  throw new Error(`Unsupported room type: ${t}`);
}

interface RoomContextJson {
  city_id?: string;
  city?: string;
  // Hotel fields
  destination?: string;
  date_window?: { from?: string | null; to?: string | null } | null;
  check_in?: string;
  check_out?: string;
  guests?: number;
  // Flight fields
  departure_city?: string;
  arrival_city?: string;
  departure_date?: string;
  return_date?: string;
  is_round_trip?: boolean;
  passengers?: number;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";
  // Activity fields
  event_name?: string;
  event_type?: ActivityEventType;
  event_date?: string;
  event_date_to?: string;
  venue_hint?: string;
  num_tickets?: number;
}

/**
 * Generate a proposal for a Decision Room. Requires ≥2 submitted constraints.
 * Returns up to 5 option cards (shape depends on `room.type`).
 */
export async function generateRoomProposal(
  room: DecisionRoom,
  constraints: DecisionRoomConstraintRow[]
): Promise<ProposalGenerationResult | null> {
  const scenarioId = assertScenarioId(room.type);

  const submitted = constraints.filter((c) => c.submitted);
  if (submitted.length < 2) return null;

  const ctx = room.context_json as RoomContextJson;
  const cityId = ctx.city_id ?? ctx.city ?? "losangeles";

  // Flatten constraints to text, N-aware for prompt tuning.
  const isTwoParty = submitted.length === 2;
  let cards: ProposalCard[] = [];
  let conflict = false;
  let conflictReason: string | undefined;
  let affectedUsers: string[] = [];
  let rationaleTail: string;

  if (scenarioId === "restaurant") {
    // Restaurant path: the existing run*Party wrappers both merge AND search.
    if (isTwoParty) {
      const [a, b] = submitted;
      const aText = constraintRowToText(a, "restaurant");
      const bText = constraintRowToText(b, "restaurant");
      const result = await runAgentForTwoParty(aText, bText, cityId);
      cards = result.options;
      conflict = result.conflict;
      conflictReason = result.conflictReason;
      if (conflict) affectedUsers = submitted.map((s) => s.user_id);
      rationaleTail = `${aText} / ${bText}`;
    } else {
      const inputs = submitted.map((c) => ({
        userId: c.user_id,
        text: constraintRowToText(c, "restaurant"),
      }));
      const result = await runAgentForNParty(inputs, cityId);
      cards = result.options;
      conflict = result.conflict;
      conflictReason = result.conflictReason;
      affectedUsers = conflict
        ? result.conflictAffectedUsers?.length
          ? result.conflictAffectedUsers
          : submitted.map((s) => s.user_id)
        : [];
      rationaleTail = inputs.map((p) => p.text).join(" | ");
    }
  } else if (scenarioId === "hotel") {
    // Hotel path: merge → runAgentForHotel (merge and search are decoupled so
    // the caller can override dates/guests from Room context).
    const hotelCtx = {
      cityId,
      destination: ctx.destination,
      checkIn: ctx.check_in ?? ctx.date_window?.from ?? undefined,
      checkOut: ctx.check_out ?? ctx.date_window?.to ?? undefined,
      guests: ctx.guests,
    };

    let mergedQuery: string;
    if (isTwoParty) {
      const [a, b] = submitted;
      const aText = constraintRowToText(a, "hotel");
      const bText = constraintRowToText(b, "hotel");
      const merged = await mergeTwoPartyQuery("hotel", aText, bText, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      if (conflict) affectedUsers = submitted.map((s) => s.user_id);
      rationaleTail = `${aText} / ${bText}`;
    } else {
      const inputs = submitted.map((c) => ({
        userId: c.user_id,
        text: constraintRowToText(c, "hotel"),
      }));
      const merged = await mergeNPartyQuery("hotel", inputs, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      affectedUsers = conflict
        ? merged.conflictAffectedUsers?.length
          ? merged.conflictAffectedUsers
          : submitted.map((s) => s.user_id)
        : [];
      rationaleTail = inputs.map((p) => p.text).join(" | ");
    }

    const hotelResult = await runAgentForHotel(mergedQuery, hotelCtx);
    cards = hotelResult.cards;
  } else if (scenarioId === "flight") {
    // Flight path: merge → runAgentForFlight. Route/dates/round-trip/cabin are
    // authoritative Room context; per-member constraints provide soft
    // preferences (stops, time window, red-eye, airlines).
    const flightCtx = {
      cityId,
      departureCity: ctx.departure_city,
      arrivalCity: ctx.arrival_city,
      date: ctx.departure_date ?? ctx.date_window?.from ?? undefined,
      returnDate: ctx.return_date ?? ctx.date_window?.to ?? undefined,
      isRoundTrip: ctx.is_round_trip,
      passengers: ctx.passengers,
      cabinClass: ctx.cabin_class,
    };

    let mergedQuery: string;
    if (isTwoParty) {
      const [a, b] = submitted;
      const aText = constraintRowToText(a, "flight");
      const bText = constraintRowToText(b, "flight");
      const merged = await mergeTwoPartyQuery("flight", aText, bText, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      if (conflict) affectedUsers = submitted.map((s) => s.user_id);
      rationaleTail = `${aText} / ${bText}`;
    } else {
      const inputs = submitted.map((c) => ({
        userId: c.user_id,
        text: constraintRowToText(c, "flight"),
      }));
      const merged = await mergeNPartyQuery("flight", inputs, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      affectedUsers = conflict
        ? merged.conflictAffectedUsers?.length
          ? merged.conflictAffectedUsers
          : submitted.map((s) => s.user_id)
        : [];
      rationaleTail = inputs.map((p) => p.text).join(" | ");
    }

    const flightResult = await runAgentForFlight(mergedQuery, flightCtx);
    if (flightResult.missingFields.length) {
      throw new Error(
        `Flight search missing required fields: ${flightResult.missingFields.join(", ")}. Set them in the Room context.`,
      );
    }
    cards = flightResult.cards;
  } else {
    // Activity path: merge → runAgentForActivity. event_name/event_type/city/
    // date are authoritative Room context; per-member constraints provide soft
    // preferences (budget, seat tier, section bias, accessibility).
    const activityCtx = {
      cityId,
      city: ctx.city ?? ctx.destination,
      eventName: ctx.event_name,
      eventType: ctx.event_type,
      dateFrom: ctx.event_date ?? ctx.date_window?.from ?? undefined,
      dateTo: ctx.event_date_to ?? ctx.event_date ?? ctx.date_window?.to ?? undefined,
      numTickets: ctx.num_tickets ?? submitted.length,
      venueHint: ctx.venue_hint,
    };

    let mergedQuery: string;
    if (isTwoParty) {
      const [a, b] = submitted;
      const aText = constraintRowToText(a, "activity");
      const bText = constraintRowToText(b, "activity");
      const merged = await mergeTwoPartyQuery("activity", aText, bText, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      if (conflict) affectedUsers = submitted.map((s) => s.user_id);
      rationaleTail = `${aText} / ${bText}`;
    } else {
      const inputs = submitted.map((c) => ({
        userId: c.user_id,
        text: constraintRowToText(c, "activity"),
      }));
      const merged = await mergeNPartyQuery("activity", inputs, cityId);
      mergedQuery = merged.mergedQuery;
      conflict = merged.conflict;
      conflictReason = merged.conflictReason;
      affectedUsers = conflict
        ? merged.conflictAffectedUsers?.length
          ? merged.conflictAffectedUsers
          : submitted.map((s) => s.user_id)
        : [];
      rationaleTail = inputs.map((p) => p.text).join(" | ");
    }

    const activityResult = await runAgentForActivity(mergedQuery, activityCtx);
    if (activityResult.missingFields.length) {
      throw new Error(
        `Activity search missing required fields: ${activityResult.missingFields.join(", ")}. Set them in the Room context.`,
      );
    }
    cards = activityResult.cards;
  }

  if (cards.length === 0) {
    const nounPlural =
      scenarioId === "hotel" ? "hotels" :
      scenarioId === "flight" ? "flights" :
      scenarioId === "activity" ? "events" :
      "restaurants";
    throw new Error(
      conflictReason
        ? `No ${nounPlural} matched — conflict: ${conflictReason}`
        : `No ${nounPlural} matched the combined constraints`
    );
  }

  const options: ProposalOption[] = cards.slice(0, 5).map((card) => ({
    id: randomUUID(),
    card,
  }));

  const rationale = conflict
    ? `Best compromises despite a conflict (${conflictReason ?? "incompatible preferences"}).`
    : `${options.length} options that match everyone's constraints — ${rationaleTail}`.slice(0, 400);

  const conflicts: ProposalGenerationResult["conflicts"] = conflict
    ? [
        {
          field: "general",
          reason: conflictReason ?? "Constraints conflict",
          affected_users: affectedUsers,
        },
      ]
    : [];

  return { options, rationale, conflicts };
}

/**
 * @deprecated Use `generateRoomProposal` instead — routes on `room.type`.
 * Kept as a thin alias for any lingering callers.
 */
export const generateRestaurantProposal = generateRoomProposal;
