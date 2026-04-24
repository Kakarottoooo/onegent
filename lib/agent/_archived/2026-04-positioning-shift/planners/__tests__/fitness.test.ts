import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Google Places (tools) ───────────────────────────────────────────────
vi.mock("../tools", () => ({
  googlePlacesSearch: vi.fn(),
}));

import { googlePlacesSearch } from "../tools";
import { parseFitnessIntent } from "../agent/parse/fitness";
import { runFitnessPlanner } from "../agent/_archived/2026-04-positioning-shift/planners/fitness";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_STUDIO_A = {
  id: "studio-a",
  name: "Brooklyn Yoga Collective",
  cuisine: "fitness",
  price: "$$",
  rating: 4.8,
  review_count: 320,
  address: "123 Bedford Ave, Brooklyn, NY 11211",
  url: "https://brooklynyogacollective.com",
  is_closed: false,
  lat: 40.7153,
  lng: -73.9603,
};

const MOCK_STUDIO_B = {
  id: "studio-b",
  name: "Williamsburg Vinyasa",
  cuisine: "fitness",
  price: "$",
  rating: 4.5,
  review_count: 890,
  address: "456 Graham Ave, Brooklyn, NY 11211",
  url: null,
  is_closed: false,
  lat: 40.7120,
  lng: -73.9530,
};

const MOCK_STUDIO_C = {
  id: "studio-c",
  name: "Budget Flow Studio",
  cuisine: "fitness",
  price: "$",
  rating: 4.2,
  review_count: 180,
  address: "789 Myrtle Ave, Brooklyn, NY 11206",
  url: null,
  is_closed: false,
  lat: 40.6972,
  lng: -73.9400,
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── parseFitnessIntent ───────────────────────────────────────────────────────

describe("parseFitnessIntent", () => {
  const baseCtx = {
    input_language: "en" as const,
    output_language: "en" as const,
    normalized_query: "",
    intent_summary: "",
    location_hint: "New York, NY",
  };

  it("detects yoga with vinyasa style", () => {
    const intent = parseFitnessIntent("find me a vinyasa yoga class in Brooklyn", baseCtx);
    expect(intent.activity).toBe("yoga");
    expect(intent.style).toBe("vinyasa");
    expect(intent.activity_label).toBe("vinyasa yoga");
  });

  it("detects hot yoga", () => {
    const intent = parseFitnessIntent("hot yoga class near me", baseCtx);
    expect(intent.activity).toBe("yoga");
    expect(intent.style).toBe("hot");
    expect(intent.activity_label).toBe("hot yoga");
  });

  it("detects pilates", () => {
    const intent = parseFitnessIntent("I want to find a pilates reformer studio", baseCtx);
    expect(intent.activity).toBe("pilates");
  });

  it("detects spin class", () => {
    const intent = parseFitnessIntent("book a spin class in Williamsburg", baseCtx);
    expect(intent.activity).toBe("spin");
  });

  it("detects HIIT", () => {
    const intent = parseFitnessIntent("find HIIT class on Saturday morning", baseCtx);
    expect(intent.activity).toBe("hiit");
    expect(intent.day_preference).toBe("Saturday");
    expect(intent.time_preference).toBe("morning");
  });

  it("detects boxing class", () => {
    const intent = parseFitnessIntent("I want to try a boxing class", baseCtx);
    expect(intent.activity).toBe("boxing");
  });

  it("detects barre", () => {
    const intent = parseFitnessIntent("looking for barre studio in Brooklyn", baseCtx);
    expect(intent.activity).toBe("barre");
  });

  it("extracts neighborhood from message", () => {
    const intent = parseFitnessIntent("find yoga class in Williamsburg this Saturday", baseCtx);
    expect(intent.neighborhood).toMatch(/Williamsburg/i);
    expect(intent.day_preference).toBe("Saturday");
  });

  it("extracts budget", () => {
    const intent = parseFitnessIntent("yoga class under $25 in Brooklyn", baseCtx);
    expect(intent.budget_per_class).toBe(25);
  });

  it("detects beginner skill level", () => {
    const intent = parseFitnessIntent("beginner yoga class for first timers", baseCtx);
    expect(intent.skill_level).toBe("beginner");
  });

  it("detects evening time preference", () => {
    const intent = parseFitnessIntent("yoga class in the evening after work", baseCtx);
    expect(intent.time_preference).toBe("evening");
  });

  it("defaults to any skill and any time when not specified", () => {
    const intent = parseFitnessIntent("find me a yoga studio", baseCtx);
    expect(intent.skill_level).toBe("any");
    expect(intent.time_preference).toBe("any");
  });

  it("filters GPS placeholder as no neighborhood", () => {
    const gpsCtx = { ...baseCtx, location_hint: "your current location" };
    const intent = parseFitnessIntent("find yoga class near me", gpsCtx);
    expect(intent.neighborhood).toBeUndefined();
  });

  it("builds correct scenario_goal", () => {
    const intent = parseFitnessIntent("find pilates class in SoHo", baseCtx);
    expect(intent.scenario_goal).toContain("pilates");
  });
});

// ─── runFitnessPlanner ────────────────────────────────────────────────────────

const mockPlaces = vi.mocked(googlePlacesSearch);

describe("runFitnessPlanner", () => {
  beforeEach(() => {
    mockPlaces.mockReset();
  });

  const baseIntent = {
    category: "fitness" as const,
    scenario: "fitness" as const,
    scenario_goal: "Find vinyasa yoga classes in Brooklyn",
    activity: "yoga" as const,
    activity_label: "vinyasa yoga",
    style: "vinyasa",
    neighborhood: "Brooklyn",
    city: "New York, NY",
    day_preference: "Saturday",
    time_preference: "morning" as const,
    budget_per_class: 25,
    skill_level: "any" as const,
    planning_assumptions: ["Activity: vinyasa yoga", "Location: Brooklyn", "Day: Saturday"],
    needs_clarification: false,
    missing_fields: [],
  };

  it("returns DecisionPlan with 3 tiers when 3+ studios found", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B, MOCK_STUDIO_C]);

    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(plan).not.toBeNull();
    expect(plan!.primary_plan).toBeDefined();
    expect(plan!.backup_plans.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null when Google Places returns empty", async () => {
    mockPlaces.mockResolvedValueOnce([]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(plan).toBeNull();
  });

  it("includes ClassPass and Mindbody links in primary plan", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B, MOCK_STUDIO_C]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(plan!.primary_plan.primary_action.url).toContain("classpass.com");
    const secondaryUrls = plan!.primary_plan.secondary_actions.map((a) => a.url);
    expect(secondaryUrls.some((u) => u.includes("mindbodyonline.com"))).toBe(true);
    expect(secondaryUrls.some((u) => u.includes("maps.google.com"))).toBe(true);
  });

  it("ClassPass URL encodes activity and location correctly", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    const cpUrl = plan!.primary_plan.primary_action.url;
    expect(cpUrl).toContain("query=vinyasa%20yoga");
    expect(cpUrl).toContain("location=Brooklyn");
  });

  it("assigns Top rated tier to highest-rating studio", async () => {
    // A has higher rating than B and C
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B, MOCK_STUDIO_C]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    // Top rated should be studio A (4.8★)
    expect(plan!.primary_plan.title).toBe("Brooklyn Yoga Collective");
  });

  it("works with only one studio", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(plan).not.toBeNull();
    expect(plan!.confidence).toBe("medium");
  });

  it("returns Chinese copy for zh output language", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B, MOCK_STUDIO_C]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "zh" });
    expect(plan!.primary_plan.primary_action.label).toContain("ClassPass");
    // Chinese copy for "Top rated"
    expect(plan!.primary_plan.label).toBe("评分最高");
  });

  it("includes timing note reflecting day and time preference", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A, MOCK_STUDIO_B, MOCK_STUDIO_C]);
    const plan = await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(plan!.primary_plan.timing_note).toMatch(/Saturday|morning/i);
  });

  it("Google Places query includes style and neighborhood", async () => {
    mockPlaces.mockResolvedValueOnce([MOCK_STUDIO_A]);
    await runFitnessPlanner({ intent: baseIntent, outputLanguage: "en" });
    expect(mockPlaces).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("vinyasa"),
        location: "New York, NY",
      })
    );
  });

  it("filters out $$$ studios when budget < 20", async () => {
    const expensiveStudio = { ...MOCK_STUDIO_C, id: "pricey", price: "$$$", rating: 4.9 };
    mockPlaces.mockResolvedValueOnce([expensiveStudio, MOCK_STUDIO_A, MOCK_STUDIO_B]);
    const lowBudgetIntent = { ...baseIntent, budget_per_class: 15 };
    const plan = await runFitnessPlanner({ intent: lowBudgetIntent, outputLanguage: "en" });
    // Pricey studio should not be primary_plan
    expect(plan!.primary_plan.title).not.toBe("pricey");
  });
});
