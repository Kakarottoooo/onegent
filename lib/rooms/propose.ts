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
import type { RecommendationCard, HotelRecommendationCard } from "@/lib/types";
import type { DecisionRoom, DecisionRoomConstraintRow } from "@/lib/db";
import type { RoomScenarioId } from "@/lib/agent/scenario-configs/room-conflict";
import type {
  RestaurantConstraintData,
  HotelConstraintData,
} from "@/lib/rooms/constraint-types";

/** A proposal card is one of the scenario-specific card shapes. */
export type ProposalCard = RecommendationCard | HotelRecommendationCard;

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
  }
}

/** Narrow `room.type` to our supported scenario union. */
function assertScenarioId(t: string): RoomScenarioId {
  if (t === "restaurant" || t === "hotel") return t;
  throw new Error(`Unsupported room type: ${t}`);
}

interface HotelRoomContextJson {
  city_id?: string;
  city?: string;
  destination?: string;
  date_window?: { from?: string | null; to?: string | null } | null;
  check_in?: string;
  check_out?: string;
  guests?: number;
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

  const ctx = room.context_json as HotelRoomContextJson;
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
  } else {
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
  }

  if (cards.length === 0) {
    throw new Error(
      conflictReason
        ? `No ${scenarioId === "hotel" ? "hotels" : "restaurants"} matched — conflict: ${conflictReason}`
        : `No ${scenarioId === "hotel" ? "hotels" : "restaurants"} matched the combined constraints`
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
