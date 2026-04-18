/**
 * N-party constraint merge engine for Decision Room (Phase 2, N >= 3).
 *
 * Extends the two-party approach to any number of participants via structured
 * concatenation: MiniMax receives an enumerated list of per-person constraint
 * strings and produces a single compound query + conflict detection.
 *
 * For N=2 callers should keep using `runAgentForTwoParty` — the prompt there is
 * tuned for pair dynamics ("both agree on"). This engine is tuned for groups.
 */

import { minimaxChat } from "../minimax";
import { CITIES, DEFAULT_CITY } from "../cities";
import { runAgent } from "../agent";
import type { RecommendationCard } from "../types";

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

async function buildGroupMergedQuery(
  inputs: NPartyInput[],
  cityFullName: string
): Promise<{
  mergedQuery: string;
  conflict: boolean;
  conflictReason?: string;
  conflictAffectedUsers?: string[];
}> {
  const enumerated = inputs
    .map((p, i) => `Person ${String.fromCharCode(65 + i)} (id=${p.userId}): "${p.text}"`)
    .join("\n");

  const text = await minimaxChat({
    messages: [
      {
        role: "user",
        content: `${inputs.length} people need to find a restaurant they'll all agree on. Merge everyone's constraints into ONE compound search query, and detect if any pair conflicts.

${enumerated}
City: ${cityFullName}

Rules for merging:
- Hard constraint UNION: if ANYONE has a hard exclusion ("no raw fish", "not too loud", "vegan"), it applies to the whole group
- Budget: use the LOWEST budget as the ceiling (group must fit the tightest wallet)
- Cuisine preferences: include likes that don't conflict; skip likes that someone else actively dislikes
- Noise/atmosphere: use the strictest preference
- CONFLICT: declare conflict ONLY if two or more constraints are truly incompatible (e.g. "vegan only" vs "must have steak"). If you declare conflict, list the affected person ids.

Return ONLY valid JSON:
{
  "merged_query": "<single natural-language query for ${cityFullName}>",
  "conflict": false,
  "conflict_reason": null,
  "affected_user_ids": []
}

Or if conflict:
{
  "merged_query": "<best compromise given the conflict>",
  "conflict": true,
  "conflict_reason": "<one sentence>",
  "affected_user_ids": ["<id>", "<id>"]
}`,
      },
    ],
    max_tokens: 400,
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      mergedQuery: inputs.map((p) => p.text).join("; also: ") + ` in ${cityFullName}`,
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
      mergedQuery: inputs.map((p) => p.text).join("; also: ") + ` in ${cityFullName}`,
      conflict: false,
    };
  }
}

/**
 * Merge any number of per-person constraint strings into a single compound
 * query, run the agent, and return up to 5 group-friendly options.
 *
 * Caller should only invoke this for N >= 3. For N=2 use `runAgentForTwoParty`.
 */
export async function runAgentForNParty(
  inputs: NPartyInput[],
  cityId: string
): Promise<NPartyMergeResult> {
  if (inputs.length === 0) {
    return { options: [], conflict: false };
  }
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];

  const { mergedQuery, conflict, conflictReason, conflictAffectedUsers } =
    await buildGroupMergedQuery(inputs, city.fullName);

  const result = await runAgent(mergedQuery, [], cityId);
  const options = result.recommendations.slice(0, 5) as RecommendationCard[];

  return { options, conflict, conflictReason, conflictAffectedUsers };
}
