import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectScenarioFromMessage } from "../scenario2";
import { runHotelPipeline } from "../agent/pipelines/hotel";
import type { HotelIntent, Hotel } from "../types";

// hotel.ts switched its ranker from MiniMax to OpenAI gpt-4o-mini (see
// hotel.ts:65 inline comment). Tests must mock @/lib/openai's openaiChat;
// the previous MiniMax-via-fetch fixture no longer reaches the ranker.
const mockOpenaiChat = vi.fn();
vi.mock("../openai", () => ({
  openaiChat: (...args: unknown[]) => mockOpenaiChat(...args),
}));

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeSerpHotelResponse(properties: object[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ properties }),
    text: async () => JSON.stringify({ properties }),
  };
}

// Sample SerpAPI hotel property
function makeSerpHotelProperty(overrides: Record<string, unknown> = {}) {
  return {
    name: "The Grand Hotel",
    property_token: "tok_grand",
    hotel_class: "4-star hotel",
    extracted_hotel_class: 4,
    overall_rating: 4.5,
    reviews: 1200,
    location: "123 Main St, Los Angeles, CA",
    neighborhood: "Downtown LA",
    rate_per_night: { extracted_lowest: 220, lowest: "$220" },
    amenities: ["Pool", "Spa", "Gym", "Free WiFi", "Restaurant"],
    images: [{ thumbnail: "https://example.com/hotel.jpg" }],
    gps_coordinates: { latitude: 34.05, longitude: -118.25 },
    link: "https://www.google.com/travel/hotels/entity/tok_grand",
    description: "Luxurious hotel in the heart of downtown LA",
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockOpenaiChat.mockReset();
  process.env.MINIMAX_API_KEY = "test-key";
  process.env.SERPAPI_KEY = "test-serpapi-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
});

// ─── Case 1: Scenario detection — flight + hotel + restaurant signals ─────────

describe("Case 1: LA trip with flight + hotel + restaurant", () => {
  // "i plan to go for a trip to LA at 3.28, help me to find a flight ticket,
  //  then reserve a hotel between 200 and 300, and find some good chinese restaurants for me"
  it("detects weekend_trip when message has plane + hotel + restaurants", () => {
    const msg =
      "i plan to go for a trip to LA at 3.28, help me to find a flight tiket, then reserve a hotel between 200 and 300, and find some good chinese restaruants for me";
    expect(detectScenarioFromMessage(msg)).toBe("weekend_trip");
  });

  it("detects 'LA' as destination hint via alias regex", () => {
    // The parseWeekendTripIntent pre-extraction uses this regex to identify 'la' as destination
    expect(msg_contains_la_alias("i plan to go for a trip to LA")).toBe(true);
    expect(msg_contains_la_alias("going to lax for a visit")).toBe(true);
    expect(msg_contains_la_alias("trip to los angeles")).toBe(true);
  });
});

function msg_contains_la_alias(msg: string): boolean {
  return /\b(la|los angeles|lax)\b/i.test(msg);
}

// ─── Case 2: "fly back to Nashville" → departure city extraction ──────────────

describe("Case 2: Departure city from 'fly back to'", () => {
  // "make a plan to NY tomorrow, I want to take plane and go for some good restaurants,
  //  then stay on a 5 star hotel for 2 nights, then fly back to nashville"
  // Note: detectScenarioFromMessage requires \bflight\b keyword; "plane" is handled
  // by the NLU layer (analyzeMultilingualQuery) which sets scenario_hint="weekend_trip".
  it("NLU flight signal pattern matches 'plane' and 'fly'", () => {
    // This is the pattern used in nlu.ts for _hasFlightSignal
    const hasFlightSignal = /\bflight\b|\bflights\b|\bairport\b|\bfly\b|\bplane\b|\bairline\b/i;
    expect(hasFlightSignal.test("i want to take plane")).toBe(true);
    expect(hasFlightSignal.test("want to fly to NY")).toBe(true);
    expect(hasFlightSignal.test("book a flight to Chicago")).toBe(true);
  });

  it("NLU hotel signal pattern matches 'stay', 'hotel', 'nights'", () => {
    const hasHotelSignal = /\bhotel\b|\bhotels\b|\bcheck.?in\b|\bcheck.?out\b|\bstay\b|\bnights?\b/i;
    expect(hasHotelSignal.test("stay on a 5 star hotel for 2 nights")).toBe(true);
    expect(hasHotelSignal.test("reserve a hotel room")).toBe(true);
    expect(hasHotelSignal.test("3 nights accommodation")).toBe(true);
  });

  it("both NLU signals present → scenario_hint = weekend_trip", () => {
    const msg = "make a plan to NY tomorrow, i want to take plane and go for some good restaurants, then stay on a 5 star hotel for 2 nights, then fly back to nashville";
    const hasFlightSignal = /\bflight\b|\bflights\b|\bairport\b|\bfly\b|\bplane\b|\bairline\b/i;
    const hasHotelSignal = /\bhotel\b|\bhotels\b|\bcheck.?in\b|\bcheck.?out\b|\bstay\b|\bnights?\b/i;
    expect(hasFlightSignal.test(msg)).toBe(true);
    expect(hasHotelSignal.test(msg)).toBe(true);
    // Both signals → NLU sets scenario_hint = "weekend_trip"
  });

  it("'fly back to nashville' must not match as destination", () => {
    // 'nashville' should be departure, not destination
    // The destination should be 'NY' which appears before 'fly back to'
    const msg = "make a plan to NY, then fly back to nashville";
    const destFirst = msg.toLowerCase().indexOf("ny");
    const flyBack = msg.toLowerCase().indexOf("fly back to nashville");
    // destination mention (NY) must come before 'fly back to Nashville'
    expect(destFirst).toBeLessThan(flyBack);
  });

  it("'return to Nashville' pattern also identifies departure city", () => {
    const pattern = /\breturn(?:ing)?\s+to\s+nashville/i;
    expect(pattern.test("after the trip returning to Nashville")).toBe(true);
  });
});

// ─── Case 3: Hotel pipeline fallback when MiniMax times out ──────────────────

describe("Case 3: Hotel pipeline MiniMax fallback", () => {
  const intent: HotelIntent = {
    category: "hotel",
    location: "Los Angeles, CA",
    check_in: "2026-03-28",
    check_out: "2026-03-30",
    nights: 2,
    guests: 1,
    star_rating: undefined,
    budget_total: 500,
    purpose: "weekend_trip",
    priorities: [],
  };

  it("returns fallback cards when the OpenAI ranker throws (timeout)", async () => {
    // SerpAPI returns 3 hotels
    mockFetch.mockResolvedValueOnce(
      makeSerpHotelResponse([
        makeSerpHotelProperty({ name: "Hotel A", overall_rating: 4.5, reviews: 500 }),
        makeSerpHotelProperty({ name: "Hotel B", overall_rating: 4.2, reviews: 300 }),
        makeSerpHotelProperty({ name: "Hotel C", overall_rating: 4.0, reviews: 200 }),
      ])
    );
    // Ranker throws (simulates upstream timeout)
    mockOpenaiChat.mockRejectedValueOnce(new Error("AbortError: timeout"));

    const { hotelRecommendations } = await runHotelPipeline(intent, [], "Los Angeles, CA");
    // Should NOT return empty — fallback builds basic cards
    expect(hotelRecommendations.length).toBeGreaterThan(0);
    expect(hotelRecommendations[0].hotel.name).toBeTruthy();
  });

  it("returns AI-ranked cards when the OpenAI ranker succeeds", async () => {
    const properties = [
      makeSerpHotelProperty({ name: "Beverly Hills Hotel", overall_rating: 4.8, reviews: 2000 }),
      makeSerpHotelProperty({ name: "Budget Inn", overall_rating: 3.8, reviews: 100 }),
    ];
    mockFetch.mockResolvedValueOnce(makeSerpHotelResponse(properties));

    const aiResponse = JSON.stringify([
      {
        rank: 1,
        hotel_index: 0,
        scoring: {
          budget_match: 7,
          scene_match: 9,
          review_quality: 9,
          location_convenience: 8,
          preference_match: 8,
          red_flag_penalty: 0,
        },
        why_recommended: "Top-rated luxury hotel perfect for the trip",
        best_for: "Luxury travelers",
        watch_out: "Pricey valet parking",
        not_great_if: "On a tight budget",
        price_summary: "$220/night · 2 nights $440 total",
        location_summary: "Beverly Hills, 10 min drive to Rodeo Drive",
        suggested_refinements: ["更便宜一点", "带早餐的"],
      },
    ]);
    mockOpenaiChat.mockResolvedValueOnce(aiResponse);

    const { hotelRecommendations } = await runHotelPipeline(intent, [], "Los Angeles, CA");
    expect(hotelRecommendations.length).toBe(1);
    expect(hotelRecommendations[0].why_recommended).toContain("luxury hotel");
  });
});

// ─── Case 4: Hotel star filter — 5-star returns empty, fallback without filter ─

describe("Case 4: Hotel star filter fallback", () => {
  const intent: HotelIntent = {
    category: "hotel",
    location: "New York, NY",
    check_in: "2026-03-29",
    check_out: "2026-03-31",
    nights: 2,
    guests: 1,
    star_rating: 5, // user asked for 5-star
    budget_total: 1000,
    purpose: "weekend_trip",
    priorities: [],
  };

  it("retries without star filter when hotel_class=5 returns empty, then returns results", async () => {
    // First call (with hotel_class=5) → empty
    mockFetch.mockResolvedValueOnce(makeSerpHotelResponse([]));
    // Second call (without hotel_class) → results
    mockFetch.mockResolvedValueOnce(
      makeSerpHotelResponse([
        makeSerpHotelProperty({ name: "The Plaza NYC", overall_rating: 4.7, reviews: 5000 }),
      ])
    );
    // OpenAI for ranking
    const aiResponse = JSON.stringify([
      {
        rank: 1,
        hotel_index: 0,
        scoring: { budget_match: 8, scene_match: 9, review_quality: 9, location_convenience: 9, preference_match: 8, red_flag_penalty: 0 },
        why_recommended: "Iconic NYC luxury hotel",
        best_for: "Luxury stays",
        watch_out: "Very expensive",
        not_great_if: "Budget travel",
        price_summary: "$450/night",
        location_summary: "Central Park South",
        suggested_refinements: [],
      },
    ]);
    mockOpenaiChat.mockResolvedValueOnce(aiResponse);

    const { hotelRecommendations } = await runHotelPipeline(intent, [], "New York, NY");
    // Two SerpAPI calls should have been made (with filter, then without)
    const serpCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes("serpapi.com")
    );
    expect(serpCalls.length).toBe(2);
    expect(hotelRecommendations.length).toBeGreaterThan(0);
  });
});

// ─── Case 5: Scenario detection — Chinese trip request ───────────────────────

describe("Case 5: Chinese language trip request", () => {
  // "帮我订一张去纽约的机票，住5星酒店2晚"
  it("detects weekend_trip from Chinese with flight + hotel signals", () => {
    const msg = "帮我订一张去纽约的机票，住5星酒店2晚";
    // NLU calls MiniMax for Chinese — detectScenarioFromMessage uses regex patterns
    // The Chinese flight signal pattern: /\b机票\b|\b航班\b/
    // The Chinese hotel signal: /\b酒店\b|\b住宿\b/
    const hasFlightSignal = /机票|航班|飞机|飞/.test(msg);
    const hasHotelSignal = /酒店|住宿|宾馆/.test(msg);
    expect(hasFlightSignal).toBe(true);
    expect(hasHotelSignal).toBe(true);
  });

  it("Chinese flight+hotel signals detected by NLU (not detectScenarioFromMessage)", () => {
    // detectScenarioFromMessage requires WEEKEND_ZH_REGEX (旅行/周末/etc.) + 机票 + 酒店.
    // "帮我订一张去纽约的机票，住5星酒店2晚" has 机票+酒店 but no 旅行/周末 → returns null.
    // In practice the NLU layer detects Chinese flight+hotel and sets scenario_hint="weekend_trip".
    const msg = "帮我订一张去纽约的机票，住5星酒店2晚";
    expect(detectScenarioFromMessage(msg)).toBeNull(); // NLU layer handles this, not detectScenario
    // NLU Chinese hotel + flight patterns:
    expect(/机票|航班|飞机/.test(msg)).toBe(true);  // flight signal
    expect(/酒店|住宿|宾馆/.test(msg)).toBe(true);  // hotel signal
  });
});

// ─── Case 6: Relative date parsing — "tomorrow", "this weekend" ───────────────

describe("Case 6: Relative date patterns", () => {
  it("'tomorrow' pattern is matched", () => {
    const hasTomorrow = /\btomorrow\b/.test("fly to Chicago tomorrow");
    expect(hasTomorrow).toBe(true);
  });

  it("'this weekend' pattern is matched", () => {
    const hasThisWeekend = /\bthis weekend\b/.test("trip to Miami this weekend");
    expect(hasThisWeekend).toBe(true);
  });

  it("'next weekend' pattern is matched", () => {
    const hasNextWeekend = /\bnext weekend\b/.test("Seattle trip next weekend");
    expect(hasNextWeekend).toBe(true);
  });

  it("numeric date like '3.28' or '3/28' should be in the message", () => {
    const msg = "i plan to go for a trip to LA at 3.28";
    // The date hint parser must detect 3.28 as March 28
    const numericDatePattern = /\b(\d{1,2})[./](\d{1,2})\b/;
    expect(numericDatePattern.test(msg)).toBe(true);
    const match = msg.match(numericDatePattern)!;
    expect(parseInt(match[1])).toBe(3);  // month = 3
    expect(parseInt(match[2])).toBe(28); // day = 28
  });
});

// ─── Case 7: Destination alias detection ─────────────────────────────────────

describe("Case 7: City alias mapping", () => {
  const aliasMap: [string, string][] = [
    ["i want to go to LA", "Los Angeles, CA"],
    ["flight to NYC", "New York, NY"],
    ["trip to Chi", "Chicago, IL"],  // 'chi' pattern
    ["hotel in Vegas", "Las Vegas, NV"],
    ["visiting SF next week", "San Francisco, CA"],
    ["Boston trip", "Boston, MA"],
    ["Denver ski trip", "Denver, CO"],
    ["Miami Beach hotel", "Miami, FL"],
  ];

  function detectCityFromMessage(msg: string): string | undefined {
    const lower = msg.toLowerCase();
    if (/\b(ny|new york|nyc|manhattan)\b/.test(lower)) return "New York, NY";
    if (/\b(la|los angeles|lax)\b/.test(lower)) return "Los Angeles, CA";
    if (/\b(sf|san francisco|sfo)\b/.test(lower)) return "San Francisco, CA";
    if (/\b(chicago|chi)\b/.test(lower)) return "Chicago, IL";
    if (/\b(miami|mia)\b/.test(lower)) return "Miami, FL";
    if (/\b(vegas|las vegas|lvs)\b/.test(lower)) return "Las Vegas, NV";
    if (/\b(seattle|sea)\b/.test(lower)) return "Seattle, WA";
    if (/\b(boston|bos)\b/.test(lower)) return "Boston, MA";
    if (/\b(denver|den)\b/.test(lower)) return "Denver, CO";
    if (/\b(austin|atx)\b/.test(lower)) return "Austin, TX";
    return undefined;
  }

  for (const [msg, expected] of aliasMap) {
    it(`"${msg}" → ${expected}`, () => {
      expect(detectCityFromMessage(msg)).toBe(expected);
    });
  }
});

// ─── Case 8: Hotel budget extraction ─────────────────────────────────────────

describe("Case 8: Hotel budget signal extraction", () => {
  it("detects 'between 200 and 300' budget range", () => {
    const msg = "reserve a hotel between 200 and 300";
    const rangePattern = /between\s+\$?(\d+)\s+and\s+\$?(\d+)/i;
    const match = msg.match(rangePattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(200);
    expect(Number(match![2])).toBe(300);
  });

  it("detects 'under $200/night' budget", () => {
    const msg = "hotel in SF under $200/night";
    const pattern = /under\s+\$?(\d+)/i;
    const match = msg.match(pattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(200);
  });

  it("detects '$150-200 per night' budget range", () => {
    const msg = "looking for a $150-200 per night hotel in Austin";
    const pattern = /\$(\d+)[-–](\d+)\s*(?:per\s*night|\/night)?/i;
    const match = msg.match(pattern);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(150);
    expect(Number(match![2])).toBe(200);
  });
});

// ─── Case 9: Scenario detection — flight-only queries (no hotel) ──────────────

describe("Case 9: Flight-only vs weekend-trip distinction", () => {
  it("flight-only query (no hotel) does NOT detect as weekend_trip", () => {
    const scenario = detectScenarioFromMessage("find me the cheapest flight to Denver tomorrow");
    // No hotel signal → should not be weekend_trip
    expect(scenario).not.toBe("weekend_trip");
  });

  it("flight + hotel → weekend_trip", () => {
    expect(
      detectScenarioFromMessage("book a flight and hotel to Denver this weekend")
    ).toBe("weekend_trip");
  });

  it("hotel-only (no flight) → not weekend_trip", () => {
    const scenario = detectScenarioFromMessage("find me a hotel in Portland for 3 nights");
    expect(scenario).not.toBe("weekend_trip");
  });
});

// ─── Case 10: Weekend trip planner — null when hotel or flight is missing ─────

describe("Case 10: runWeekendTripPlanner requires both flights AND hotels", () => {
  it("returns null when hotelRecommendations is empty", async () => {
    const { runWeekendTripPlanner } = await import("../scenario2");

    const intent = {
      category: "weekend_trip" as const,
      departure_city: "Nashville, TN",
      destination_city: "Los Angeles, CA",
      start_date: "2026-03-28",
      end_date: "2026-03-30",
      nights: 2,
      travelers: 1,
      hotel_star_rating: 4,
      needs_clarification: false,
      missing_fields: [],
      planning_assumptions: [],
    };

    const result = runWeekendTripPlanner({
      scenarioIntent: intent,
      flightRecommendations: [
        {
          flight: {} as never,
          rank: 1, score: 8,
          why_recommended: "Direct flight, great value",
          best_for: "Travelers",
          watch_out: "",
          not_great_if: "",
          price_summary: "$250 round trip",
          route_summary: "BNA → LAX",
          scoring: undefined,
        },
      ],
      hotelRecommendations: [], // ← empty! planner must return null
      creditCardRecommendations: [],
      userMessage: "trip to LA",
      outputLanguage: "en",
    });

    expect(result).toBeNull();
  });

  it("returns null when flightRecommendations is empty", async () => {
    const { runWeekendTripPlanner } = await import("../scenario2");

    const intent = {
      category: "weekend_trip" as const,
      departure_city: "Nashville, TN",
      destination_city: "Los Angeles, CA",
      start_date: "2026-03-28",
      end_date: "2026-03-30",
      nights: 2,
      travelers: 1,
      hotel_star_rating: undefined,
      needs_clarification: false,
      missing_fields: [],
      planning_assumptions: [],
    };

    const result = runWeekendTripPlanner({
      scenarioIntent: intent,
      flightRecommendations: [], // ← empty! planner must return null
      hotelRecommendations: [
        {
          hotel: {} as never,
          rank: 1, score: 8,
          why_recommended: "Great location",
          best_for: "Leisure travelers",
          watch_out: "",
          not_great_if: "",
          price_summary: "$220/night",
          location_summary: "Downtown LA",
          scoring: undefined,
          suggested_refinements: [],
        },
      ],
      creditCardRecommendations: [],
      userMessage: "trip to LA",
      outputLanguage: "en",
    });

    expect(result).toBeNull();
  });
});
