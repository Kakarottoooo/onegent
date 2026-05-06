// import Anthropic from "@anthropic-ai/sdk";
// const client = new Anthropic();

import { googlePlacesSearch, tavilySearch, geocodeLocation, fetchReviewSignals, searchHotels, searchFlights, resolveMultiAirport, normalizeDate, searchAfterDinnerVenue } from "./tools";
import { UserRequirements, Restaurant, RecommendationCard, SessionPreferences, ScoringDimensions, HotelIntent, RestaurantIntent, FlightIntent, CreditCardIntent, LaptopIntent, LaptopUseCase, ParsedIntent, HotelRecommendationCard, FlightRecommendationCard, CreditCardRecommendationCard, LaptopRecommendationCard, SpendingProfile, CategoryType, Flight, SubscriptionIntent, SmartphoneIntent, SmartphoneUseCase, SmartphoneRecommendationCard, HeadphoneIntent, HeadphoneUseCase, HeadphoneRecommendationCard, ScenarioIntent, DecisionPlan, ResultMode, WeekendTripIntent, CityTripIntent, DateNightIntent, MultilingualQueryContext, ActivityIntent, ActivityRecommendationCard } from "./types";
import type { WatchCategory } from "./watchTypes";
import { CITIES, DEFAULT_CITY } from "./cities";
import { UserRequirementsSchema, RankedItemArraySchema } from "./schemas";
import { detectScenarioFromMessage, parseScenarioIntent, runScenarioPlanner, runWeekendTripPlanner, runCityTripPlanner } from "./scenario2";
import { minimaxChat } from "./minimax";
import { analyzeMultilingualQuery, resolveLocationHint } from "./nlu";
import { getUserPreferences, sql } from "./db";
import { loadCalendarRecommendationContext } from "./calendar-recommendation-context";

// Sub-module imports
export { DEFAULT_WEIGHTS, HOTEL_DEFAULT_WEIGHTS, computeWeightedScore, extractRefinements } from "./agent/composer/scoring";
export { parseIntent } from "./agent/parse/index";

// Phase 4.1: StreamCallbacks type
export type StreamCallbacks = {
  onPartial?: (cards: RecommendationCard[], requirements: UserRequirements) => void;
};

import { DEFAULT_WEIGHTS, HOTEL_DEFAULT_WEIGHTS, computeWeightedScore, extractRefinements, formatSessionPreferences } from "./agent/composer/scoring";
import { parseIntent } from "./agent/parse/index";
import { runHotelPipeline } from "./agent/pipelines/hotel";
import { runFlightPipeline } from "./agent/pipelines/flight";
import { runActivityPipeline } from "./agent/pipelines/activity";
import { parseActivityIntent } from "./agent/parse/activity";
import { gatherCandidates, rankAndExplain } from "./agent/pipelines/restaurant";
import { parseWeekendTripIntent } from "./agent/parse/weekend-trip";
import { parseCityTripIntent } from "./agent/parse/city-trip";
import { buildWeekendTripFlightIntent, buildWeekendTripHotelIntent, buildWeekendTripRestaurantRequirements } from "./agent/planners/weekend-trip";
import { buildCityTripHotelIntent, buildCityTripRestaurantRequirements, buildCityTripBarRequirements } from "./agent/planners/city-trip";
import { buildDateNightFallbackIntent } from "./agent/planners/date-night";
import { parseConcertEventIntent } from "./agent/parse/concert-event";
import { runConcertEventPlanner } from "./agent/planners/concert-event";
import { ConcertEventIntent } from "./types";

export function applyCategoryHintOverride(
  queryContext: MultilingualQueryContext,
  categoryHintOverride?: CategoryType,
): MultilingualQueryContext {
  if (!categoryHintOverride) return queryContext;

  queryContext.category_hint = categoryHintOverride;
  // The confirm-card NLU has already chosen a concrete category. For
  // single-event activity asks, stale legacy scenario hints can otherwise
  // route the handoff into city-trip clarification.
  if (categoryHintOverride === "activity") {
    queryContext.scenario_hint = null;
  }
  return queryContext;
}

// ─── Main Agent Function ──────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
  cityId: string = DEFAULT_CITY,
  gpsCoords: { lat: number; lng: number } | null = null,
  nearLocation?: string,
  sessionPreferences?: SessionPreferences,
  profileContext?: string,
  streamCallbacks?: StreamCallbacks,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>,
  sessionId?: string,
  userId?: string,
  pinned_plan_id?: string,
  categoryHintOverride?: CategoryType
): Promise<{
  requirements:
    | UserRequirements
    | HotelIntent
    | FlightIntent
    | CreditCardIntent
    | LaptopIntent
    | SmartphoneIntent
    | HeadphoneIntent
    | SubscriptionIntent
    | ScenarioIntent
    | ActivityIntent;
  recommendations: RecommendationCard[];
  hotelRecommendations: HotelRecommendationCard[];
  flightRecommendations: FlightRecommendationCard[];
  creditCardRecommendations: CreditCardRecommendationCard[];
  laptopRecommendations: LaptopRecommendationCard[];
  laptop_db_gap_warning: string | null;
  smartphoneRecommendations: SmartphoneRecommendationCard[];
  headphoneRecommendations: HeadphoneRecommendationCard[];
  device_db_gap_warning: string | null;
  subscriptionIntent: SubscriptionIntent | null;
  activityRecommendations: ActivityRecommendationCard[];
  missing_activity_fields: string[];
  missing_credit_card_fields: string[];
  missing_flight_fields: string[];
  no_direct_available: boolean;
  suggested_refinements: string[];
  scenarioIntent: ScenarioIntent | null;
  decisionPlan: DecisionPlan | null;
  result_mode: ResultMode;
  category: CategoryType;
  output_language: "en" | "zh";
}> {
  const city = CITIES[cityId] ?? CITIES[DEFAULT_CITY];
  const cityFullName = gpsCoords ? "your current location" : city.fullName;

  const userPreferences =
    userId || sessionId
      ? await getUserPreferences(sessionId ?? "", userId).catch(() => ({}))
      : {};
  const queryContext = await analyzeMultilingualQuery(userMessage, cityFullName, userPreferences, { pinned_plan_id, conversationHistory });
  applyCategoryHintOverride(queryContext, categoryHintOverride);

  function buildBaseResult(
    requirements:
      | UserRequirements
      | HotelIntent
      | FlightIntent
      | CreditCardIntent
      | LaptopIntent
      | SmartphoneIntent
      | HeadphoneIntent
      | SubscriptionIntent
      | ScenarioIntent
      | ActivityIntent,
    category: CategoryType,
    overrides: Partial<{
      recommendations: RecommendationCard[];
      hotelRecommendations: HotelRecommendationCard[];
      flightRecommendations: FlightRecommendationCard[];
      creditCardRecommendations: CreditCardRecommendationCard[];
      laptopRecommendations: LaptopRecommendationCard[];
      laptop_db_gap_warning: string | null;
      smartphoneRecommendations: SmartphoneRecommendationCard[];
      headphoneRecommendations: HeadphoneRecommendationCard[];
      device_db_gap_warning: string | null;
      subscriptionIntent: SubscriptionIntent | null;
      activityRecommendations: ActivityRecommendationCard[];
      missing_activity_fields: string[];
      missing_credit_card_fields: string[];
      missing_flight_fields: string[];
      no_direct_available: boolean;
      suggested_refinements: string[];
      scenarioIntent: ScenarioIntent | null;
      decisionPlan: DecisionPlan | null;
      result_mode: ResultMode;
      output_language: "en" | "zh";
    }> = {}
  ) {
    return {
      requirements,
      recommendations: [],
      hotelRecommendations: [],
      flightRecommendations: [],
      creditCardRecommendations: [],
      laptopRecommendations: [],
      laptop_db_gap_warning: null,
      smartphoneRecommendations: [],
      headphoneRecommendations: [],
      device_db_gap_warning: null,
      subscriptionIntent: null,
      activityRecommendations: [],
      missing_activity_fields: [],
      missing_credit_card_fields: [],
      missing_flight_fields: [],
      no_direct_available: false,
      suggested_refinements: [],
      scenarioIntent: null,
      decisionPlan: null,
      result_mode: "category_cards" as ResultMode,
      category,
      output_language: queryContext.output_language,
      ...overrides,
    };
  }

  const detectedScenario =
    queryContext.scenario_hint ?? detectScenarioFromMessage(userMessage);
  // ─── G-3: Module-level refine for weekend_trip ──────────────────────────────
  if (
    queryContext.refine_module &&
    queryContext.pinned_plan_id &&
    (queryContext.refine_module === "hotel" || queryContext.refine_module === "flight")
  ) {
    // Fetch the existing plan from DB
    const existingPlanRow = await sql`
      SELECT plan_json FROM decision_plans WHERE id = ${queryContext.pinned_plan_id}
    `.then((r) => r.rows[0]).catch(() => null);

    if (existingPlanRow?.plan_json) {
      const existingPlan: DecisionPlan = existingPlanRow.plan_json as DecisionPlan;
      if (existingPlan.scenario === "weekend_trip") {
        const scenarioIntent = await parseWeekendTripIntent(userMessage, city.fullName, queryContext);

        if (queryContext.refine_module === "hotel") {
          // Re-run hotel pipeline, keep existing flight
          const hotelIntent = buildWeekendTripHotelIntent(scenarioIntent);
          const { hotelRecommendations } = await runHotelPipeline(
            hotelIntent,
            conversationHistory,
            scenarioIntent.destination_city ?? cityFullName
          );

          if (hotelRecommendations.length > 0) {
            // Carry over flight recommendations from the existing plan via the evidence_card_ids
            const decisionPlan = runWeekendTripPlanner({
              scenarioIntent,
              flightRecommendations: [],   // no new flights; plan builder handles missing
              hotelRecommendations,
              creditCardRecommendations: [],
              userMessage,
              outputLanguage: queryContext.output_language,
            });

            if (decisionPlan) {
              return buildBaseResult(scenarioIntent, "trip", {
                scenarioIntent,
                decisionPlan: { ...decisionPlan, id: crypto.randomUUID() },
                hotelRecommendations,
                result_mode: "scenario_plan",
              });
            }
          }
        }

        if (queryContext.refine_module === "flight") {
          // Re-run flight pipeline, keep existing hotel
          const flightIntent = buildWeekendTripFlightIntent(scenarioIntent);
          const { flightRecommendations, no_direct_available } = await runFlightPipeline(flightIntent);

          if (flightRecommendations.length > 0) {
            const decisionPlan = runWeekendTripPlanner({
              scenarioIntent,
              flightRecommendations,
              hotelRecommendations: [],
              creditCardRecommendations: [],
              userMessage,
              outputLanguage: queryContext.output_language,
            });

            if (decisionPlan) {
              return buildBaseResult(scenarioIntent, "trip", {
                scenarioIntent,
                decisionPlan: { ...decisionPlan, id: crypto.randomUUID() },
                flightRecommendations,
                no_direct_available,
                result_mode: "scenario_plan",
              });
            }
          }
        }
      }
    }
    // If refine failed (no existing plan or pipeline error), fall through to normal flow
  }

  if (detectedScenario === "weekend_trip") {
    const scenarioIntent = await parseWeekendTripIntent(
      userMessage,
      city.fullName,  // use real city name (not "your current location") for flight/hotel departure
      queryContext
    );
    console.log(`[weekend_trip] intent parsed: ${scenarioIntent.departure_city} → ${scenarioIntent.destination_city}, ${scenarioIntent.start_date}–${scenarioIntent.end_date}, ${scenarioIntent.nights}n, hotel★${scenarioIntent.hotel_star_rating ?? "any"}, needs_clarification=${scenarioIntent.needs_clarification}, missing=${JSON.stringify(scenarioIntent.missing_fields)}`);
    if (scenarioIntent.needs_clarification) {
      return buildBaseResult(scenarioIntent, "trip", {
        scenarioIntent,
        result_mode: "followup_refinement",
      });
    }

    const flightIntent = buildWeekendTripFlightIntent(scenarioIntent);
    const hotelIntent = buildWeekendTripHotelIntent(scenarioIntent);
    const restaurantReqs = buildWeekendTripRestaurantRequirements(scenarioIntent);

    // Run flight + hotel + restaurants in parallel; all are best-effort
    // Flight: 20s cap. Hotel: 40s cap. Restaurants: 25s cap.
    const flightTimeout = new Promise<{ flightRecommendations: []; no_direct_available: false }>(
      (resolve) => setTimeout(() => resolve({ flightRecommendations: [], no_direct_available: false }), 20_000)
    );
    const hotelTimeout = new Promise<{ hotelRecommendations: []; suggested_refinements: [] }>(
      (resolve) => setTimeout(() => resolve({ hotelRecommendations: [], suggested_refinements: [] }), 40_000)
    );
    const restaurantTimeout = new Promise<{ cards: [] }>(
      (resolve) => setTimeout(() => resolve({ cards: [] }), 25_000)
    );
    const [flightResult, { hotelRecommendations }, { cards: restaurantCards }] = await Promise.all([
      Promise.race([runFlightPipeline(flightIntent), flightTimeout])
        .catch(() => ({ flightRecommendations: [] as [], no_direct_available: false as const })),
      Promise.race([
        runHotelPipeline(hotelIntent, conversationHistory, scenarioIntent.destination_city ?? cityFullName),
        hotelTimeout,
      ]).catch(() => ({ hotelRecommendations: [] as [], suggested_refinements: [] as [] })),
      Promise.race([
        gatherCandidates(restaurantReqs, cityId, null, undefined)
          .then((r) => rankAndExplain(restaurantReqs, r.restaurants, r.semanticSignals, conversationHistory, scenarioIntent.destination_city ?? cityFullName, sessionPreferences, profileContext, customWeights))
          .then((cards) => ({ cards })),
        restaurantTimeout,
      ]).catch(() => ({ cards: [] as [] })),
    ]);
    const { flightRecommendations, no_direct_available } = flightResult;

    if (hotelRecommendations.length === 0 && flightRecommendations.length === 0) {
      const refinedIntent: WeekendTripIntent = {
        ...scenarioIntent,
        needs_clarification: true,
        missing_fields: ["different dates or destination"],
        planning_assumptions: [
          ...scenarioIntent.planning_assumptions,
          "No matching live flight or hotel inventory came back for the current package assumptions.",
        ],
      };
      return buildBaseResult(refinedIntent, "trip", {
        scenarioIntent: refinedIntent,
        result_mode: "followup_refinement",
        flightRecommendations,
        hotelRecommendations,
      });
    }

    // Partial result: one pipeline succeeded but not both
    if (flightRecommendations.length === 0 && hotelRecommendations.length > 0) {
      console.warn(`[weekend_trip] No flights found for ${scenarioIntent.departure_city} → ${scenarioIntent.destination_city} on ${scenarioIntent.start_date}. Hotels found: ${hotelRecommendations.length}`);
      const refinedIntent: WeekendTripIntent = {
        ...scenarioIntent,
        needs_clarification: true,
        missing_fields: ["flight availability — no flights found for this route/date"],
        planning_assumptions: [
          ...scenarioIntent.planning_assumptions,
          `No flights found from ${scenarioIntent.departure_city ?? "origin"} to ${scenarioIntent.destination_city ?? "destination"} on ${scenarioIntent.start_date ?? "this date"} — hotel results are ready. Try a different travel date or check Google Flights directly.`,
        ],
      };
      return buildBaseResult(refinedIntent, "trip", {
        scenarioIntent: refinedIntent,
        result_mode: "followup_refinement",
        flightRecommendations: [],
        hotelRecommendations,
      });
    }

    if (hotelRecommendations.length === 0 && flightRecommendations.length > 0) {
      console.warn(`[weekend_trip] No hotels found in ${scenarioIntent.destination_city} for ${scenarioIntent.start_date}–${scenarioIntent.end_date}. Flights found: ${flightRecommendations.length}`);
      const refinedIntent: WeekendTripIntent = {
        ...scenarioIntent,
        needs_clarification: true,
        missing_fields: ["hotel availability — no hotels found for this destination/date"],
        planning_assumptions: [
          ...scenarioIntent.planning_assumptions,
          `No hotels found in ${scenarioIntent.destination_city ?? "this destination"} for ${scenarioIntent.start_date ?? "these dates"} — flight results are ready. Try adjusting hotel criteria.`,
        ],
      };
      return buildBaseResult(refinedIntent, "trip", {
        scenarioIntent: refinedIntent,
        result_mode: "followup_refinement",
        flightRecommendations,
        hotelRecommendations: [],
      });
    }

    const decisionPlan = runWeekendTripPlanner({
      scenarioIntent,
      flightRecommendations,
      hotelRecommendations,
      creditCardRecommendations: [],
      restaurantRecommendations: Array.isArray(restaurantCards) ? restaurantCards as import("./types").RecommendationCard[] : [],
      userMessage,
      outputLanguage: queryContext.output_language,
    });

    return buildBaseResult(scenarioIntent, "trip", {
      scenarioIntent,
      decisionPlan,
      flightRecommendations,
      hotelRecommendations,
      no_direct_available,
      result_mode: decisionPlan ? "scenario_plan" : "followup_refinement",
    });
  }

  if (detectedScenario === "city_trip") {
    const scenarioIntent = await parseCityTripIntent(userMessage, queryContext);

    if (scenarioIntent.needs_clarification) {
      return buildBaseResult(scenarioIntent, "trip", {
        scenarioIntent,
        result_mode: "followup_refinement",
      });
    }

    const hotelIntent = buildCityTripHotelIntent(scenarioIntent);
    const restaurantRequirements = buildCityTripRestaurantRequirements(scenarioIntent);
    const barRequirements = buildCityTripBarRequirements(scenarioIntent);

    const [
      { hotelRecommendations },
      { cards: restaurantCards },
      { cards: barCards },
    ] = await Promise.all([
      runHotelPipeline(hotelIntent, conversationHistory, scenarioIntent.destination_city),
      gatherCandidates(restaurantRequirements, cityId, null, undefined).then((r) =>
        rankAndExplain(restaurantRequirements, r.restaurants, r.semanticSignals, conversationHistory, scenarioIntent.destination_city, sessionPreferences, profileContext, customWeights)
      ),
      gatherCandidates(barRequirements, cityId, null, undefined).then((r) =>
        rankAndExplain(barRequirements, r.restaurants, r.semanticSignals, conversationHistory, scenarioIntent.destination_city, sessionPreferences, profileContext, customWeights)
      ),
    ]);

    const decisionPlan = runCityTripPlanner({
      scenarioIntent,
      hotelRecommendations,
      restaurantRecommendations: Array.isArray(restaurantCards) ? restaurantCards as import("./types").RecommendationCard[] : [],
      barRecommendations: barCards,
      outputLanguage: queryContext.output_language,
    });

    return buildBaseResult(scenarioIntent, "trip", {
      scenarioIntent,
      decisionPlan,
      hotelRecommendations,
      recommendations: [...restaurantCards, ...barCards],
      result_mode: decisionPlan ? "scenario_plan" : "followup_refinement",
    });
  }

  if (detectedScenario === "concert_event") {
    const concertIntent = parseConcertEventIntent(userMessage, queryContext);
    let decisionPlan = await runConcertEventPlanner({
      intent: concertIntent,
      outputLanguage: queryContext.output_language,
    });

    if (!decisionPlan) {
      const noResults: ConcertEventIntent = {
        ...concertIntent,
        needs_clarification: true,
        missing_fields: [...concertIntent.missing_fields, "no events found — try different dates or keywords"],
      };
      return buildBaseResult(noResults, "trip", {
        scenarioIntent: noResults,
        result_mode: "followup_refinement",
      });
    }

    const concertCalendarContext = await loadCalendarRecommendationContext({
      userId,
      dateText: concertIntent.event_date ?? null,
      timeHint: null,
      durationMinutes: 180,
    });
    if (concertCalendarContext) {
      decisionPlan = {
        ...decisionPlan,
        risks: [concertCalendarContext.noteForUser, ...decisionPlan.risks],
      };
    }

    return buildBaseResult(concertIntent, "trip", {
      scenarioIntent: concertIntent,
      decisionPlan,
      result_mode: "scenario_plan",
      output_language: queryContext.output_language,
    });
  }

  // Layer 1: Parse intent (with session preferences + profile context)
  const intent = await parseIntent(
    userMessage,
    cityFullName,
    queryContext,
    sessionPreferences,
    profileContext,
    conversationHistory
  );

  // Route to subscription intent — no server-side pipeline, client handles storage
  if (intent.category === "subscription") {
    return buildBaseResult(intent, "subscription", {
      subscriptionIntent: intent,
    });
  }

  // Route to flight pipeline if needed
  if (intent.category === "flight") {
    const { flightRecommendations, missing_fields, no_direct_available } = await runFlightPipeline(intent);
    return buildBaseResult(intent, "flight", {
      flightRecommendations,
      missing_flight_fields: missing_fields,
      no_direct_available,
    });
  }

  // Route to hotel pipeline if needed
  if (intent.category === "hotel") {
    const { hotelRecommendations, suggested_refinements } = await runHotelPipeline(
      intent,
      conversationHistory,
      cityFullName,
    );
    return buildBaseResult(intent, "hotel", {
      hotelRecommendations,
      suggested_refinements,
    });
  }

  // Route to activity pipeline (SeatGeek direct-card path for solo ticketed events)
  if (intent.category === "activity") {
    const { activityRecommendations, missing_fields, suggested_refinements } = await runActivityPipeline(intent);
    const activityCalendarContext = await loadCalendarRecommendationContext({
      userId,
      dateText: intent.date_from ?? intent.date_to ?? null,
      timeHint: queryContext.time_hint ?? null,
      durationMinutes: 180,
    });
    return buildBaseResult(intent, "activity", {
      activityRecommendations,
      missing_activity_fields: missing_fields,
      suggested_refinements: activityCalendarContext
        ? [...suggested_refinements, activityCalendarContext.noteForUser]
        : suggested_refinements,
    });
  }

  // Non-travel categories are unreachable via the NluScenario union (see
  // lib/agent/nlu-v2/types.ts) but ParsedIntent still allows them structurally.
  // Guard here so the restaurant path only ever sees RestaurantIntent; a future
  // US will add a proper graceful-decline reply via NLU v2.
  if (
    intent.category === "credit_card" ||
    intent.category === "laptop" ||
    intent.category === "smartphone" ||
    intent.category === "headphone"
  ) {
    return buildBaseResult(intent, intent.category);
  }

  // Otherwise continue with restaurant pipeline
  const requirements: UserRequirements = intent;
  // parseScenarioIntent uses regex + intent signals to detect date_night.
  // buildDateNightFallbackIntent only activates when there are explicit date signals
  // (purpose=date, scenario_hint=date_night, or English/Chinese date keywords) — it
  // returns null for plain restaurant queries, so scenarioIntent is null in that case.
  const parsedScenario = parseScenarioIntent(userMessage, intent);
  const scenarioIntent =
    parsedScenario ??
    buildDateNightFallbackIntent(userMessage, intent, queryContext);
  if (!parsedScenario && scenarioIntent !== null) {
    console.log("[agent] date_night scenario activated via fallback intent builder", {
      purpose: intent.purpose,
      scenario_hint: queryContext?.scenario_hint,
    });
  }

  const restaurantCalendarContext = await loadCalendarRecommendationContext({
    userId,
    dateText:
      scenarioIntent?.scenario === "date_night"
        ? scenarioIntent.detected_date_text ?? queryContext.date_text_hint ?? null
        : queryContext.date_text_hint ?? null,
    timeHint:
      scenarioIntent?.scenario === "date_night"
        ? scenarioIntent.time_hint ?? queryContext.time_hint ?? null
        : queryContext.time_hint ?? null,
    durationMinutes: scenarioIntent?.scenario === "date_night" ? 120 : 90,
  });
  const restaurantConversationHistory = restaurantCalendarContext
    ? [...conversationHistory, { role: "assistant" as const, content: restaurantCalendarContext.noteForAgent }]
    : conversationHistory;

  // Layer 2+3: Gather candidates (parallel search)
  const { restaurants, semanticSignals, tavilyQuery, searchCityLabel } = await gatherCandidates(
    requirements,
    cityId,
    gpsCoords,
    nearLocation
  );
  const restaurantCityLabel = searchCityLabel || requirements.location || cityFullName;

  // Phase 4.1: Send partial results after candidate gathering
  if (streamCallbacks?.onPartial) {
    // Quick top 3 sorted by rating * log(review_count + 1)
    const quickTop3: RecommendationCard[] = restaurants
      .slice()
      .sort((a, b) => b.rating * Math.log(b.review_count + 1) - a.rating * Math.log(a.review_count + 1))
      .slice(0, 3)
      .map((r, i) => ({
        restaurant: r,
        rank: i + 1,
        score: r.rating,
        why_recommended: `${r.name} — ⭐${r.rating} (${r.review_count} reviews)`,
        best_for: r.cuisine,
        watch_out: "",
        not_great_if: "",
        estimated_total: r.price,
      }));
    streamCallbacks.onPartial(quickTop3, requirements);
  }

  // Phase 3.1: Extract review signals for top candidates (non-blocking)
  const reviewSignalsMap = await fetchReviewSignals(
    restaurants.slice(0, 12),
    tavilyQuery,
    restaurantCityLabel
  ).catch(() => new Map());

  // Inject review signals into restaurant objects
  const candidatesWithSignals = restaurants.map((r) => ({
    ...r,
    review_signals: reviewSignalsMap.get(r.name),
  }));

  // Layer 4+5+6: Rank and explain (with scoring + preferences)
  const { cards, suggested_refinements } = await rankAndExplain(
    requirements,
    candidatesWithSignals,
    semanticSignals,
    restaurantConversationHistory,
    restaurantCityLabel,
    sessionPreferences,
    profileContext,
    customWeights
  );

  // Add OpenTable search URLs
  const withOpenTable = cards.map((card) => ({
    ...card,
    opentable_url: card.restaurant?.name
      ? `https://www.opentable.com/s?term=${encodeURIComponent(card.restaurant.name + " " + restaurantCityLabel)}&covers=${requirements.party_size ?? 2}`
      : undefined,
  }));

  // For date_night, search for an after-dinner venue near the primary restaurant.
  const primaryRestaurantCoords =
    scenarioIntent?.scenario === "date_night" && withOpenTable[0]?.restaurant
      ? { lat: withOpenTable[0].restaurant.lat!, lng: withOpenTable[0].restaurant.lng! }
      : undefined;
  const _followUpPref = scenarioIntent?.scenario === "date_night"
    ? (scenarioIntent as import("./types").DateNightIntent).follow_up_preference
    : "none";
  // Map follow_up_preference to venue type for filtered search ("cocktail" and "dessert" narrow the query).
  const _venueType: "cocktail" | "dessert" | "open" =
    _followUpPref === "cocktail" ? "cocktail"
    : _followUpPref === "dessert" ? "dessert"
    : "open";
  const afterDinnerOption =
    scenarioIntent?.scenario === "date_night" &&
    _followUpPref !== "none" && _followUpPref !== "walk"
      ? await searchAfterDinnerVenue(
          restaurantCityLabel,
          primaryRestaurantCoords?.lat !== undefined && primaryRestaurantCoords?.lng !== undefined
            ? primaryRestaurantCoords
            : undefined,
          _venueType
        )
      : null;

  const decisionPlan =
    scenarioIntent?.scenario === "date_night"
    ? runScenarioPlanner({
        scenarioIntent,
        recommendations: withOpenTable,
        userMessage,
        cityLabel: restaurantCityLabel,
        outputLanguage: queryContext.output_language,
        afterDinnerOption,
      })
    : null;
  const decisionPlanWithCalendarRisk =
    decisionPlan && restaurantCalendarContext
      ? {
          ...decisionPlan,
          risks: [restaurantCalendarContext.noteForUser, ...decisionPlan.risks],
        }
      : decisionPlan;

  return buildBaseResult(requirements, "restaurant", {
    recommendations: withOpenTable,
    suggested_refinements: restaurantCalendarContext
      ? [restaurantCalendarContext.noteForUser, ...suggested_refinements]
      : suggested_refinements,
    scenarioIntent,
    decisionPlan: decisionPlanWithCalendarRisk,
    result_mode: decisionPlanWithCalendarRisk ? "scenario_plan" : "category_cards",
  });
}
