/**
 * Two-party constraint merge engine for Decision Room (Phase 4).
 *
 * Takes natural-language constraints from two people, merges them into a
 * single compound restaurant query, runs the existing agent pipeline,
 * and returns up to 5 options that satisfy both.
 *
 * Conflict detection: if constraints are mutually exclusive (e.g. "vegan only"
 * + "must have steak"), returns conflict=true with a reason + closest options
 * for each side.
 */

import { minimaxChat } from "../minimax";
import { CITIES, DEFAULT_CITY } from "../cities";
import { runAgent } from "../agent";
import type { RecommendationCard } from "../types";

export interface TwoPartyMergeResult {
  options: RecommendationCard[];
  conflict: boolean;
  conflictReason?: string;
}

/** Ask MiniMax to merge two constraint strings into one compound query, detecting conflicts. */
async function buildMergedQuery(
  initiatorConstraints: string,
  partnerConstraints: string,
  cityFullName: string
): Promise<{ mergedQuery: string; conflict: boolean; conflictReason?: string }> {
  const text = await minimaxChat({
    messages: [
      {
        role: "user",
        content: `Two people need to find a restaurant they'll both agree on. Merge their individual constraints into ONE compound search query, and detect if they conflict.

Person A: "${initiatorConstraints}"
Person B: "${partnerConstraints}"
City: ${cityFullName}

Rules for merging:
- Hard constraint UNION: if either person has a hard exclusion ("no raw fish", "not too loud", "vegan"), it applies to both
- Budget: use the LOWER of the two budgets as the ceiling
- Cuisine preferences: include both if they don't conflict; if they conflict, note it
- Noise/atmosphere: use the stricter preference
- CONFLICT: declare conflict ONLY if constraints are truly incompatible (e.g. "vegan only" + "must have steak", "halal only" + "must have pork")

Return ONLY valid JSON:
{
  "merged_query": "<single natural-language query combining both constraints for ${cityFullName}>",
  "conflict": false,
  "conflict_reason": null
}

Or if conflict:
{
  "merged_query": "<best compromise or A's query as fallback>",
  "conflict": true,
  "conflict_reason": "<one sentence explaining what conflicts>"
}`,
      },
    ],
    max_tokens: 300,
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    // Fallback: just concatenate both queries
    return {
      mergedQuery: `${initiatorConstraints} and also ${partnerConstraints} in ${cityFullName}`,
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
      mergedQuery: `${initiatorConstraints} and also ${partnerConstraints} in ${cityFullName}`,
      conflict: false,
    };
  }
}

export async function runAgentForTwoParty(
  initiatorConstraints: string,
  partnerConstraints: string,
  cityId: string
): Promise<TwoPartyMergeResult> {
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];

  const { mergedQuery, conflict, conflictReason } = await buildMergedQuery(
    initiatorConstraints,
    partnerConstraints,
    city.fullName
  );

  // Run the existing agent with the merged query, capped at 5 results
  const result = await runAgent(
    mergedQuery,
    [], // no conversation history for merged query
    cityId
  );

  const options = result.recommendations.slice(0, 5) as RecommendationCard[];

  return { options, conflict, conflictReason };
}
