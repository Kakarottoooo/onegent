/**
 * Two-party constraint merge engine for Decision Room.
 *
 * Two modes:
 *   - `mergeTwoPartyQuery(scenarioId, ...)`  — merge-only, returns a compound
 *     query string + conflict flag. Caller runs the search themselves (used by
 *     hotel/flight/etc. scenarios that route to non-restaurant pipelines).
 *   - `runAgentForTwoParty(...)`              — restaurant-only convenience
 *     wrapper that merges AND runs the restaurant agent, returning cards.
 *
 * Conflict detection: if constraints are mutually exclusive (e.g. "vegan only"
 * + "must have steak"), returns conflict=true with a reason + closest options
 * for each side.
 */

import { minimaxChat } from "../minimax";
import { CITIES, DEFAULT_CITY } from "../cities";
import { runAgent } from "../agent";
import type { RecommendationCard } from "../types";
import {
  ROOM_CONFLICT_CONFIGS,
  renderTwoPartyPrompt,
  type RoomScenarioId,
} from "./scenario-configs/room-conflict";

export interface TwoPartyMergeResult {
  options: RecommendationCard[];
  conflict: boolean;
  conflictReason?: string;
}

export interface TwoPartyMergedQuery {
  mergedQuery: string;
  conflict: boolean;
  conflictReason?: string;
}

/**
 * Ask MiniMax to merge two constraint strings into one compound query,
 * detecting conflicts. Scenario-agnostic — reads the prompt template from
 * `ROOM_CONFLICT_CONFIGS[scenarioId]`.
 */
export async function mergeTwoPartyQuery(
  scenarioId: RoomScenarioId,
  initiatorConstraints: string,
  partnerConstraints: string,
  cityId: string,
): Promise<TwoPartyMergedQuery> {
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];
  const cfg = ROOM_CONFLICT_CONFIGS[scenarioId];
  const prompt = renderTwoPartyPrompt(
    cfg,
    initiatorConstraints,
    partnerConstraints,
    city.fullName,
  );

  const text = await minimaxChat({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    // Fallback: just concatenate both queries
    return {
      mergedQuery: `${initiatorConstraints} and also ${partnerConstraints} in ${city.fullName}`,
      conflict: false,
    };
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      merged_query: string;
      conflict: boolean;
      conflict_reason?: string | null;
    };
    return {
      mergedQuery: parsed.merged_query ?? `${initiatorConstraints} and ${partnerConstraints}`,
      conflict: parsed.conflict ?? false,
      conflictReason: parsed.conflict_reason ?? undefined,
    };
  } catch {
    return {
      mergedQuery: `${initiatorConstraints} and also ${partnerConstraints} in ${city.fullName}`,
      conflict: false,
    };
  }
}

/**
 * Restaurant-only wrapper: merges two-party constraints, runs the restaurant
 * agent, and returns up to 5 cards that satisfy both.
 *
 * Hotel / flight / etc. callers should use `mergeTwoPartyQuery` + their own
 * search pipeline instead.
 */
export async function runAgentForTwoParty(
  initiatorConstraints: string,
  partnerConstraints: string,
  cityId: string
): Promise<TwoPartyMergeResult> {
  const { mergedQuery, conflict, conflictReason } = await mergeTwoPartyQuery(
    "restaurant",
    initiatorConstraints,
    partnerConstraints,
    cityId,
  );

  const result = await runAgent(mergedQuery, [], cityId);
  const options = result.recommendations.slice(0, 5) as RecommendationCard[];

  return { options, conflict, conflictReason };
}
