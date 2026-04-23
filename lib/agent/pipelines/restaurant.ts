import { UserRequirements, Restaurant, RecommendationCard, SessionPreferences, ScoringDimensions } from "../../types";
import { googlePlacesSearch, tavilySearch, geocodeLocation, fetchReviewSignals } from "../../tools";
import { openaiChat } from "../../openai";
import { CITIES, DEFAULT_CITY } from "../../cities";
import { RankedItemArraySchema } from "../../schemas";
import { computeWeightedScore, DEFAULT_WEIGHTS, formatSessionPreferences } from "../composer/scoring";

// ─── Layer 2+3: Search & Collect (parallel) ──────────────────────────────────

export async function gatherCandidates(
  requirements: UserRequirements,
  cityId: string,
  gpsCoords: { lat: number; lng: number } | null = null,
  uiNearLocation?: string
): Promise<{
  restaurants: Restaurant[];
  semanticSignals: string;
  tavilyQuery: string;
  searchCityLabel: string;
}> {
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];
  const searchCityLabel = requirements.location?.trim() || city.fullName;

  // UI near_location takes priority over parsed near_location from message
  const effectiveNearLocation = uiNearLocation ?? requirements.near_location;

  let parsedLocationCoords: { lat: number; lng: number } | undefined;
  if (!gpsCoords && requirements.location) {
    const geocoded = await geocodeLocation(requirements.location);
    if (geocoded) parsedLocationCoords = geocoded;
  }

  // Geocode near_location if provided
  let nearLocationCoords: { lat: number; lng: number } | undefined;
  if (effectiveNearLocation) {
    const geocoded = await geocodeLocation(effectiveNearLocation);
    if (geocoded) nearLocationCoords = geocoded;
  }

  const cityCenter = nearLocationCoords ?? gpsCoords ?? parsedLocationCoords ?? city.center;

  const location = gpsCoords
    ? "Nearby"
    : effectiveNearLocation
    ? effectiveNearLocation
    : requirements.neighborhood
    ? `${requirements.neighborhood}, ${searchCityLabel}`
    : searchCityLabel;

  // Map budget to price filter
  let priceFilter: string | undefined;
  const bpp = requirements.budget_per_person;
  if (bpp) {
    if (bpp <= 15) priceFilter = "1";
    else if (bpp <= 30) priceFilter = "1,2";
    else if (bpp <= 60) priceFilter = "2,3";
    else if (bpp <= 100) priceFilter = "3,4";
    else priceFilter = "4";
  }

  const searchQuery = [
    requirements.cuisine,
    requirements.purpose === "date" ? "romantic" : "",
    requirements.noise_level === "quiet" ? "quiet" : "",
    priceFilter ? (parseInt(priceFilter[0]) <= 2 ? "affordable" : "upscale") : "",
    "restaurant",
  ]
    .filter(Boolean)
    .join(" ");

  // Phase 4.4: Broadened search (no cuisine, no price filter)
  const broadSearchQuery = [
    requirements.purpose === "date" ? "romantic" : "",
    requirements.noise_level === "quiet" ? "quiet" : "",
    "restaurant",
  ]
    .filter(Boolean)
    .join(" ");

  const tavilyQuery = [
    requirements.cuisine,
    `restaurant ${searchCityLabel}`,
    requirements.purpose === "date" ? "romantic date night" : "",
    requirements.atmosphere?.join(" "),
    requirements.noise_level === "quiet" ? "quiet atmosphere" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Phase 4.4: Run primary AND broadened search in parallel, plus Tavily
  const [primaryRestaurants, broadRestaurants, tavilyResult] = await Promise.all([
    googlePlacesSearch({
      query: searchQuery,
      location,
      cityCenter,
      nearLocationCoords,
      maxResults: 20,
    }),
    googlePlacesSearch({
      query: broadSearchQuery,
      location,
      cityCenter,
      nearLocationCoords,
      maxResults: 20,
    }).catch(() => [] as Restaurant[]),
    tavilySearch(`best ${tavilyQuery} reviews 2024`).catch((err) => {
      console.warn("Tavily search failed:", err);
      return { results: "", failed: true };
    }),
  ]);
  const semanticSignals = tavilyResult.failed ? "" : tavilyResult.results;

  // Phase 4.4: Merge and deduplicate by id
  const seenIds = new Set<string>();
  const merged: Restaurant[] = [];
  for (const r of [...primaryRestaurants, ...broadRestaurants]) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      merged.push(r);
    }
  }

  // Phase 4.4: Three-stage funnel
  // Stage 1 (Recall): pool of 30-60 raw candidates → we have merged (up to 40)
  // Stage 2 (Pre-filter): remove rating < 3.5 AND review_count < 30; sort by score, take top 15
  const preFiltered = merged
    .filter((r) => r.rating >= 3.5 && r.review_count >= 30)
    .sort((a, b) => b.rating * Math.log(b.review_count + 1) - a.rating * Math.log(a.review_count + 1))
    .slice(0, 15);

  return { restaurants: preFiltered, semanticSignals, tavilyQuery, searchCityLabel };
}

// ─── Layer 4+5+6: Rank, Score, Explain ───────────────────────────────────────

function buildFallbackSuggestedRefinements(requirements: UserRequirements): string[] {
  const suggestions = [
    requirements.noise_level === "quiet" ? null : "更安静一点",
    requirements.budget_per_person && requirements.budget_per_person <= 40 ? null : "再便宜一点",
    requirements.purpose === "date" ? "更适合约会" : "更适合聊天",
    requirements.neighborhood || requirements.near_location ? null : "换个更方便的区域",
    requirements.cuisine ? null : "偏西餐一点",
  ].filter((item): item is string => Boolean(item));

  return Array.from(new Set(suggestions)).slice(0, 4);
}

function buildFallbackRestaurantCards(
  requirements: UserRequirements,
  restaurants: Restaurant[],
  effectiveWeights: typeof DEFAULT_WEIGHTS
): { cards: RecommendationCard[]; suggested_refinements: string[] } {
  const priceMidpoint: Record<string, number> = {
    $: 20,
    $$: 45,
    $$$: 85,
    $$$$: 140,
  };

  const estimatedTotal = (price: string | undefined, partySize?: number) => {
    const diners = Math.max(2, partySize ?? 2);
    const midpoint = priceMidpoint[price ?? "$$"] ?? priceMidpoint.$$;
    const low = Math.max(20, Math.round(midpoint * diners * 0.8));
    const high = Math.max(low + 20, Math.round(midpoint * diners * 1.2));
    return `$${low}-${high} for ${diners} people`;
  };

  const budgetScore = (price: string | undefined) => {
    const target = requirements.budget_per_person;
    if (!target) return 7;
    const midpoint = priceMidpoint[price ?? "$$"] ?? priceMidpoint.$$;
    const diffRatio = Math.abs(midpoint - target) / Math.max(target, 1);
    return Math.max(2, Math.min(10, Math.round((10 - diffRatio * 8) * 10) / 10));
  };

  const cards = restaurants
    .slice(0, 8)
    .map((restaurant, index) => {
      const reviewSignals = restaurant.review_signals;
      const sceneMatch =
        requirements.purpose === "date"
          ? Math.min(
              10,
              Math.max(
                reviewSignals?.date_suitability ?? 6,
                /french|italian|steak|wine|bistro/i.test(restaurant.cuisine) ? 8 : 6
              )
            )
          : 7;
      const reviewQuality = Math.min(
        10,
        Math.round(
          (restaurant.rating * 1.6 + Math.min(2.5, Math.log10(Math.max(restaurant.review_count, 10)))) * 10
        ) / 10
      );
      const locationConvenience = restaurant.distance
        ? Math.max(4, Math.min(10, Math.round((10 - restaurant.distance / 1.5) * 10) / 10))
        : 7;
      const preferenceMatch =
        requirements.noise_level === "quiet"
          ? reviewSignals?.noise_level === "quiet"
            ? 9
            : reviewSignals?.noise_level === "loud"
            ? 3
            : 6
          : 7;
      const redFlagPenalty = Math.min(2, (reviewSignals?.red_flags.length ?? 0) * 0.75);

      const scoring = {
        budget_match: budgetScore(restaurant.price),
        scene_match: sceneMatch,
        review_quality: reviewQuality,
        location_convenience: locationConvenience,
        preference_match: preferenceMatch,
        red_flag_penalty: redFlagPenalty,
        weighted_total: 0,
      } satisfies ScoringDimensions;

      const score = computeWeightedScore(scoring, effectiveWeights);
      scoring.weighted_total = score;

      const whyParts = [
        `${restaurant.rating.toFixed(1)} rating from ${restaurant.review_count} reviews`,
        requirements.purpose === "date"
          ? reviewSignals?.date_suitability
            ? `date-night fit looks strong from review signals`
            : `works as a solid date-night default`
          : null,
        reviewSignals?.noise_level === "quiet" ? "reviews suggest an easier-to-talk-over room" : null,
        requirements.cuisine ? `still aligned with your ${requirements.cuisine} ask` : null,
      ].filter((item): item is string => Boolean(item));

      const redFlag = reviewSignals?.red_flags[0];
      const notGreatIf =
        requirements.budget_per_person && budgetScore(restaurant.price) <= 4
          ? "You want to stay tightly under budget."
          : reviewSignals?.noise_level === "loud"
          ? "You want a quieter meal."
          : "You want something more specialized than a safe all-around pick.";

      return {
        restaurant,
        rank: index + 1,
        score,
        scoring,
        why_recommended: whyParts.join("; "),
        best_for:
          reviewSignals?.best_for[0] ??
          (requirements.purpose === "date" ? "Date night with low decision risk" : "Reliable general pick"),
        watch_out: redFlag ?? "Double-check reservation availability at your target time.",
        not_great_if: notGreatIf,
        estimated_total: estimatedTotal(restaurant.price, requirements.party_size),
        suggested_refinements: buildFallbackSuggestedRefinements(requirements),
      } satisfies RecommendationCard;
    })
    .sort((a, b) => b.score - a.score)
    .map((card, index) => ({ ...card, rank: index + 1 }))
    .slice(0, 5);

  return {
    cards,
    suggested_refinements: cards[0]?.suggested_refinements ?? buildFallbackSuggestedRefinements(requirements),
  };
}

export async function rankAndExplain(
  requirements: UserRequirements,
  restaurants: Restaurant[],
  semanticSignals: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  cityFullName: string,
  sessionPreferences?: SessionPreferences,
  profileContext?: string,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>
): Promise<{ cards: RecommendationCard[]; suggested_refinements: string[] }> {
  const restaurantList = restaurants
    .map((r, i) => {
      const signals = r.review_signals;
      let signalLine = "";
      if (signals) {
        const parts = [
          signals.noise_level !== "unknown" ? `noise=${signals.noise_level}` : null,
          signals.wait_time ? `wait=${signals.wait_time}` : null,
          `date_suitability=${signals.date_suitability}/10`,
          signals.red_flags.length > 0 ? `red_flags=${JSON.stringify(signals.red_flags)}` : null,
          signals.notable_dishes.length > 0
            ? `notable=${JSON.stringify(signals.notable_dishes)}`
            : null,
        ].filter(Boolean);
        if (parts.length > 0) signalLine = `\n   Review signals: ${parts.join(", ")}`;
      }
      return `${i + 1}. ${r.name} | ${r.cuisine} | ${r.price} | ⭐${r.rating} (${r.review_count} reviews) | ${r.address}${signalLine}`;
    })
    .join("\n");

  const prefContext = sessionPreferences
    ? formatSessionPreferences(sessionPreferences)
    : "";

  const fastServiceNote = requirements.service_pace_required === "fast"
    ? `\nFAST SERVICE MODE: User needs quick in-and-out dining. Heavily favour restaurants whose review signals show service_pace containing "quick", "fast", or "efficient". Penalise any restaurant with wait_time indicating >20 minute waits. Score preference_match low for slow-service venues. Mention service speed in why_recommended.`
    : "";

  const systemPrompt = `You are an expert ${cityFullName} restaurant advisor. Your job is to pick the best restaurants for the user's specific needs and explain exactly why each one fits or doesn't fit.

Be honest about downsides. Don't recommend places that don't fit. Quality of matching matters more than quantity.${fastServiceNote}`;

  const messages = [
    ...conversationHistory,
    {
      role: "user" as const,
      content: `User requirements: ${JSON.stringify(requirements, null, 2)}
${prefContext ? `\n${prefContext}` : ""}
${profileContext ? `\nUser profile: ${profileContext}` : ""}

Candidate restaurants:
${restaurantList}

Additional context from web search:
${semanticSignals}

Pick the TOP 10 restaurants that best match the user's needs. For each one, fill in scoring dimensions honestly, then write the explanation.

Also, based on the current results and user requirements, suggest 3-5 refinements the user might want to make (in Chinese), such as "更安静一点", "再便宜一点", "离地铁近一点" etc.

Return a JSON array:
[
  {
    "rank": 1,
    "restaurant_index": 0,
    "scoring": {
      "budget_match": 8,
      "scene_match": 9,
      "review_quality": 7,
      "location_convenience": 6,
      "preference_match": 5,
      "red_flag_penalty": 0
    },
    "why_recommended": "Perfect for a first date — intimate booths, candlelit, conversation-friendly noise level",
    "best_for": "Romantic dates, special occasions",
    "watch_out": "Book at least 3 days ahead, parking is tough",
    "not_great_if": "You're on a tight budget or want a lively atmosphere",
    "estimated_total": "$80-100 for two with drinks",
    "suggested_refinements": ["更安静一点", "再便宜一点", "离地铁近一点"]
  }
]

Return ONLY the JSON array, no other text.`,
    },
  ];

  const effectiveWeights = customWeights
    ? { ...DEFAULT_WEIGHTS, ...customWeights }
    : DEFAULT_WEIGHTS;
  const fallbackResult = buildFallbackRestaurantCards(
    requirements,
    restaurants,
    effectiveWeights
  );

  // Restaurant ranking / explanation uses OpenAI gpt-4o-mini. We switched
  // from MiniMax after observing chronic 30-60s timeouts on the largest
  // prompts (restaurant is the heaviest — it includes per-venue review
  // signals that blow up token count vs other categories). gpt-4o-mini is
  // cheap, fast, already used by Stagehand for its act() loops, and far
  // more reliable under parallel load. If it still fails we fall back to
  // SerpAPI-derived cards so the UI never shows an empty column.
  //
  // Timeout kept strictly under trip-package's outer 45s timeout so the
  // fallback path always has room to run (outer would otherwise kill the
  // whole pipeline before our catch fires).
  let text: string;
  try {
    text = await openaiChat({
      system: systemPrompt,
      messages,
      max_tokens: 4096,
      timeout_ms: 25_000,
    });
  } catch (err) {
    console.warn("[rankAndExplain] openaiChat threw — using SerpAPI data directly. err:", err);
    return fallbackResult;
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return fallbackResult;
  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return fallbackResult;
  }
  const parsed = RankedItemArraySchema.safeParse(raw);
  if (!parsed.success) return fallbackResult;

  // Extract suggested_refinements from first item (they should all be the same)
  const suggested_refinements: string[] = parsed.data[0]?.suggested_refinements ?? [];

  // Phase 3.2: compute weighted_total and re-sort by it
  type MappedItem = {
    rank: number;
    restaurant_index: number;
    score: number;
    scoring?: ScoringDimensions;
    why_recommended: string;
    best_for: string;
    watch_out: string;
    not_great_if: string;
    estimated_total: string;
    restaurant: Restaurant;
  };
  const cards: MappedItem[] = parsed.data
    .filter((item) => item.restaurant_index < restaurants.length)
    .map((item): MappedItem => {
      if (item.scoring) {
        const weighted_total = computeWeightedScore(item.scoring, effectiveWeights);
        return {
          ...item,
          score: weighted_total,
          scoring: { ...item.scoring, weighted_total },
          restaurant: restaurants[item.restaurant_index],
        };
      }
      return {
        ...item,
        scoring: undefined,
        restaurant: restaurants[item.restaurant_index],
      };
    })
    .sort((a, b) => {
      const aScore = (a.scoring as ScoringDimensions | undefined)?.weighted_total ?? a.score ?? 0;
      const bScore = (b.scoring as ScoringDimensions | undefined)?.weighted_total ?? b.score ?? 0;
      return bScore - aScore;
    })
    .map((item, i) => ({ ...item, rank: i + 1 }));

  return cards.length > 0 ? { cards, suggested_refinements } : fallbackResult;
}
