import { describe, it, expect } from "vitest";
import {
  detectScenarioFromMessage,
  detectScenario,
  parseScenarioIntent,
  runScenarioPlanner,
  runWeekendTripPlanner,
  runCityTripPlanner,
} from "../scenario2";
import type {
  CityTripIntent,
  CreditCardRecommendationCard,
  DateNightIntent,
  Flight,
  FlightRecommendationCard,
  Hotel,
  HotelRecommendationCard,
  RecommendationCard,
  Restaurant,
  RestaurantIntent,
  WeekendTripIntent,
} from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseRestaurantIntent = (): RestaurantIntent => ({
  category: "restaurant",
  cuisine: "Italian",
  party_size: 2,
});

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "r1",
    name: "Trattoria Roma",
    cuisine: "Italian",
    price: "$$$",
    rating: 4.5,
    review_count: 300,
    address: "123 Main St",
    is_closed: false,
    ...overrides,
  };
}

function makeCard(overrides: Partial<RecommendationCard> = {}): RecommendationCard {
  return {
    restaurant: makeRestaurant(),
    rank: 1,
    score: 8.5,
    why_recommended: "Great ambiance for dates",
    best_for: "Romantic dinners",
    watch_out: "Can get loud on weekends",
    not_great_if: "Looking for a quick meal",
    estimated_total: "$80–100 for two",
    ...overrides,
  };
}

// ─── detectScenarioFromMessage ────────────────────────────────────────────────

describe("detectScenarioFromMessage", () => {
  it("detects date_night from 'date night'", () => {
    expect(detectScenarioFromMessage("Looking for a date night restaurant")).toBe("date_night");
  });

  it("detects date_night from 'romantic'", () => {
    expect(detectScenarioFromMessage("Something romantic for dinner")).toBe("date_night");
  });

  it("detects date_night from 'anniversary'", () => {
    expect(detectScenarioFromMessage("Anniversary dinner reservation")).toBe("date_night");
  });

  it("detects date_night from 'first date'", () => {
    expect(detectScenarioFromMessage("best spot for a first date")).toBe("date_night");
  });

  it("detects date_night from Chinese 约会", () => {
    expect(detectScenarioFromMessage("帮我找个约会餐厅")).toBe("date_night");
  });

  it("detects date_night from Chinese 浪漫", () => {
    expect(detectScenarioFromMessage("浪漫的法餐厅在哪里")).toBe("date_night");
  });

  it("detects weekend_trip over date_night when both signals present", () => {
    // weekend trip takes priority in detectScenarioFromMessage
    expect(detectScenarioFromMessage("weekend trip to NYC with girlfriend")).toBe("weekend_trip");
  });

  it("detects weekend_trip from explicit phrase", () => {
    expect(detectScenarioFromMessage("planning a weekend getaway to Chicago")).toBe("weekend_trip");
  });

  it("detects weekend_trip from combined signals", () => {
    expect(detectScenarioFromMessage("booking a flight and hotel for the weekend")).toBe("weekend_trip");
  });

  it("detects city_trip from travel + hotel + restaurant signals", () => {
    expect(
      detectScenarioFromMessage(
        "i am going to travel to la, i need a hotel for 3 days and want to go to music bars and try some good restaurants, formulate several plans for me"
      )
    ).toBe("city_trip");
  });

  it("detects city_trip from visiting + hotel + bars", () => {
    expect(
      detectScenarioFromMessage("visiting Nashville next friday, reserve a 4 star hotel and suggest some bars and restaurants")
    ).toBe("city_trip");
  });

  it("detects city_trip from itinerary keyword + hotel", () => {
    expect(
      detectScenarioFromMessage("help me build an itinerary for NYC with hotel and dining")
    ).toBe("city_trip");
  });

  it("does not detect city_trip from hotel-only without activities", () => {
    expect(detectScenarioFromMessage("find me a hotel in Boston")).toBeNull();
  });

  it("does not detect city_trip from restaurant-only without hotel", () => {
    expect(detectScenarioFromMessage("best bars and restaurants in LA")).toBeNull();
  });

  it("detects weekend_trip over city_trip when flight+hotel both present", () => {
    expect(
      detectScenarioFromMessage("book a flight and hotel to Chicago this weekend")
    ).toBe("weekend_trip");
  });

  it("returns null for a plain restaurant query", () => {
    expect(detectScenarioFromMessage("best sushi in San Francisco")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectScenarioFromMessage("")).toBeNull();
  });
});

// ─── detectScenario ───────────────────────────────────────────────────────────

describe("detectScenario", () => {
  it("returns date_night when intent.purpose is 'date'", () => {
    const intent = { ...baseRestaurantIntent(), purpose: "date" };
    expect(detectScenario("dinner tonight", intent)).toBe("date_night");
  });

  it("returns date_night when message matches date regex", () => {
    const intent = baseRestaurantIntent();
    expect(detectScenario("romantic restaurant for two", intent)).toBe("date_night");
  });

  it("returns date_night when party_size=2 + quiet atmosphere", () => {
    const intent: RestaurantIntent = {
      ...baseRestaurantIntent(),
      party_size: 2,
      atmosphere: ["romantic", "intimate"],
    };
    expect(detectScenario("dinner for two", intent)).toBe("date_night");
  });

  it("returns null for non-restaurant category even with date words", () => {
    const intent = { category: "hotel" as const, party_size: 2 };
    // detectScenario only returns date_night for restaurant category
    expect(detectScenario("romantic hotel for my partner", intent as unknown as RestaurantIntent)).toBeNull();
  });

  it("returns null for a plain restaurant query", () => {
    const intent = baseRestaurantIntent();
    expect(detectScenario("best tacos in LA", intent)).toBeNull();
  });

  it("returns null when party_size=2 but atmosphere is not romantic", () => {
    const intent: RestaurantIntent = {
      ...baseRestaurantIntent(),
      party_size: 2,
      atmosphere: ["lively", "energetic"],
    };
    expect(detectScenario("dinner for two friends", intent)).toBeNull();
  });
});

// ─── parseScenarioIntent ──────────────────────────────────────────────────────

describe("parseScenarioIntent", () => {
  it("returns null for a non-date-night query", () => {
    const intent = baseRestaurantIntent();
    expect(parseScenarioIntent("best ramen in NYC", intent)).toBeNull();
  });

  it("returns a DateNightIntent with scenario='date_night'", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date" };
    const result = parseScenarioIntent("romantic dinner tonight", intent);
    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("date_night");
  });

  it("infers stage=first_date from 'first date' in message", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date" };
    const result = parseScenarioIntent("best restaurant for a first date", intent) as DateNightIntent | null;
    expect(result?.stage).toBe("first_date");
  });

  it("infers stage=anniversary from 'anniversary' in message", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date" };
    const result = parseScenarioIntent("anniversary dinner reservation", intent) as DateNightIntent | null;
    expect(result?.stage).toBe("anniversary");
  });

  it("infers stage=steady_relationship from 'girlfriend' in message", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date" };
    const result = parseScenarioIntent("dinner with my girlfriend", intent) as DateNightIntent | null;
    expect(result?.stage).toBe("steady_relationship");
  });

  it("sets wants_quiet_buffer=true when noise_level is quiet", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date", noise_level: "quiet" };
    const result = parseScenarioIntent("romantic restaurant", intent) as DateNightIntent | null;
    expect(result?.wants_quiet_buffer).toBe(true);
  });

  it("sets wants_quiet_buffer=true when message mentions 'quiet'", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date" };
    const result = parseScenarioIntent("quiet romantic dinner for two", intent) as DateNightIntent | null;
    expect(result?.wants_quiet_buffer).toBe(true);
  });

  it("preserves base intent fields (cuisine, party_size)", () => {
    const intent: RestaurantIntent = { ...baseRestaurantIntent(), purpose: "date", cuisine: "French" };
    const result = parseScenarioIntent("romantic French restaurant", intent) as DateNightIntent | null;
    expect(result?.cuisine).toBe("French");
    expect(result?.party_size).toBe(2);
  });
});

// ─── runScenarioPlanner ───────────────────────────────────────────────────────

describe("runScenarioPlanner", () => {
  const baseIntent = (): DateNightIntent => ({
    category: "restaurant",
    scenario: "date_night",
    scenario_goal: "A great evening for two",
    stage: "steady_relationship",
    follow_up_preference: "dessert",
    decision_style: "romantic",
    wants_quiet_buffer: false,
    party_size: 2,
    purpose: "date",
  });

  it("returns null when recommendations array is empty", () => {
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [],
      userMessage: "romantic dinner",
      cityLabel: "San Francisco, CA",
      outputLanguage: "en",
    });
    expect(result).toBeNull();
  });

  it("returns a DecisionPlan with scenario='date_night'", () => {
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [makeCard()],
      userMessage: "romantic dinner for two",
      cityLabel: "San Francisco, CA",
      outputLanguage: "en",
    });
    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("date_night");
  });

  it("plan id is based on the primary restaurant id", () => {
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [makeCard({ restaurant: makeRestaurant({ id: "abc123" }) })],
      userMessage: "date night",
      cityLabel: "San Francisco, CA",
      outputLanguage: "en",
    });
    expect(result?.id).toBe("date-night-abc123");
  });

  it("includes backup plans when multiple recommendations provided", () => {
    const cards = [
      makeCard({ restaurant: makeRestaurant({ id: "r1", name: "Roma" }), rank: 1 }),
      makeCard({ restaurant: makeRestaurant({ id: "r2", name: "Bistro" }), rank: 2 }),
      makeCard({ restaurant: makeRestaurant({ id: "r3", name: "Sakura" }), rank: 3 }),
    ];
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: cards,
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
    });
    expect(result?.backup_plans).toHaveLength(2);
  });

  it("caps backup plans at 2 even with many recommendations", () => {
    const cards = Array.from({ length: 6 }, (_, i) =>
      makeCard({ restaurant: makeRestaurant({ id: `r${i}`, name: `Restaurant ${i}` }), rank: i + 1 })
    );
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: cards,
      userMessage: "date night",
      cityLabel: "NYC",
      outputLanguage: "en",
    });
    expect(result?.backup_plans.length).toBeLessThanOrEqual(2);
  });

  it("sets show_more_available=true when >3 recommendations, false otherwise", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      makeCard({ restaurant: makeRestaurant({ id: `r${i}`, name: `R${i}` }), rank: i + 1 })
    );
    const resultMany = runScenarioPlanner({
      scenarioIntent: baseIntent(), recommendations: many,
      userMessage: "date night", cityLabel: "NYC", outputLanguage: "en",
    });
    expect(resultMany?.show_more_available).toBe(true);

    const few = Array.from({ length: 3 }, (_, i) =>
      makeCard({ restaurant: makeRestaurant({ id: `r${i}`, name: `R${i}` }), rank: i + 1 })
    );
    const resultFew = runScenarioPlanner({
      scenarioIntent: baseIntent(), recommendations: few,
      userMessage: "date night", cityLabel: "NYC", outputLanguage: "en",
    });
    expect(resultFew?.show_more_available).toBe(false);
  });

  it("returns Chinese output when output_language is zh", () => {
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [makeCard()],
      userMessage: "约会晚餐",
      cityLabel: "旧金山",
      outputLanguage: "zh",
    });
    expect(result?.output_language).toBe("zh");
    // summary should contain Chinese characters
    expect(/[\u3040-\u30ff\u3400-\u9fff]/.test(result?.summary ?? "")).toBe(true);
  });

  it("evidence_items contains primary restaurant", () => {
    const restaurant = makeRestaurant({ id: "r1", name: "Trattoria Roma" });
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [makeCard({ restaurant })],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
    });
    expect(result?.evidence_items[0].id).toBe("r1");
    expect(result?.evidence_items[0].title).toBe("Trattoria Roma");
  });

  it("plan has required DecisionPlan fields", () => {
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
    });
    expect(result).toMatchObject({
      id: expect.any(String),
      scenario: "date_night",
      output_language: "en",
      title: expect.any(String),
      summary: expect.any(String),
      approval_prompt: expect.any(String),
      confidence: expect.stringMatching(/^(high|medium|low)$/),
      primary_plan: expect.objectContaining({ id: expect.any(String) }),
      next_actions: expect.any(Array),
      evidence_items: expect.any(Array),
    });
  });
});

// ─── detectScenario (intent-aware) ───────────────────────────────────────────

describe("detectScenario", () => {
  it("returns date_night when intent.purpose is date (restaurant category)", () => {
    const intent: RestaurantIntent = { category: "restaurant", cuisine: "Italian", purpose: "date" };
    expect(detectScenario("dinner for two", intent)).toBe("date_night");
  });

  it("returns date_night from romantic keyword even without purpose=date", () => {
    const intent: RestaurantIntent = { category: "restaurant", cuisine: "French" };
    expect(detectScenario("romantic dinner in Manhattan", intent)).toBe("date_night");
  });

  it("returns date_night from party_size=2 + quiet atmosphere", () => {
    const intent: RestaurantIntent = {
      category: "restaurant",
      cuisine: "French",
      party_size: 2,
      noise_level: "quiet",
    };
    expect(detectScenario("dinner for two", intent)).toBe("date_night");
  });

  it("returns null for non-restaurant category even with romantic keywords", () => {
    const intent = { category: "hotel" as const, purpose: "date" };
    // Non-restaurant: only weekend_trip is detectable
    expect(detectScenario("romantic hotel stay", intent)).toBeNull();
  });

  it("returns weekend_trip for non-restaurant + weekend trip signal", () => {
    const intent = { category: "hotel" as const };
    expect(detectScenario("weekend trip to Chicago with hotel and flight", intent)).toBe("weekend_trip");
  });

  it("returns null for plain restaurant search with no scenario signals", () => {
    const intent: RestaurantIntent = { category: "restaurant", cuisine: "Pizza" };
    expect(detectScenario("find me a good pizza place", intent)).toBeNull();
  });
});

// ─── parseScenarioIntent ─────────────────────────────────────────────────────

describe("parseScenarioIntent", () => {
  it("returns null when scenario is not date_night", () => {
    const intent: RestaurantIntent = { category: "restaurant", cuisine: "Pizza" };
    expect(parseScenarioIntent("find me a pizza place", intent)).toBeNull();
  });

  it("returns DateNightIntent with scenario=date_night when detected", () => {
    const intent: RestaurantIntent = { category: "restaurant", cuisine: "French", purpose: "date" };
    const result = parseScenarioIntent("romantic dinner for two", intent);
    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("date_night");
    expect(result?.category).toBe("restaurant");
  });

  it("sets wants_quiet_buffer when noise_level is quiet", () => {
    const intent: RestaurantIntent = { category: "restaurant", purpose: "date", noise_level: "quiet" };
    const result = parseScenarioIntent("quiet romantic dinner", intent) as DateNightIntent | null;
    expect(result?.wants_quiet_buffer).toBe(true);
  });

  it("sets wants_quiet_buffer from message keywords", () => {
    const intent: RestaurantIntent = { category: "restaurant", purpose: "date" };
    const result = parseScenarioIntent("romantic dinner, not too loud, easy conversation", intent) as DateNightIntent | null;
    expect(result?.wants_quiet_buffer).toBe(true);
  });

  it("propagates RestaurantIntent fields to ScenarioIntent", () => {
    const intent: RestaurantIntent = {
      category: "restaurant",
      cuisine: "Italian",
      purpose: "date",
      party_size: 2,
      budget_per_person: 80,
    };
    const result = parseScenarioIntent("romantic Italian dinner", intent) as DateNightIntent | null;
    expect(result?.cuisine).toBe("Italian");
    expect(result?.party_size).toBe(2);
    expect(result?.budget_per_person).toBe(80);
  });
});

// ─── runWeekendTripPlanner ────────────────────────────────────────────────────

function makeHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: "h1",
    name: "Chicago Grand Hotel",
    star_rating: 4,
    price_per_night: 180,
    total_price: 360,
    rating: 4.3,
    review_count: 1200,
    address: "100 N Michigan Ave, Chicago, IL",
    amenities: ["wifi", "pool", "gym"],
    booking_link: "https://booking.example.com/hotel-1",
    ...overrides,
  };
}

function makeHotelCard(overrides: Partial<HotelRecommendationCard> = {}): HotelRecommendationCard {
  return {
    hotel: makeHotel(),
    rank: 1,
    score: 8.5,
    why_recommended: "Great location",
    best_for: "Business travelers",
    watch_out: "Can be noisy",
    not_great_if: "On a tight budget",
    price_summary: "$180/night",
    location_summary: "Downtown",
    ...overrides,
  };
}

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    airline: "Delta",
    flight_number: "DL123",
    departure_airport: "JFK",
    arrival_airport: "ORD",
    departure_city: "New York",
    arrival_city: "Chicago",
    departure_time: "08:00",
    arrival_time: "10:00",
    duration: "2h",
    stops: 0,
    price: 250,
    booking_link: "https://booking.example.com/flight-1",
    ...overrides,
  };
}

function makeFlightCard(overrides: Partial<FlightRecommendationCard> = {}): FlightRecommendationCard {
  return {
    flight: makeFlight(),
    rank: 1,
    group: "direct",
    why_recommended: "Best nonstop option",
    ...overrides,
  };
}

function makeBaseWeekendTripIntent(): WeekendTripIntent {
  return {
    category: "trip",
    scenario: "weekend_trip",
    scenario_goal: "Weekend trip to Chicago",
    departure_city: "New York",
    destination_city: "Chicago",
    trip_pace: "balanced",
    hotel_style: "comfortable",
    planning_assumptions: [],
    needs_clarification: false,
    missing_fields: [],
  };
}

describe("runWeekendTripPlanner", () => {
  it("returns null when no flights provided", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago",
      outputLanguage: "en",
    });
    expect(result).toBeNull();
  });

  it("returns null when no hotels provided", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago",
      outputLanguage: "en",
    });
    expect(result).toBeNull();
  });

  it("produces a valid DecisionPlan with flight + hotel data", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [
        makeFlightCard({ flight: makeFlight({ id: "f1", price: 200, stops: 0 }), rank: 1, group: "direct" }),
        makeFlightCard({ flight: makeFlight({ id: "f2", price: 150, stops: 1 }), rank: 2, group: "cheapest" }),
        makeFlightCard({ flight: makeFlight({ id: "f3", price: 350, stops: 0 }), rank: 3, group: "direct" }),
      ],
      hotelRecommendations: [
        makeHotelCard({ hotel: makeHotel({ id: "h1", star_rating: 4, price_per_night: 180 }), rank: 1, score: 8.5 }),
        makeHotelCard({ hotel: makeHotel({ id: "h2", star_rating: 3, price_per_night: 110 }), rank: 2, score: 7.0 }),
        makeHotelCard({ hotel: makeHotel({ id: "h3", star_rating: 5, price_per_night: 320 }), rank: 3, score: 9.2 }),
      ],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago next weekend",
      outputLanguage: "en",
    });

    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("weekend_trip");
    expect(result?.primary_plan).toBeDefined();
    expect(result?.backup_plans.length).toBeGreaterThanOrEqual(1);
    expect(result?.evidence_items.length).toBeGreaterThan(0);
  });

  it("plan has required DecisionPlan fields", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "weekend trip",
      outputLanguage: "en",
    });
    expect(result).toMatchObject({
      id: expect.any(String),
      scenario: "weekend_trip",
      output_language: "en",
      title: expect.any(String),
      summary: expect.any(String),
      primary_plan: expect.objectContaining({ id: expect.any(String) }),
      backup_plans: expect.any(Array),
      evidence_items: expect.any(Array),
    });
  });

  it("returns Chinese output when output_language is zh", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "周末去芝加哥旅行",
      outputLanguage: "zh",
    });
    expect(result?.output_language).toBe("zh");
  });
});

// ─── runCityTripPlanner ────────────────────────────────────────────────────────

function makeBaseCityTripIntent(overrides: Partial<CityTripIntent> = {}): CityTripIntent {
  return {
    category: "trip",
    scenario: "city_trip",
    scenario_goal: "Explore Tokyo with great food and nightlife",
    destination_city: "Tokyo",
    nights: 3,
    travelers: 2,
    activities: ["dining", "nightlife"],
    cuisine_preferences: ["Japanese", "Ramen"],
    hotel_star_rating: 4,
    vibe: "mixed",
    planning_assumptions: [],
    needs_clarification: false,
    missing_fields: [],
    ...overrides,
  };
}

describe("runCityTripPlanner", () => {
  it("returns null when no hotels and no restaurants provided", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent(),
      hotelRecommendations: [],
      restaurantRecommendations: [],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result).toBeNull();
  });

  it("produces a valid DecisionPlan with hotel + restaurant data", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent(),
      hotelRecommendations: [
        makeHotelCard({ hotel: makeHotel({ id: "h1", star_rating: 5, rating: 4.8 }), rank: 1, score: 9.2 }),
        makeHotelCard({ hotel: makeHotel({ id: "h2", star_rating: 4, rating: 4.3 }), rank: 2, score: 8.1 }),
        makeHotelCard({ hotel: makeHotel({ id: "h3", star_rating: 3, rating: 4.0 }), rank: 3, score: 7.5 }),
      ],
      restaurantRecommendations: [
        makeCard({ restaurant: makeRestaurant({ id: "r1" }), rank: 1, score: 9.0 }),
        makeCard({ restaurant: makeRestaurant({ id: "r2" }), rank: 2, score: 8.0 }),
        makeCard({ restaurant: makeRestaurant({ id: "r3" }), rank: 3, score: 7.0 }),
      ],
      barRecommendations: [],
      outputLanguage: "en",
    });

    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("city_trip");
    expect(result?.primary_plan).toBeDefined();
    expect(result?.backup_plans.length).toBeGreaterThanOrEqual(1);
  });

  it("plan has required DecisionPlan fields", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent(),
      hotelRecommendations: [makeHotelCard()],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result).toMatchObject({
      id: expect.any(String),
      scenario: "city_trip",
      output_language: "en",
      title: expect.any(String),
      summary: expect.any(String),
      primary_plan: expect.objectContaining({ id: expect.any(String) }),
      backup_plans: expect.any(Array),
      evidence_items: expect.any(Array),
      next_actions: expect.any(Array),
    });
  });

  it("planId includes destination city", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent({ destination_city: "Paris" }),
      hotelRecommendations: [makeHotelCard()],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result?.id).toContain("Paris");
  });

  it("returns Chinese output when outputLanguage is zh", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent({ destination_city: "东京" }),
      hotelRecommendations: [makeHotelCard()],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "zh",
    });
    expect(result?.output_language).toBe("zh");
    expect(result?.title).toContain("东京");
  });

  it("works with only hotels (no restaurants or bars)", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent(),
      hotelRecommendations: [makeHotelCard()],
      restaurantRecommendations: [],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("city_trip");
  });

  it("works with only restaurants (no hotels)", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent(),
      hotelRecommendations: [],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result).not.toBeNull();
    expect(result?.scenario).toBe("city_trip");
  });
});

// ─── detectScenarioFromMessage — big_purchase ────────────────────────────────

describe("detectScenarioFromMessage — big_purchase", () => {
  it("detects laptop with budget signal", () => {
    expect(detectScenarioFromMessage("help me pick a laptop ~$1800")).toBe("big_purchase");
  });

  it("detects headphones with explicit budget", () => {
    expect(detectScenarioFromMessage("best headphones under $300")).toBe("big_purchase");
  });

  it("detects smartphone with buy intent", () => {
    expect(detectScenarioFromMessage("I want to buy a new iPhone")).toBe("big_purchase");
  });

  it("city_trip takes priority when travel+hotel+dining signals present (even with laptop word)", () => {
    // city_trip requires: traveling + hotel + dining. This message triggers city_trip, not big_purchase.
    expect(detectScenarioFromMessage("traveling to Tokyo, need a hotel and restaurants for my trip")).toBe("city_trip");
  });

  it("returns null for bare product name with no budget or intent", () => {
    expect(detectScenarioFromMessage("laptop comparison")).toBeNull();
  });

  it("returns null for generic message with no product category", () => {
    expect(detectScenarioFromMessage("I want to buy something")).toBeNull();
  });
});

// ─── tradeoff_summary ────────────────────────────────────────────────────────

describe("tradeoff_summary", () => {
  it("runScenarioPlanner sets tradeoff_summary with 2 backup cards", () => {
    const primary = makeCard({ score: 9.2, restaurant: makeRestaurant({ name: "Nobu", price: "$$$$" }) });
    const backup1 = makeCard({ score: 8.8, restaurant: makeRestaurant({ id: "r2", name: "Le Bernardin", price: "$$$$" }) });
    const backup2 = makeCard({ score: 8.0, restaurant: makeRestaurant({ id: "r3", name: "Café Boulud", price: "$$" }) });
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [primary, backup1, backup2],
      userMessage: "romantic dinner",
      cityLabel: "NYC",
      outputLanguage: "en",
    });
    expect(result.tradeoff_summary).toBeDefined();
    expect(result.tradeoff_summary).toContain("Nobu");
  });

  it("runScenarioPlanner sets empty tradeoff_summary with no backups", () => {
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "NYC",
      outputLanguage: "en",
    });
    expect(result.tradeoff_summary).toBe("");
  });

  it("runScenarioPlanner tradeoff_summary in zh contains restaurant name", () => {
    const primary = makeCard({ score: 9.0, restaurant: makeRestaurant({ name: "東京餐廳" }) });
    const backup = makeCard({ score: 8.5, restaurant: makeRestaurant({ id: "r2", name: "大阪屋" }) });
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [primary, backup],
      userMessage: "找一个约会餐厅",
      cityLabel: "NYC",
      outputLanguage: "zh",
    });
    expect(result.tradeoff_summary).toContain("東京餐廳");
  });

  it("runWeekendTripPlanner sets tradeoff_summary with price comparison", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [
        makeFlightCard({ flight: makeFlight({ id: "f1", price: 200 }), rank: 1 }),
        makeFlightCard({ flight: makeFlight({ id: "f2", price: 150 }), rank: 2 }),
        makeFlightCard({ flight: makeFlight({ id: "f3", price: 350 }), rank: 3 }),
      ],
      hotelRecommendations: [
        makeHotelCard({ hotel: makeHotel({ id: "h1", price_per_night: 180 }), rank: 1 }),
        makeHotelCard({ hotel: makeHotel({ id: "h2", price_per_night: 120 }), rank: 2 }),
        makeHotelCard({ hotel: makeHotel({ id: "h3", price_per_night: 320 }), rank: 3 }),
      ],
      creditCardRecommendations: [],
      outputLanguage: "en",
    });
    expect(result?.tradeoff_summary).toBeDefined();
    expect(typeof result?.tradeoff_summary).toBe("string");
    expect(result?.tradeoff_summary!.length).toBeGreaterThan(0);
  });
});

// ─── 3a-3: Check-in gap feasibility ──────────────────────────────────────────

describe("weekend trip check-in gap (3a-3)", () => {
  function planWithArrival(arrivalTime: string) {
    return runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [
        makeFlightCard({ flight: makeFlight({ arrival_time: arrivalTime }) }),
      ],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      outputLanguage: "en",
    });
  }

  it("timing_note mentions early arrival when flight lands 5h before check-in", () => {
    // 10:00 arrival → 5h before standard 15:00 check-in
    const plan = planWithArrival("10:00");
    const note = plan?.primary_plan.timing_note ?? "";
    expect(note).toContain("10:00");
    expect(note).toContain("before check-in");
  });

  it("timing_note mentions late-night when flight arrives after 22:00", () => {
    const plan = planWithArrival("23:30");
    const note = plan?.primary_plan.timing_note ?? "";
    expect(note).toContain("23:30");
    expect(note.toLowerCase()).toMatch(/late.?night/);
  });

  it("timing_note mentions room ready when flight arrives after check-in time", () => {
    // 17:00 arrival → after 15:00 check-in, room should be ready
    const plan = planWithArrival("17:00");
    const note = plan?.primary_plan.timing_note ?? "";
    expect(note).toContain("17:00");
    expect(note).toContain("room should be ready");
  });

  it("risks includes early arrival warning when landing 5h before check-in", () => {
    const plan = planWithArrival("10:00");
    const risks = plan?.primary_plan.risks ?? [];
    expect(risks.some((r) => r.toLowerCase().includes("early arrival"))).toBe(true);
  });

  it("risks includes late-night warning when landing after 22:00", () => {
    const plan = planWithArrival("23:00");
    const risks = plan?.primary_plan.risks ?? [];
    expect(risks.some((r) => r.toLowerCase().includes("late"))).toBe(true);
  });

  it("risks does NOT include timing warning for clean 15:30 arrival", () => {
    // Arriving 30min after check-in → no timing risk
    const plan = planWithArrival("15:30");
    const risks = plan?.primary_plan.risks ?? [];
    const hasTimingRisk = risks.some(
      (r) =>
        r.toLowerCase().includes("early arrival") ||
        r.toLowerCase().includes("tight check-in") ||
        r.toLowerCase().includes("late-night")
    );
    expect(hasTimingRisk).toBe(false);
  });
});

// ─── 3b-1: Pre-filled booking deep links ─────────────────────────────────────

describe("weekend trip pre-filled booking URLs (3b-1)", () => {
  it("primary_action.url uses Booking.com with dates when intent has start_date", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: {
        ...makeBaseWeekendTripIntent(),
        destination_city: "Chicago",
        start_date: "2026-04-11",
        end_date: "2026-04-13",
      },
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      outputLanguage: "en",
    });
    const url = result?.primary_plan.primary_action?.url ?? "";
    expect(url).toContain("booking.com");
    expect(url).toContain("Chicago");
    expect(url).toContain("2026");
  });

  it("primary_action.url falls back to hotel booking_link when no intent dates", () => {
    const intent = makeBaseWeekendTripIntent();
    // No start_date / destination_city in base intent... override to ensure no dates
    const result = runWeekendTripPlanner({
      scenarioIntent: { ...intent, destination_city: undefined, start_date: undefined },
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      outputLanguage: "en",
    });
    const url = result?.primary_plan.primary_action?.url ?? "";
    expect(url).toContain("booking.example.com");
  });

  it("open-flight secondary action uses Kayak deep link when intent has route+date", () => {
    // Source switched from Google Flights (#flt= fragment is partial fill —
    // origin only) to Kayak's path-style URL which lands fully pre-filtered.
    // See lib/agent/planners/booking-links.ts buildKayakFlightsUrl.
    const result = runWeekendTripPlanner({
      scenarioIntent: {
        ...makeBaseWeekendTripIntent(),
        departure_city: "New York",
        destination_city: "Chicago",
        start_date: "2026-04-11",
        end_date: "2026-04-13",
      },
      flightRecommendations: [
        makeFlightCard({
          flight: makeFlight({ departure_airport: "JFK", arrival_airport: "ORD" }),
        }),
      ],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      outputLanguage: "en",
    });
    const flightAction = result?.primary_plan.secondary_actions?.find(
      (a) => a.id === "open-flight"
    );
    expect(flightAction?.url).toContain("kayak.com/flights");
    expect(flightAction?.url).toContain("2026-04-11");
  });
});

// ─── 3b-2: Add to Calendar action ─────────────────────────────────────────────

describe("event_datetime / event_location on DecisionPlan (3b-2)", () => {
  it("date_night plan has event_datetime when detected_date_text is set", () => {
    const intent: DateNightIntent = {
      category: "restaurant",
      stage: "first_date",
      cuisine: "Italian",
      party_size: 2,
      detected_date_text: "2026-04-12",
      time_hint: "7:30 pm",
      scenario_goal: "romantic dinner",
      scenario: "date_night",
    };
    const result = runScenarioPlanner({
      scenarioIntent: intent,
      recommendations: [makeCard()],
      userMessage: "romantic dinner april 12",
      cityLabel: "New York",
      outputLanguage: "en",
    });
    expect(result?.event_datetime).toBeDefined();
    expect(result?.event_datetime).toContain("2026-04-12");
  });

  it("date_night plan has event_location matching restaurant address", () => {
    const intent: DateNightIntent = {
      category: "restaurant",
      stage: "first_date",
      cuisine: "Italian",
      party_size: 2,
      detected_date_text: "2026-04-12",
      scenario_goal: "romantic dinner",
      scenario: "date_night",
    };
    const card = makeCard({ restaurant: makeRestaurant({ address: "456 Lovers Lane" }) });
    const result = runScenarioPlanner({
      scenarioIntent: intent,
      recommendations: [card],
      userMessage: "romantic dinner april 12",
      cityLabel: "New York",
      outputLanguage: "en",
    });
    expect(result?.event_location).toBe("456 Lovers Lane");
  });

  it("date_night plan has NO event_datetime when no date in intent", () => {
    const intent: DateNightIntent = {
      category: "restaurant",
      stage: "first_date",
      cuisine: "Italian",
      party_size: 2,
      scenario_goal: "romantic dinner",
      scenario: "date_night",
    };
    const result = runScenarioPlanner({
      scenarioIntent: intent,
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "New York",
      outputLanguage: "en",
    });
    expect(result?.event_datetime).toBeUndefined();
  });

  it("weekend_trip plan has event_datetime matching start_date when start_date is set", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: {
        ...makeBaseWeekendTripIntent(),
        start_date: "2026-04-11",
        end_date: "2026-04-13",
      },
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago",
      outputLanguage: "en",
    });
    expect(result?.event_datetime).toBeDefined();
    expect(result?.event_datetime).toContain("2026-04-11");
  });

  it("weekend_trip plan has event_location set to hotel address", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: {
        ...makeBaseWeekendTripIntent(),
        start_date: "2026-04-11",
        end_date: "2026-04-13",
      },
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard({ hotel: makeHotel({ address: "789 Hotel Ave" }) })],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago",
      outputLanguage: "en",
    });
    expect(result?.event_location).toBe("789 Hotel Ave");
  });

  it("weekend_trip plan has NO event_datetime when start_date is absent", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: { ...makeBaseWeekendTripIntent(), start_date: undefined, end_date: undefined },
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "weekend trip",
      outputLanguage: "en",
    });
    expect(result?.event_datetime).toBeUndefined();
  });

  it("city_trip plan has event_datetime matching start_date via modular engine", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent({ start_date: "2026-05-01" }),
      hotelRecommendations: [makeHotelCard()],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result?.event_datetime).toBeDefined();
    expect(result?.event_datetime).toContain("2026-05-01");
  });

  it("city_trip plan has Google Calendar link in secondary_actions when startDate is set", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent({ start_date: "2026-05-01" }),
      hotelRecommendations: [makeHotelCard({ hotel: makeHotel({ id: "h1" }) })],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    const calAction = result?.primary_plan.secondary_actions?.find((a) =>
      a.url?.includes("calendar.google.com")
    );
    expect(calAction).toBeDefined();
    // Google Calendar URL encodes dates as "20260501T..." (no dashes)
    expect(calAction?.url).toContain("20260501T");
  });
});

// ─── 3b-5: Credit card cross-reference in trip planning ───────────────────────

describe("trip_card_callout on DecisionPlan (3b-5)", () => {
  it("weekend_trip plan has trip_card_callout when flight + hotel costs are sufficient", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard({ flight: makeFlight({ price: 350 }) })],
      hotelRecommendations: [makeHotelCard({ hotel: makeHotel({ total_price: 500 }) })],
      creditCardRecommendations: [],
      userMessage: "weekend trip to Chicago",
      outputLanguage: "en",
    });
    expect(result?.trip_card_callout).toBeDefined();
    expect(typeof result?.trip_card_callout).toBe("string");
    expect(result?.trip_card_callout?.length).toBeGreaterThan(10);
  });

  it("weekend_trip callout starts with 'Pay with' for English output", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "weekend trip",
      outputLanguage: "en",
    });
    expect(result?.trip_card_callout).toMatch(/^Pay with /);
  });

  it("weekend_trip callout uses Chinese prefix for zh output", () => {
    const result = runWeekendTripPlanner({
      scenarioIntent: makeBaseWeekendTripIntent(),
      flightRecommendations: [makeFlightCard()],
      hotelRecommendations: [makeHotelCard()],
      creditCardRecommendations: [],
      userMessage: "周末去芝加哥",
      outputLanguage: "zh",
    });
    expect(result?.trip_card_callout).toMatch(/^用 /);
  });

  it("city_trip plan has trip_card_callout from modular engine", () => {
    const result = runCityTripPlanner({
      scenarioIntent: makeBaseCityTripIntent({ start_date: "2026-05-01" }),
      hotelRecommendations: [makeHotelCard({ hotel: makeHotel({ id: "h1", total_price: 900 }) })],
      restaurantRecommendations: [makeCard()],
      barRecommendations: [],
      outputLanguage: "en",
    });
    expect(result?.trip_card_callout).toBeDefined();
    expect(typeof result?.trip_card_callout).toBe("string");
  });
});

// ─── 3c-2: Restaurant availability deep links ─────────────────────────────────

describe("restaurant availability deep links (3c-2)", () => {
  const baseIntent = (): DateNightIntent => ({
    category: "restaurant",
    scenario: "date_night",
    scenario_goal: "romantic dinner for two",
    stage: "steady_relationship",
    follow_up_preference: "none",
    decision_style: "romantic",
    wants_quiet_buffer: false,
    party_size: 2,
  });

  it("adds check-availability secondary action when opentable_url is absent", () => {
    const card = makeCard({ restaurant: makeRestaurant({ name: "La Maison" }) });
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [card],
      userMessage: "romantic dinner",
      cityLabel: "San Francisco",
      outputLanguage: "en",
    });
    const availAction = result?.primary_plan.secondary_actions?.find(
      (a) => a.id === "check-availability"
    );
    expect(availAction).toBeDefined();
    expect(availAction?.url).toContain("opentable.com");
    expect(availAction?.url).toContain("La+Maison");
  });

  it("pre-fills covers from intent.party_size in the OpenTable URL", () => {
    const intent: DateNightIntent = { ...baseIntent(), party_size: 4 };
    const result = runScenarioPlanner({
      scenarioIntent: intent,
      recommendations: [makeCard({ restaurant: makeRestaurant({ name: "Chez Paul" }) })],
      userMessage: "dinner for 4",
      cityLabel: "Chicago",
      outputLanguage: "en",
    });
    const availAction = result?.primary_plan.secondary_actions?.find(
      (a) => a.id === "check-availability"
    );
    expect(availAction?.url).toContain("covers=4");
  });

  it("does NOT add check-availability when opentable_url is already present (avoid duplication)", () => {
    const card = makeCard({
      restaurant: makeRestaurant({ name: "Grand Bistro" }),
      opentable_url: "https://www.opentable.com/r/grand-bistro",
    });
    const result = runScenarioPlanner({
      scenarioIntent: baseIntent(),
      recommendations: [card],
      userMessage: "romantic dinner",
      cityLabel: "NYC",
      outputLanguage: "en",
    });
    const availAction = result?.primary_plan.secondary_actions?.find(
      (a) => a.id === "check-availability"
    );
    expect(availAction).toBeUndefined();
  });
});

// ─── after_dinner_option (3b-3b) ─────────────────────────────────────────────

describe("after_dinner_option", () => {
  const mockVenue = {
    name: "Bar Califa",
    address: "123 Mission St, San Francisco, CA",
    walk_minutes: 8,
    vibe: "Cozy cocktail bar with great natural wines",
    google_maps_url: "https://maps.google.com/?cid=123",
  };

  it("attaches after_dinner_option to primary_plan when provided", () => {
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
      afterDinnerOption: mockVenue,
    });
    expect(result?.primary_plan.after_dinner_option).toBeDefined();
    expect(result?.primary_plan.after_dinner_option?.name).toBe("Bar Califa");
    expect(result?.primary_plan.after_dinner_option?.walk_minutes).toBe(8);
  });

  it("backup plans do not get after_dinner_option", () => {
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [makeCard(), makeCard({ restaurant: makeRestaurant({ id: "r2", name: "B" }) })],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
      afterDinnerOption: mockVenue,
    });
    expect(result?.backup_plans[0].after_dinner_option).toBeUndefined();
  });

  it("omits after_dinner_option when not provided", () => {
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
    });
    expect(result?.primary_plan.after_dinner_option).toBeUndefined();
  });

  it("omits after_dinner_option when null", () => {
    const result = runScenarioPlanner({
      scenarioIntent: { scenario: "date_night", category: "restaurant" },
      recommendations: [makeCard()],
      userMessage: "romantic dinner",
      cityLabel: "SF",
      outputLanguage: "en",
      afterDinnerOption: null,
    });
    expect(result?.primary_plan.after_dinner_option).toBeUndefined();
  });
});
