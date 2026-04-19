/**
 * N-party constraint merge engine for Decision Room (N >= 3).
 *
 * Two modes, mirroring two-party.ts:
 *   - `mergeNPartyQuery(scenarioId, ...)`  — merge-only, for non-restaurant
 *     scenarios that run their own search pipeline.
 *   - `runAgentForNParty(...)`              — restaurant-only wrapper that
 *     merges AND runs the restaurant agent.
 *
 * For N=2 callers should keep using two-party.ts — its prompt is tuned for
 * pair dynamics ("both agree on"). This engine is tuned for groups.
 */

import { minimaxChat } from "../minimax";
import { CITIES, DEFAULT_CITY } from "../cities";
import { runAgent } from "../agent";
import type { RecommendationCard } from "../types";
import {
  ROOM_CONFLICT_CONFIGS,
  renderNPartyPrompt,
  type RoomScenarioId,
} from "./scenario-configs/room-conflict";

export interface NPartyMergeResult {
  options: RecommendationCard[];
  conflict: boolean;
  conflictReason?: string;
  /** user_ids whose constraints are in tension, when conflict=true. */
  conflictAffectedUsers?: string[];
}

export interface NPartyInput {
  userId: string;
  /** Natural-language constraint sentence already flattened by the caller. */
  text: string;
}

export interface NPartyMergedQuery {
  mergedQuery: string;
  conflict: boolean;
  conflictReason?: string;
  conflictAffectedUsers?: string[];
}

/**
 * Merge N users' constraints into ONE compound query. Scenario-agnostic —
 * reads the prompt template from `ROOM_CONFLICT_CONFIGS[scenarioId]`.
 */
export async function mergeNPartyQuery(
  scenarioId: RoomScenarioId,
  inputs: NPartyInput[],
  cityId: string,
): Promise<NPartyMergedQuery> {
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];
  const cfg = ROOM_CONFLICT_CONFIGS[scenarioId];

  const enumerated = inputs
    .map((p, i) => `Person ${String.fromCharCode(65 + i)} (id=${p.userId}): "${p.text}"`)
    .join("\n");

  const prompt = renderNPartyPrompt(cfg, enumerated, inputs.length, city.fullName);

  const text = await minimaxChat({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 400,
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      mergedQuery: inputs.map((p) => p.text).join("; also: ") + ` in ${city.fullName}`,
      conflict: false,
    };
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      merged_query: string;
      conflict: boolean;
      conflict_reason?: string | null;
      affected_user_ids?: string[] | null;
    };
    return {
      mergedQuery:
        parsed.merged_query ?? inputs.map((p) => p.text).join("; also: "),
      conflict: parsed.conflict ?? false,
      conflictReason: parsed.conflict_reason ?? undefined,
      conflictAffectedUsers: parsed.affected_user_ids ?? undefined,
    };
  } catch {
    return {
      mergedQuery: inputs.map((p) => p.text).join("; also: ") + ` in ${city.fullName}`,
      conflict: false,
    };
  }
}

/**
 * Restaurant-only wrapper: merge N-party constraints, run the restaurant
 * agent, return up to 5 group-friendly cards.
 *
 * Hotel / flight / etc. callers should use `mergeNPartyQuery` + their own
 * search pipeline instead.
 */
export async function runAgentForNParty(
  inputs: NPartyInput[],
  cityId: string
): Promise<NPartyMergeResult> {
  if (inputs.length === 0) {
    return { options: [], conflict: false };
  }

  const { mergedQuery, conflict, conflictReason, conflictAffectedUsers } =
    await mergeNPartyQuery("restaurant", inputs, cityId);

  const result = await runAgent(mergedQuery, [], cityId);
  const options = result.recommendations.slice(0, 5) as RecommendationCard[];

  return { options, conflict, conflictReason, conflictAffectedUsers };
}
