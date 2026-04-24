import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.stubEnv("SERPAPI_KEY", "test-api-key");

// ─────────────────────────────────────────────────────────────────────────────

import { searchShoppingProducts } from "../serpapi-shopping";
import { parseGiftIntent } from "../agent/parse/gift";
import { runGiftPlanner } from "../agent/_archived/2026-04-positioning-shift/planners/gift";
import type { MultilingualQueryContext } from "../types";

const BASE_CONTEXT: MultilingualQueryContext = {
  input_language: "en",
  output_language: "en",
  normalized_query: "gift for my girlfriend",
  intent_summary: "gift for girlfriend",
};

const MOCK_PRODUCT = {
  title: "Luxe Candle Set",
  price: "$45.99",
  source: "Amazon",
  link: "https://amazon.com/luxe-candle",
  thumbnail: "https://img.example.com/candle.jpg",
  rating: 4.7,
  reviews: 1230,
};

function makeFetchResponse(products: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ shopping_results: products }),
    text: () => Promise.resolve(""),
  });
}

// ── searchShoppingProducts ─────────────────────────────────────────────────────

describe("searchShoppingProducts", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns parsed products on success", async () => {
    mockFetch.mockReturnValueOnce(makeFetchResponse([MOCK_PRODUCT]));
    const products = await searchShoppingProducts({ query: "gift for girlfriend" });
    expect(products).toHaveLength(1);
    expect(products[0].title).toBe("Luxe Candle Set");
    expect(products[0].price).toBe(45.99);
    expect(products[0].price_raw).toBe("$45.99");
    expect(products[0].source).toBe("Amazon");
    expect(products[0].link).toBe("https://amazon.com/luxe-candle");
    expect(products[0].image_url).toBe("https://img.example.com/candle.jpg");
    expect(products[0].rating).toBe(4.7);
    expect(products[0].reviews).toBe(1230);
  });

  it("returns empty array when API responds with non-200", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("Rate limited") })
    );
    const products = await searchShoppingProducts({ query: "gift" });
    expect(products).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const products = await searchShoppingProducts({ query: "gift" });
    expect(products).toEqual([]);
  });

  it("filters out results without a title", async () => {
    const badProduct = { price: "$10", source: "eBay" }; // no title
    mockFetch.mockReturnValueOnce(makeFetchResponse([badProduct, MOCK_PRODUCT]));
    const products = await searchShoppingProducts({ query: "gift" });
    expect(products).toHaveLength(1);
    expect(products[0].title).toBe("Luxe Candle Set");
  });

  it("returns empty array when no shopping_results in response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") })
    );
    const products = await searchShoppingProducts({ query: "gift" });
    expect(products).toEqual([]);
  });

  it("returns empty array when SERPAPI_KEY is not set", async () => {
    vi.stubEnv("SERPAPI_KEY", "");
    const products = await searchShoppingProducts({ query: "gift" });
    expect(products).toEqual([]);
    vi.stubEnv("SERPAPI_KEY", "test-api-key");
  });
});

// ── parseGiftIntent ───────────────────────────────────────────────────────────

describe("parseGiftIntent", () => {
  it("detects birthday occasion", () => {
    const intent = parseGiftIntent("I need a birthday gift for my girlfriend", BASE_CONTEXT);
    expect(intent.scenario).toBe("gift");
    expect(intent.occasion).toBe("birthday");
    expect(intent.relationship).toBe("partner");
    expect(intent.recipient).toBe("partner");
  });

  it("detects mother's day occasion", () => {
    const intent = parseGiftIntent("gift idea for mothers day for my mom", BASE_CONTEXT);
    expect(intent.occasion).toBe("mothers_day");
    expect(intent.relationship).toBe("parent");
  });

  it("detects interests from message", () => {
    const intent = parseGiftIntent("gift for my hiking and cooking friend", BASE_CONTEXT);
    expect(intent.interests).toContain("hiking");
    expect(intent.interests).toContain("cooking");
  });

  it("extracts budget from message", () => {
    const intent = parseGiftIntent("gift for dad under $100", BASE_CONTEXT);
    expect(intent.budget_usd_max).toBe(100);
    expect(intent.relationship).toBe("parent");
    expect(intent.recipient).toBe("dad");
  });

  it("marks budget as missing when not provided", () => {
    const intent = parseGiftIntent("gift for my sister", BASE_CONTEXT);
    expect(intent.missing_fields).toContain("budget");
  });

  it("marks recipient as missing when not found", () => {
    const intent = parseGiftIntent("find me a gift", BASE_CONTEXT);
    expect(intent.missing_fields).toContain("recipient");
  });

  it("uses party_size_hint when provided", () => {
    const intent = parseGiftIntent("anniversary gift for my boyfriend", {
      ...BASE_CONTEXT,
      budget_total_hint: 200,
    });
    expect(intent.budget_usd_max).toBe(200);
    expect(intent.occasion).toBe("anniversary");
  });

  it("builds scenario_goal with occasion and recipient", () => {
    const intent = parseGiftIntent("Christmas gift for my boss", BASE_CONTEXT);
    expect(intent.scenario_goal).toMatch(/christmas/i);
    expect(intent.scenario_goal).toMatch(/boss/i);
  });

  it("sets needs_clarification true when fields are missing", () => {
    const intent = parseGiftIntent("find me a gift", BASE_CONTEXT);
    expect(intent.needs_clarification).toBe(true);
  });

  it("sets needs_clarification false when recipient and budget both provided", () => {
    const intent = parseGiftIntent("birthday gift for my mom under $50", BASE_CONTEXT);
    expect(intent.needs_clarification).toBe(false);
  });
});

// ── runGiftPlanner ─────────────────────────────────────────────────────────────

describe("runGiftPlanner", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockAllSearches(product = MOCK_PRODUCT) {
    // 3 parallel searches = 3 fetch calls
    for (let i = 0; i < 3; i++) {
      mockFetch.mockReturnValueOnce(makeFetchResponse([product]));
    }
  }

  it("returns null when all searches return no results", async () => {
    for (let i = 0; i < 3; i++) {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") })
      );
    }
    const intent = parseGiftIntent("gift for my girlfriend", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan).toBeNull();
  });

  it("returns a DecisionPlan with 3 options (safe / thoughtful / creative)", async () => {
    mockAllSearches();
    const intent = parseGiftIntent("birthday gift for my girlfriend under $50", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan).not.toBeNull();
    expect(plan!.scenario).toBe("gift");
    expect(plan!.primary_plan.label).toBe("Safe pick");
    expect(plan!.backup_plans).toHaveLength(2);
    expect(plan!.backup_plans[0].label).toBe("Most thoughtful");
    expect(plan!.backup_plans[1].label).toBe("Most creative");
  });

  it("includes buy link in primary_action", async () => {
    mockAllSearches();
    const intent = parseGiftIntent("gift for my mom", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan!.primary_plan.primary_action?.url).toContain("amazon.com");
  });

  it("falls back to google shopping URL when product has no link", async () => {
    const noLinkProduct = { title: "Mystery Box", price: "$20", source: "Etsy" };
    for (let i = 0; i < 3; i++) {
      mockFetch.mockReturnValueOnce(makeFetchResponse([noLinkProduct]));
    }
    const intent = parseGiftIntent("creative gift for my friend", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan!.primary_plan.primary_action?.url).toContain("google.com");
  });

  it("builds Chinese output when outputLanguage is zh", async () => {
    mockAllSearches();
    const intent = parseGiftIntent("gift for my mom", { ...BASE_CONTEXT, output_language: "zh" });
    const plan = await runGiftPlanner({ intent, outputLanguage: "zh" });
    expect(plan!.output_language).toBe("zh");
    expect(plan!.primary_plan.label).toBe("稳妥之选");
    expect(plan!.backup_plans[0].label).toBe("最走心");
    expect(plan!.backup_plans[1].label).toBe("最有创意");
  });

  it("still builds a plan with 1 backup when one search returns empty", async () => {
    // safe: has results, thoughtful: empty, creative: has results
    mockFetch.mockReturnValueOnce(makeFetchResponse([MOCK_PRODUCT]));
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve("") })
    );
    mockFetch.mockReturnValueOnce(makeFetchResponse([MOCK_PRODUCT]));
    const intent = parseGiftIntent("gift for my dad", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan).not.toBeNull();
    expect(plan!.backup_plans).toHaveLength(1);
  });

  it("uses budget in scenario_brief", async () => {
    mockAllSearches();
    const intent = parseGiftIntent("birthday gift for my girlfriend under $80", BASE_CONTEXT);
    const plan = await runGiftPlanner({ intent, outputLanguage: "en" });
    expect(plan!.scenario_brief.some((s) => s.includes("80"))).toBe(true);
  });
});
