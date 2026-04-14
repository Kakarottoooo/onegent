import { minimaxChat } from "./minimax";
import {
  CategoryType,
  InputLanguage,
  MultilingualQueryContext,
  OutputLanguage,
  ScenarioType,
} from "./types";

const LOCATION_ALIAS_RULES: Array<{ pattern: RegExp; location: string }> = [
  { pattern: /\bnyc\b|\bnew york city\b|\bnew york\b|\bmanhattan\b|\bbrooklyn\b|\bqueens\b/i, location: "New York, NY" },
  { pattern: /\bny\b/i, location: "New York, NY" },
  { pattern: /\blos angeles\b/i, location: "Los Angeles, CA" },
  { pattern: /\bla\b/i, location: "Los Angeles, CA" },
  { pattern: /\bsf\b|\bsan francisco\b/i, location: "San Francisco, CA" },
  { pattern: /\bdc\b|\bwashington dc\b|\bwashington, dc\b/i, location: "Washington, DC" },
  { pattern: /\bphilly\b|\bphiladelphia\b/i, location: "Philadelphia, PA" },
  { pattern: /\bvegas\b|\blas vegas\b/i, location: "Las Vegas, NV" },
  { pattern: /\bchi\b|\bchicago\b/i, location: "Chicago, IL" },
  { pattern: /\bmiami\b/i, location: "Miami, FL" },
  { pattern: /\bboston\b/i, location: "Boston, MA" },
  { pattern: /\bseattle\b/i, location: "Seattle, WA" },
  { pattern: /\bhouston\b/i, location: "Houston, TX" },
  { pattern: /\bdallas\b/i, location: "Dallas, TX" },
  { pattern: /\batlanta\b/i, location: "Atlanta, GA" },
  { pattern: /\bdenver\b/i, location: "Denver, CO" },
  { pattern: /\baustin\b/i, location: "Austin, TX" },
  { pattern: /\bportland\b/i, location: "Portland, OR" },
  { pattern: /\bphoenix\b/i, location: "Phoenix, AZ" },
  { pattern: /\bminneapolis\b/i, location: "Minneapolis, MN" },
  { pattern: /\bdetroit\b/i, location: "Detroit, MI" },
  { pattern: /\bnew orleans\b/i, location: "New Orleans, LA" },
  { pattern: /\bsan diego\b/i, location: "San Diego, CA" },
  { pattern: /\bsan antonio\b/i, location: "San Antonio, TX" },
  { pattern: /\bnashville\b/i, location: "Nashville, TN" },
  { pattern: /\bmemphis\b/i, location: "Memphis, TN" },
  { pattern: /\bcharlotte\b/i, location: "Charlotte, NC" },
  { pattern: /\braleigh\b/i, location: "Raleigh, NC" },
  { pattern: /\bnew jersey\b|\bnj\b/i, location: "New Jersey, NJ" },
  { pattern: /\bpittsburgh\b/i, location: "Pittsburgh, PA" },
  { pattern: /\bcleveland\b/i, location: "Cleveland, OH" },
  { pattern: /\bcolumbus\b/i, location: "Columbus, OH" },
  { pattern: /\bindianapolis\b/i, location: "Indianapolis, IN" },
  { pattern: /\bmilwaukee\b/i, location: "Milwaukee, WI" },
  { pattern: /\bkansas city\b/i, location: "Kansas City, MO" },
  { pattern: /\bsalt lake city\b|\bslc\b/i, location: "Salt Lake City, UT" },
  { pattern: /\boak?land\b/i, location: "Oakland, CA" },
  { pattern: /\bsacramento\b/i, location: "Sacramento, CA" },
  { pattern: /\btampa\b/i, location: "Tampa, FL" },
  { pattern: /\borlando\b/i, location: "Orlando, FL" },
  { pattern: /\bjacksonville\b/i, location: "Jacksonville, FL" },
  { pattern: /\bbaltimore\b/i, location: "Baltimore, MD" },
  { pattern: /\blouisville\b/i, location: "Louisville, KY" },
];

const VALID_CATEGORIES: CategoryType[] = [
  "restaurant",
  "hotel",
  "flight",
  "credit_card",
  "laptop",
  "smartphone",
  "headphone",
  "subscription",
  "trip",
  "unknown",
];

const VALID_SCENARIOS: ScenarioType[] = [
  "date_night",
  "weekend_trip",
  "city_trip",
  "big_purchase",
  "concert_event",
  "gift",
  "fitness",
];

function inferInputLanguage(message: string): InputLanguage {
  const cjkMatches = message.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? [];
  const latinMatches = message.match(/[A-Za-z]/g) ?? [];

  if (cjkMatches.length > 0 && latinMatches.length > 0) return "mixed";
  if (cjkMatches.length > 0) return "zh";
  if (latinMatches.length > 0) return "en";
  if (message.trim().length === 0) return "unknown";
  return "other";
}

function inferOutputLanguage(inputLanguage: InputLanguage): OutputLanguage {
  return inputLanguage === "zh" || inputLanguage === "mixed" ? "zh" : "en";
}

function hasCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function resolveLocationAlias(message: string): string | undefined {
  return LOCATION_ALIAS_RULES.find(({ pattern }) => pattern.test(message))?.location;
}

function normalizeLocation(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const normalized = location.trim();
  if (!normalized) return undefined;
  if (/^nyc?$/i.test(normalized)) return "New York, NY";
  if (/^la$/i.test(normalized)) return "Los Angeles, CA";
  if (/^sf$/i.test(normalized)) return "San Francisco, CA";
  if (/^dc$/i.test(normalized)) return "Washington, DC";
  return normalized;
}

function coerceCategory(value: unknown): CategoryType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as CategoryType;
  return VALID_CATEGORIES.includes(normalized) ? normalized : null;
}

function coerceScenario(value: unknown): ScenarioType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as ScenarioType;
  return VALID_SCENARIOS.includes(normalized) ? normalized : null;
}

function buildFallbackContext(
  message: string,
  fallbackLocation?: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): MultilingualQueryContext {
  const lower = message.toLowerCase();
  const inputLanguage = inferInputLanguage(message);
  const outputLanguage = inferOutputLanguage(inputLanguage);

  // Detect multi-component trip signals before assigning single-category hints
  const _hasFlightSignal = /\bflight\b|\bflights\b|\bairport\b|\bfly\b|\bplane\b|\bairline\b/i.test(lower);
  const _hasHotelSignal = /\bhotel\b|\bhotels\b|\bcheck.?in\b|\bcheck.?out\b|\bstay\b|\bnights?\b/i.test(lower);

  let categoryHint: CategoryType | null = null;
  // Only set flight/hotel categoryHint when the other component is absent (standalone search)
  if (_hasFlightSignal && !_hasHotelSignal) categoryHint = "flight";
  else if (_hasHotelSignal && !_hasFlightSignal) categoryHint = "hotel";
  else if (/\bcredit card\b|\bcash back\b|\brewards card\b/.test(lower)) categoryHint = "credit_card";
  else if (/\blaptop\b|\bmacbook\b|\bthinkpad\b/.test(lower)) categoryHint = "laptop";
  else if (/\bphone\b|\bsmartphone\b|\biphone\b|\bandroid\b/.test(lower)) categoryHint = "smartphone";
  else if (/\bheadphone\b|\bearbuds\b|\bairpods\b/.test(lower)) categoryHint = "headphone";
  else if (/\brestaurant\b|\bdinner\b|\blunch\b|\bdate\b|\breservation\b|\beat\b|\bfood\b|\bcuisine\b|\btable\b|\bdine\b|\bdining\b/.test(lower)) categoryHint = "restaurant";

  let scenarioHint: ScenarioType | null = null;
  // Multi-component trip: flight + hotel together → weekend_trip regardless of keyword order
  if (_hasFlightSignal && _hasHotelSignal) {
    scenarioHint = "weekend_trip";
  } else if (/\bweekend\b.*\btrip\b|\bweekend getaway\b|\bcity break\b/.test(lower)) {
    scenarioHint = "weekend_trip";
  } else if (/\bdate night\b|\bfirst date\b|\bromantic\b|\banniversary\b/.test(lower)) {
    scenarioHint = "date_night";
  } else if (
    (/\btravel(?:ing)? to\b|\bgoing to\b|\bvisit(?:ing)?\b|\btrip to\b/i.test(lower)) &&
    /\bhotel\b|\bstay\b/i.test(lower) &&
    /\brestaurants?\b|\bbars?\b|\bnightlife\b|\bmusic\b|\bplan/i.test(lower)
  ) {
    scenarioHint = "city_trip";
  } else if (
    // Don't set concert_event if a transport/product category was already identified
    !categoryHint &&
    (
      /\bconcert\b|\bgig\b|\blive music\b|\bfestival\b|\bmusical\b|\bcomedy show\b|\bstand.?up\b/i.test(lower) ||
      // "ticket(s)" alone only triggers concert when there are NO flight/travel signals
      (/\btickets?\b/i.test(lower) && !/\bfly\b|\bflight\b|\bflights\b|\bairport\b|\bairline\b|\bplane\b/i.test(lower)) ||
      (/\bshow\b|\bperformance\b|\bevent\b/i.test(lower) &&
        /\bsee\b|\bwatch\b|\battend\b|\bgo to\b|\bgoing\b/i.test(lower))
    )
  ) {
    scenarioHint = "concert_event";
  } else if (
    /\bgift\b|\bgifts\b|\bpresent\b|\bpresents\b/i.test(lower) &&
    /\bfind\b|\bget\b|\bbuy\b|\bsuggest\b|\brecommend\b|\bidea\b|\bfor\b/i.test(lower)
  ) {
    scenarioHint = "gift";
  } else if (
    /\byoga\b|\bpilates\b|\bspin\b|\bhiit\b|\bcrossfit\b|\bbox(?:ing)?\s+class\b|\bdance\s+class\b|\bmeditation\b|\bbarre\b|\bfitness\s+class\b|\bworkout\s+class\b|\bexercise\s+class\b|\bvinyasa\b|\breformer\b|\bzumba\b/i.test(lower) &&
    /\bfind\b|\bbook\b|\blook(?:ing)?\b|\bsign\s+up\b|\bjoin\b|\bclass\b|\bstudio\b|\bsession\b|\bbest\b|\bgood\b|\brecommend\b|\bnear(?:by)?\b|\baround\b/i.test(lower)
  ) {
    scenarioHint = "fitness";
  }

  // Inherit scenario from conversation history when the current message is a short follow-up
  // (e.g. user answering a clarification question like "yes, from Nashville")
  if (!scenarioHint && conversationHistory.length > 0) {
    const isShortFollowUp = message.trim().split(/\s+/).length <= 15;
    if (isShortFollowUp) {
      // Look at recent assistant + user messages for an active scenario
      const recentText = conversationHistory.slice(-6).map(m => m.content).join(" ").toLowerCase();
      if (/weekend.?trip|weekend getaway|city break|hotel.*flight|flight.*hotel/i.test(recentText)) {
        scenarioHint = "weekend_trip";
        // Don't let a solo "fly" in the follow-up override this
        if (categoryHint === "flight") categoryHint = null;
      } else if (/date.?night|romantic dinner|first date/i.test(recentText)) {
        scenarioHint = "date_night";
      } else if (/city.?trip|things to do|explore the city/i.test(recentText)) {
        scenarioHint = "city_trip";
      }
    }
  }

  const refinementConstraints: string[] = [];
  if (/\bcheaper\b|再便宜|便宜点|less expensive|lower price|lower budget/i.test(lower)) {
    refinementConstraints.push("cheaper than previous results — tighten budget constraint");
  }
  if (/\bquieter\b|安静点|less noisy|more quiet/i.test(lower)) {
    refinementConstraints.push("quieter than previous results — prefer low noise venues");
  }
  if (/\bcloser\b|近一点|更近|nearby only/i.test(lower)) {
    refinementConstraints.push("closer location — prefer nearest options only");
  }
  if (/\bfaster\b|快一点|出餐快|quicker service/i.test(lower)) {
    refinementConstraints.push("faster service than previous — prefer quick-service venues");
  }

  // Extract cuisine hint from English messages (MiniMax fast-path skips NLU so we do it here)
  const cuisinePatterns: [RegExp, string][] = [
    [/\bhot chicken\b/i, "hot chicken"],
    [/\bsushi\b|\bjapanese\b/i, "Japanese"],
    [/\bitalian\b|\bpizza\b|\bpasta\b|\brisotto\b/i, "Italian"],
    [/\btacos?\b|\bmexican\b|\bburritos?\b|\bguacamole\b/i, "Mexican"],
    [/\bchinese\b|\bdim sum\b|\bdumplings?\b/i, "Chinese"],
    [/\bthai\b|\bpad thai\b/i, "Thai"],
    [/\bindian\b|\bcurry\b|\bnaan\b|\bbiryani\b/i, "Indian"],
    [/\bbbq\b|\bbarbe?cue\b|\bsmoked\b|\bbrisket\b|\bribs?\b/i, "BBQ"],
    [/\bburger\b|\bburgers\b/i, "burgers"],
    [/\bsteak\b|\bsteakhouse\b/i, "steakhouse"],
    [/\bfrench\b|\bbistro\b|\bcroissant\b/i, "French"],
    [/\bmediterranean\b|\bgreek\b|\bhummus\b/i, "Mediterranean"],
    [/\bvegan\b|\bvegetarian\b|\bplant.?based\b/i, "vegan"],
    [/\bseafood\b|\blobster\b|\bshrimp\b|\boyster\b/i, "seafood"],
    [/\bramen\b|\bnoodles?\b|\bpho\b|\budon\b/i, "ramen"],
    [/\bkorean\b|\bbibimbap\b|\bkbbq\b/i, "Korean"],
  ];
  const cuisine_hint = cuisinePatterns.find(([rx]) => rx.test(lower))?.[1] ?? undefined;

  return {
    input_language: inputLanguage,
    output_language: outputLanguage,
    normalized_query: message.trim(),
    intent_summary: message.trim(),
    category_hint: categoryHint,
    scenario_hint: scenarioHint,
    // Do NOT fall back to fallbackLocation here — the AI NLU pass will extract
    // an explicit city from the message and override this. If we pre-fill the
    // fallback city (e.g. Nashville), it wins over the AI-extracted location.
    location_hint: resolveLocationAlias(message) ?? undefined,
    ...(cuisine_hint ? { cuisine_hint } : {}),
    ...(refinementConstraints.length > 0 ? { constraints_hint: refinementConstraints } : {}),
  };
}

function mergeContexts(
  fallback: MultilingualQueryContext,
  parsed: Partial<MultilingualQueryContext>
): MultilingualQueryContext {
  const inputLanguage =
    parsed.input_language === "en" ||
    parsed.input_language === "zh" ||
    parsed.input_language === "mixed" ||
    parsed.input_language === "other" ||
    parsed.input_language === "unknown"
      ? parsed.input_language
      : fallback.input_language;

  const outputLanguage =
    parsed.output_language === "zh" || parsed.output_language === "en"
      ? parsed.output_language
      : inferOutputLanguage(inputLanguage);

  const parsedSummary =
    typeof parsed.intent_summary === "string" && parsed.intent_summary.trim()
      ? parsed.intent_summary.trim()
      : "";
  const safeSummary =
    outputLanguage === "en"
      ? hasCjk(parsedSummary) && !hasLatin(parsedSummary)
        ? fallback.normalized_query
        : parsedSummary || fallback.intent_summary
      : !hasCjk(parsedSummary) && hasLatin(parsedSummary)
      ? fallback.intent_summary
      : parsedSummary || fallback.intent_summary;

  return {
    input_language: inputLanguage,
    output_language: outputLanguage,
    normalized_query:
      typeof parsed.normalized_query === "string" && parsed.normalized_query.trim()
        ? parsed.normalized_query.trim()
        : fallback.normalized_query,
    intent_summary: safeSummary,
    category_hint: coerceCategory(parsed.category_hint) ?? fallback.category_hint ?? null,
    scenario_hint: coerceScenario(parsed.scenario_hint) ?? fallback.scenario_hint ?? null,
    location_hint:
      normalizeLocation(
        typeof parsed.location_hint === "string"
          ? parsed.location_hint
          : fallback.location_hint
      ) ?? fallback.location_hint,
    cuisine_hint:
      typeof parsed.cuisine_hint === "string" && parsed.cuisine_hint.trim()
        ? parsed.cuisine_hint.trim().toLowerCase()
        : fallback.cuisine_hint,
    purpose_hint:
      typeof parsed.purpose_hint === "string" && parsed.purpose_hint.trim()
        ? parsed.purpose_hint.trim().toLowerCase()
        : fallback.purpose_hint,
    party_size_hint:
      typeof parsed.party_size_hint === "number" && Number.isFinite(parsed.party_size_hint)
        ? parsed.party_size_hint
        : fallback.party_size_hint,
    budget_per_person_hint:
      typeof parsed.budget_per_person_hint === "number" &&
      Number.isFinite(parsed.budget_per_person_hint)
        ? parsed.budget_per_person_hint
        : fallback.budget_per_person_hint,
    budget_total_hint:
      typeof parsed.budget_total_hint === "number" &&
      Number.isFinite(parsed.budget_total_hint)
        ? parsed.budget_total_hint
        : fallback.budget_total_hint,
    date_text_hint:
      typeof parsed.date_text_hint === "string" && parsed.date_text_hint.trim()
        ? parsed.date_text_hint.trim()
        : fallback.date_text_hint,
    time_hint:
      typeof parsed.time_hint === "string" && parsed.time_hint.trim()
        ? parsed.time_hint.trim()
        : fallback.time_hint,
    constraints_hint: Array.isArray(parsed.constraints_hint)
      ? parsed.constraints_hint.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : fallback.constraints_hint,
  };
}

function buildPreferenceConstraintHints(userPreferences: Record<string, string>): string[] {
  return Object.entries(userPreferences).flatMap(([k, v]) => {
    if (k === "noise_sensitivity" && v === "high") return ["quiet venues preferred"];
    if (k === "budget_sensitivity" && v === "high") return ["budget-conscious options preferred"];
    if (k === "distance_tolerance" && v === "low") return ["nearby venues only"];
    return [];
  });
}

function buildPreferenceConstraintBlock(userPreferences: Record<string, string>): string {
  const hints = buildPreferenceConstraintHints(userPreferences);
  if (hints.length === 0) return "";
  const lines = hints.map((h) => `- ${h}`);
  return "\n\nLearned user preferences (soft constraints from past feedback):\n" + lines.join("\n");
}

// ─── G-3: Partial-refine detection ─────────────────────────────────────────────

const REFINE_HOTEL_PATTERNS = [
  /换个酒店/,
  /different hotel/i,
  /change the hotel/i,
  /swap the hotel/i,
  /try a different hotel/i,
  /another hotel/i,
];

const REFINE_FLIGHT_PATTERNS = [
  /换个航班/,
  /different flight/i,
  /change the flight/i,
  /swap the flight/i,
  /try a different flight/i,
  /another flight/i,
];

const REFINE_RESTAURANT_PATTERNS = [
  /换个餐厅/,
  /different restaurant/i,
  /change the restaurant/i,
  /swap the restaurant/i,
  /try a different restaurant/i,
  /another restaurant/i,
];

function detectRefineModule(
  message: string
): "hotel" | "flight" | "restaurant" | "venue" | undefined {
  if (REFINE_HOTEL_PATTERNS.some((p) => p.test(message))) return "hotel";
  if (REFINE_FLIGHT_PATTERNS.some((p) => p.test(message))) return "flight";
  if (REFINE_RESTAURANT_PATTERNS.some((p) => p.test(message))) return "restaurant";
  return undefined;
}

export async function analyzeMultilingualQuery(
  message: string,
  fallbackLocation?: string,
  userPreferences?: Record<string, string>,
  options?: { pinned_plan_id?: string; conversationHistory?: Array<{ role: "user" | "assistant"; content: string }> }
): Promise<MultilingualQueryContext> {
  const pinned_plan_id = options?.pinned_plan_id;
  const conversationHistory = options?.conversationHistory ?? [];
  const fallback = buildFallbackContext(message, fallbackLocation, conversationHistory);

  // G-3: detect partial-refine intent when a pinned plan is provided
  const refine_module = pinned_plan_id ? detectRefineModule(message) : undefined;

  const preferenceHints = userPreferences ? buildPreferenceConstraintHints(userPreferences) : [];

  // Fast path: pure English queries don't need MiniMax NLU — regex fallback is accurate enough.
  // MiniMax adds value for Chinese, mixed-language, and ambiguous queries.
  if (inferInputLanguage(message) === "en") {
    const result = preferenceHints.length > 0
      ? { ...fallback, constraints_hint: [...(fallback.constraints_hint ?? []), ...preferenceHints] }
      : fallback;
    if (refine_module) {
      return { ...result, refine_module, pinned_plan_id };
    }
    return result;
  }

  const preferenceBlock = userPreferences ? buildPreferenceConstraintBlock(userPreferences) : "";

  try {
    const text = await minimaxChat({
      system: `You are a multilingual consumer-query normalizer.
Return ONLY valid JSON with this schema:
{
  "input_language": "en" | "zh" | "mixed" | "other" | "unknown",
  "output_language": "en" | "zh",
  "normalized_query": "short internal canonical paraphrase in English",
  "intent_summary": "one sentence summary in the user's preferred output language",
  "category_hint": "restaurant" | "hotel" | "flight" | "credit_card" | "laptop" | "smartphone" | "headphone" | "subscription" | "trip" | "fitness" | "unknown" | null,
  "scenario_hint": "date_night" | "weekend_trip" | "city_trip" | "big_purchase" | "concert_event" | "gift" | "fitness" | null,
  "location_hint": "canonical place name like New York, NY" | null,
  "cuisine_hint": "western|italian|french|japanese|..." | null,
  "purpose_hint": "date|business|family|friends|solo|group|..." | null,
  "party_size_hint": number | null,
  "budget_per_person_hint": number | null,
  "budget_total_hint": number | null,
  "date_text_hint": "next tuesday|tomorrow|2026-03-24|..." | null,
  "time_hint": "7:30 pm|8pm|..." | null,
  "constraints_hint": ["constraint", "..."]
}

Rules:
- Detect the user's dominant language and preserve it in output_language.
- normalized_query should be a concise English internal representation.
- category_hint and scenario_hint must reflect the user's actual goal, not the surface wording.
- Canonicalize location names when possible.
- If the user mixes languages, still extract one clean canonical intent.
- Use null for missing fields.
- Return JSON only.`,
      messages: [
        {
          role: "user",
          content: `Fallback location: ${fallbackLocation ?? "none"}\nUser message: "${message}"`,
        },
      ],
      max_tokens: 600,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return refine_module ? { ...fallback, refine_module, pinned_plan_id } : fallback;
    const merged = mergeContexts(
      fallback,
      JSON.parse(jsonMatch[0]) as Partial<MultilingualQueryContext>
    );
    const withPrefs = preferenceHints.length > 0
      ? { ...merged, constraints_hint: [...(merged.constraints_hint ?? []), ...preferenceHints] }
      : merged;
    if (refine_module) {
      return { ...withPrefs, refine_module, pinned_plan_id };
    }
    return withPrefs;
  } catch {
    return refine_module ? { ...fallback, refine_module, pinned_plan_id } : fallback;
  }
}

export function resolveLocationHint(
  parsedLocation: string | undefined,
  queryContext: MultilingualQueryContext | undefined,
  userMessage: string,
  fallbackLocation?: string
): string | undefined {
  return (
    queryContext?.location_hint ??
    resolveLocationAlias(userMessage) ??
    normalizeLocation(parsedLocation) ??
    fallbackLocation
  );
}
