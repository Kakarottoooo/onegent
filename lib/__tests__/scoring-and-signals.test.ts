import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeWeightedScore,
  DEFAULT_WEIGHTS,
} from "../agent/composer/scoring";
import { ReviewSignalsSchema, ScoringDimensionsSchema, RankedItemArraySchema } from "../schemas";

// ─── Phase 3.2: computeWeightedScore ─────────────────────────────────────────

describe("computeWeightedScore", () => {
  const perfectDims = {
    budget_match: 10,
    scene_match: 10,
    review_quality: 10,
    location_convenience: 10,
    preference_match: 10,
    red_flag_penalty: 0,
  };

  it("returns 10 when all dimensions are 10 and no penalty", () => {
    const score = computeWeightedScore(perfectDims);
    expect(score).toBe(10);
  });

  it("returns 0 when all dimensions are 0", () => {
    const score = computeWeightedScore({
      budget_match: 0,
      scene_match: 0,
      review_quality: 0,
      location_convenience: 0,
      preference_match: 0,
      red_flag_penalty: 0,
    });
    expect(score).toBe(0);
  });

  it("default weights sum to 1.0", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it("applies red_flag_penalty as a deduction", () => {
    const withoutPenalty = computeWeightedScore({ ...perfectDims, red_flag_penalty: 0 });
    const withPenalty = computeWeightedScore({ ...perfectDims, red_flag_penalty: 2 });
    expect(withPenalty).toBe(withoutPenalty - 2);
  });

  it("clamps result to 0 even with heavy penalty", () => {
    const score = computeWeightedScore({
      budget_match: 1,
      scene_match: 1,
      review_quality: 1,
      location_convenience: 1,
      preference_match: 1,
      red_flag_penalty: 5,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("clamps result to max 10", () => {
    const score = computeWeightedScore({ ...perfectDims, red_flag_penalty: -5 });
    expect(score).toBe(10);
  });

  it("accepts custom weights and uses them", () => {
    const allTens = {
      budget_match: 10,
      scene_match: 0,
      review_quality: 0,
      location_convenience: 0,
      preference_match: 0,
      red_flag_penalty: 0,
    };
    // With default weights, budget_match=10 contributes 10*0.25 = 2.5
    expect(computeWeightedScore(allTens)).toBeCloseTo(2.5);
    // With custom weight of 1.0 on budget_match, score = 10
    expect(
      computeWeightedScore(allTens, {
        budget_match: 1.0,
        scene_match: 0,
        review_quality: 0,
        location_convenience: 0,
        preference_match: 0,
      })
    ).toBe(10);
  });

  it("rounds result to 1 decimal place", () => {
    const score = computeWeightedScore({
      budget_match: 7,
      scene_match: 8,
      review_quality: 6,
      location_convenience: 5,
      preference_match: 9,
      red_flag_penalty: 0,
    });
    expect(score).toBe(Math.round(score * 10) / 10);
    expect(score.toString()).not.toMatch(/\.\d{2,}/);
  });

  it("scene_match has highest weight (0.30) — increasing it by 1 changes score by 0.30", () => {
    const base = { budget_match: 5, scene_match: 5, review_quality: 5, location_convenience: 5, preference_match: 5, red_flag_penalty: 0 };
    const higher = { ...base, scene_match: 6 };
    const delta = computeWeightedScore(higher) - computeWeightedScore(base);
    expect(delta).toBeCloseTo(DEFAULT_WEIGHTS.scene_match, 5);
  });
});

// ─── Phase 3.1: ReviewSignalsSchema ──────────────────────────────────────────

describe("ReviewSignalsSchema", () => {
  const validSignals = {
    noise_level: "quiet" as const,
    wait_time: "no wait weekdays, 30 min weekends",
    date_suitability: 9,
    service_pace: "attentive but not rushed",
    notable_dishes: ["duck confit", "truffle pasta"],
    red_flags: ["cash only parking"],
    best_for: ["date night", "business lunch"],
    review_confidence: "high" as const,
  };

  it("accepts valid signals", () => {
    expect(ReviewSignalsSchema.safeParse(validSignals).success).toBe(true);
  });

  it("rejects invalid noise_level", () => {
    expect(ReviewSignalsSchema.safeParse({ ...validSignals, noise_level: "deafening" }).success).toBe(false);
  });

  it("rejects date_suitability < 1", () => {
    expect(ReviewSignalsSchema.safeParse({ ...validSignals, date_suitability: 0 }).success).toBe(false);
  });

  it("rejects date_suitability > 10", () => {
    expect(ReviewSignalsSchema.safeParse({ ...validSignals, date_suitability: 11 }).success).toBe(false);
  });

  it("rejects invalid review_confidence", () => {
    expect(ReviewSignalsSchema.safeParse({ ...validSignals, review_confidence: "perfect" }).success).toBe(false);
  });

  it("accepts empty arrays for notable_dishes, red_flags, best_for", () => {
    expect(ReviewSignalsSchema.safeParse({
      ...validSignals,
      notable_dishes: [],
      red_flags: [],
      best_for: [],
    }).success).toBe(true);
  });
});

// ─── Phase 3.2: ScoringDimensionsSchema ──────────────────────────────────────

describe("ScoringDimensionsSchema", () => {
  const validDims = {
    budget_match: 8,
    scene_match: 9,
    review_quality: 7,
    location_convenience: 6,
    preference_match: 5,
    red_flag_penalty: 1,
  };

  it("accepts valid dimensions", () => {
    expect(ScoringDimensionsSchema.safeParse(validDims).success).toBe(true);
  });

  it("rejects dimension > 10", () => {
    expect(ScoringDimensionsSchema.safeParse({ ...validDims, scene_match: 11 }).success).toBe(false);
  });

  it("rejects dimension < 0", () => {
    expect(ScoringDimensionsSchema.safeParse({ ...validDims, budget_match: -1 }).success).toBe(false);
  });

  it("rejects red_flag_penalty > 5", () => {
    expect(ScoringDimensionsSchema.safeParse({ ...validDims, red_flag_penalty: 6 }).success).toBe(false);
  });

  it("rejects red_flag_penalty < 0", () => {
    expect(ScoringDimensionsSchema.safeParse({ ...validDims, red_flag_penalty: -0.1 }).success).toBe(false);
  });
});

// ─── Phase 3.2: RankedItemArraySchema with scoring ────────────────────────────

describe("RankedItemArraySchema with scoring", () => {
  const base = {
    rank: 1,
    restaurant_index: 0,
    why_recommended: "Great atmosphere",
    best_for: "Date nights",
    watch_out: "Book ahead",
    not_great_if: "You want casual",
    estimated_total: "$80-100 for two",
  };

  it("accepts item with valid scoring dimensions", () => {
    const result = RankedItemArraySchema.safeParse([{
      ...base,
      scoring: {
        budget_match: 8,
        scene_match: 9,
        review_quality: 7,
        location_convenience: 6,
        preference_match: 5,
        red_flag_penalty: 0,
      },
    }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].scoring?.scene_match).toBe(9);
    }
  });

  it("accepts item without scoring (optional)", () => {
    expect(RankedItemArraySchema.safeParse([base]).success).toBe(true);
  });

  it("rejects invalid scoring dimension value", () => {
    expect(RankedItemArraySchema.safeParse([{
      ...base,
      scoring: {
        budget_match: 8,
        scene_match: 15, // > 10
        review_quality: 7,
        location_convenience: 6,
        preference_match: 5,
        red_flag_penalty: 0,
      },
    }]).success).toBe(false);
  });
});

// ─── Phase 3.1: fetchReviewSignals integration ────────────────────────────────

describe("fetchReviewSignals", () => {
  const mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.MINIMAX_API_KEY = "test-key";
    process.env.TAVILY_API_KEY = "test-key";
  });

  function makeMiniMaxResponse(content: string) {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }

  function makeTavilyResponse(results: Array<{ title: string; content: string }>) {
    return {
      ok: true,
      json: async () => ({ results }),
    };
  }

  it("returns empty map for empty restaurant list", async () => {
    const { fetchReviewSignals } = await import("../tools");
    const result = await fetchReviewSignals([], "date night", "New York, NY");
    expect(result.size).toBe(0);
  });

  it("returns empty map when MiniMax returns no JSON", async () => {
    const { fetchReviewSignals } = await import("../tools");
    mockFetch
      .mockResolvedValueOnce(makeTavilyResponse([{ title: "Review", content: "Great place" }]))
      .mockResolvedValueOnce(makeMiniMaxResponse("I cannot extract signals from this."));

    const restaurant = {
      id: "r1", name: "Test Bistro", cuisine: "French", price: "$$$",
      rating: 4.5, review_count: 300, address: "123 Main St", is_closed: false,
    };
    const result = await fetchReviewSignals([restaurant], "date night", "New York, NY");
    expect(result.size).toBe(0);
  });

  it("parses valid signals returned by MiniMax", async () => {
    const { fetchReviewSignals } = await import("../tools");

    const signals = {
      "La Maison": {
        noise_level: "quiet",
        wait_time: "30 min on weekends",
        date_suitability: 9,
        service_pace: "attentive",
        notable_dishes: ["duck confit"],
        red_flags: [],
        best_for: ["date night"],
        review_confidence: "high",
      },
    };

    mockFetch
      .mockResolvedValueOnce(makeTavilyResponse([{ title: "Review", content: "Wonderful romantic restaurant" }]))
      .mockResolvedValueOnce(makeMiniMaxResponse(JSON.stringify(signals)));

    const restaurant = {
      id: "r1", name: "La Maison", cuisine: "French", price: "$$$",
      rating: 4.8, review_count: 500, address: "10 Park Ave", is_closed: false,
    };
    const result = await fetchReviewSignals([restaurant], "romantic dinner", "New York, NY");
    expect(result.get("La Maison")).toBeDefined();
    expect(result.get("La Maison")?.noise_level).toBe("quiet");
    expect(result.get("La Maison")?.notable_dishes).toContain("duck confit");
  });

  it("returns empty map when MiniMax fetch fails", async () => {
    const { fetchReviewSignals } = await import("../tools");
    mockFetch
      .mockResolvedValueOnce(makeTavilyResponse([{ title: "Review", content: "Good food" }]))
      .mockRejectedValueOnce(new Error("MiniMax down"));

    const restaurant = {
      id: "r1", name: "The Table", cuisine: "American", price: "$$",
      rating: 4.2, review_count: 150, address: "5 Main St", is_closed: false,
    };
    const result = await fetchReviewSignals([restaurant], "dinner", "Chicago, IL");
    expect(result.size).toBe(0);
  });

  it("bounds review enrichment network calls with abort signals", async () => {
    const { fetchReviewSignals } = await import("../tools");
    mockFetch
      .mockResolvedValueOnce(makeTavilyResponse([{ title: "Review", content: "Good food" }]))
      .mockResolvedValueOnce(makeMiniMaxResponse("{}"));

    const restaurant = {
      id: "r1", name: "The Table", cuisine: "American", price: "$$",
      rating: 4.2, review_count: 150, address: "5 Main St", is_closed: false,
    };

    await fetchReviewSignals([restaurant], "dinner", "Chicago, IL");

    expect(mockFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mockFetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("uses google_reviews when available instead of fetching Tavily", async () => {
    const { fetchReviewSignals } = await import("../tools");

    const signals = {
      "Chez Pierre": {
        noise_level: "moderate",
        wait_time: "",
        date_suitability: 7,
        service_pace: "fast",
        notable_dishes: ["steak frites"],
        red_flags: [],
        best_for: [],
        review_confidence: "medium",
      },
    };

    // Only one fetch call: MiniMax. Tavily should be skipped since Google reviews exist.
    mockFetch.mockResolvedValueOnce(makeMiniMaxResponse(JSON.stringify(signals)));

    const restaurant = {
      id: "r2", name: "Chez Pierre", cuisine: "French", price: "$$$",
      rating: 4.4, review_count: 200, address: "7 Rue Foch", is_closed: false,
      google_reviews: [
        { author_name: "Alice", rating: 5, relative_time_description: "1 month ago", text: "The steak frites were amazing, moderate noise level." },
        { author_name: "Bob", rating: 4, relative_time_description: "2 months ago", text: "Good service, fast-paced, enjoyable." },
      ],
    };

    const result = await fetchReviewSignals([restaurant], "dinner", "Paris, France");
    // fetch should have been called once (MiniMax only, no Tavily)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.get("Chez Pierre")).toBeDefined();
  });
});
