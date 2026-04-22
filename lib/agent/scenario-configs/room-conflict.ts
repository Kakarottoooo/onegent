/**
 * Per-scenario configuration for Decision Room constraint-merge engines.
 *
 * `two-party.ts` and `n-party.ts` read this table to generate the MiniMax
 * prompt that merges N users' constraints into ONE compound query and flags
 * conflicts. Adding a new Room type = adding a new entry here + wiring a
 * `runAgentFor<Type>` search pipeline.
 *
 * Rule of thumb when authoring a new entry:
 *   - `goal*` is the sentence the prompt opens with ("a hotel they'll all stay at").
 *   - `mergeRules` are bulleted directives the LLM follows while merging.
 *   - `conflictExamples` are canonical "real conflict" shapes — the LLM uses
 *     these to calibrate when to set `conflict=true`.
 */

export type RoomScenarioId = "restaurant" | "hotel" | "flight" | "activity";

export interface RoomConflictConfig {
  /** Singular noun used throughout the prompt, e.g. "restaurant". */
  noun: string;
  /** Plural form, e.g. "restaurants". */
  nounPlural: string;
  /** Opener for 2-party prompt: "find <goalTwoParty>". */
  goalTwoParty: string;
  /** Opener for N-party prompt: "find <goalNParty>". */
  goalNParty: string;
  /** Bulleted merge directives (rendered verbatim into the prompt). */
  mergeRules: string[];
  /** Canonical conflict shapes used to calibrate the LLM's conflict threshold. */
  conflictExamples: string[];
}

export const ROOM_CONFLICT_CONFIGS: Record<RoomScenarioId, RoomConflictConfig> = {
  restaurant: {
    noun: "restaurant",
    nounPlural: "restaurants",
    goalTwoParty: "a restaurant they'll both agree on",
    goalNParty: "a restaurant they'll all agree on",
    mergeRules: [
      'Hard constraint UNION: if either person has a hard exclusion ("no raw fish", "not too loud", "vegan"), it applies to both',
      "Budget: use the LOWER of the two budgets as the ceiling",
      "Cuisine preferences: include both if they don't conflict; if they conflict, note it",
      "Noise/atmosphere: use the stricter preference",
    ],
    conflictExamples: [
      '"vegan only" + "must have steak"',
      '"halal only" + "must have pork"',
    ],
  },
  hotel: {
    noun: "hotel",
    nounPlural: "hotels",
    goalTwoParty: "a hotel they'll both stay at",
    goalNParty: "a hotel they'll all stay at",
    mergeRules: [
      "Date window: check-in/check-out is fixed by the room context and applies to everyone — do NOT let per-person constraints override dates",
      "Location/neighborhood: if neighborhoods clash (e.g. 'downtown' vs 'airport area'), pick a central compromise. Only declare conflict if they name geographically incompatible areas (e.g. different cities)",
      "Budget per night: use the LOWEST ceiling as the group cap",
      "Star rating: use the HIGHEST minimum as the group floor",
      "Amenities: UNION of required amenities (pool, breakfast, gym, parking, pet-friendly)",
      "Vibe: use the stricter preference (e.g. 'quiet' overrides 'lively')",
    ],
    conflictExamples: [
      '"must be under $80/night" + "must be 5-star luxury"',
      '"pet-friendly required" + "no pets allowed anywhere on property"',
      '"downtown only" + "airport hotel only"',
    ],
  },
  flight: {
    noun: "flight",
    nounPlural: "flights",
    goalTwoParty: "a flight they'll both take together",
    goalNParty: "a flight they'll all take together",
    mergeRules: [
      "Route and dates are fixed by the room context (departure city, arrival city, departure date, return date, one-way vs round-trip) — do NOT let per-person constraints override them",
      "Cabin class: use the HIGHEST requested class as the group floor (e.g. if anyone asks for business, book business)",
      "Stops: use the STRICTEST cap (nonstop beats 1-stop beats 2-stop)",
      "Departure time window: use the INTERSECTION of each person's earliest/latest departure preferences",
      "Red-eye: if ANYONE says avoid red-eye, avoid red-eye for the group",
      "Preferred airlines: UNION of preferences, but only treat as soft bias unless someone has a hard exclusion",
      "Baggage / seat preferences: defer to per-person at booking time, not group search query",
    ],
    conflictExamples: [
      '"nonstop only" + "must fly airline X which has no nonstop on this route"',
      '"must depart before 9am" + "must depart after 8pm"',
      '"economy only, under $300" + "business class required"',
    ],
  },
  activity: {
    noun: "event",
    nounPlural: "events",
    goalTwoParty: "a set of tickets they'll both attend",
    goalNParty: "a set of tickets they'll all attend",
    mergeRules: [
      "Event identity (event_name, event_date, city, venue) is fixed by the room context — do NOT let per-person constraints override them, everyone attends the SAME show on the SAME night",
      "Ticket budget per seat: use the LOWEST ceiling as the group cap",
      "Seat tier: use the HIGHEST requested tier as the group floor (premium > standard > economy). If someone asks for premium the group books premium-or-better, which may raise the per-seat price",
      "Section preferences: UNION of specific sections members like (e.g. 'lower bowl', 'orchestra'). Treat as soft bias",
      "Section avoidances: UNION of hard exclusions (e.g. 'no standing room', 'no obstructed view') apply to everyone",
      "Accessibility: if ANY member needs a wheelchair seat or companion seat, require it for the group — this trumps seat tier",
      "Delivery: use the INTERSECTION across members (e.g. all accept mobile tickets). Default to mobile if silence",
      "Seats together: strongly prefer contiguous seats unless a member explicitly opts out",
    ],
    conflictExamples: [
      '"premium front-row only" + "must be under $50 per ticket"',
      '"wheelchair accessible required" + "only front-row pit tickets"',
      '"standing room pit" + "seated orchestra only"',
    ],
  },
};

/** Two-party prompt template — renders with a scenario config. */
export function renderTwoPartyPrompt(
  cfg: RoomConflictConfig,
  initiatorConstraints: string,
  partnerConstraints: string,
  cityFullName: string,
): string {
  const rulesBlock = cfg.mergeRules.map((r) => `- ${r}`).join("\n");
  const conflictExamples = cfg.conflictExamples.map((e) => e).join(", ");
  return `Two people need to find ${cfg.goalTwoParty}. Merge their individual constraints into ONE compound search query, and detect if they conflict.

Person A: "${initiatorConstraints}"
Person B: "${partnerConstraints}"
City: ${cityFullName}

Rules for merging:
${rulesBlock}
- CONFLICT: declare conflict ONLY if constraints are truly incompatible (e.g. ${conflictExamples})

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
}`;
}

/** N-party prompt template — renders with a scenario config and enumerated inputs. */
export function renderNPartyPrompt(
  cfg: RoomConflictConfig,
  enumeratedInputs: string,
  inputCount: number,
  cityFullName: string,
): string {
  const rulesBlock = cfg.mergeRules.map((r) => `- ${r}`).join("\n");
  const conflictExamples = cfg.conflictExamples.map((e) => e).join(", ");
  return `${inputCount} people need to find ${cfg.goalNParty}. Merge everyone's constraints into ONE compound search query, and detect if any pair conflicts.

${enumeratedInputs}
City: ${cityFullName}

Rules for merging:
${rulesBlock}
- CONFLICT: declare conflict ONLY if two or more constraints are truly incompatible (e.g. ${conflictExamples}). If you declare conflict, list the affected person ids.

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
}`;
}
