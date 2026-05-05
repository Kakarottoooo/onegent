import { describe, expect, it, vi, beforeEach } from "vitest";
import { rankAndExplain } from "../agent/pipelines/restaurant";
import type { Restaurant, UserRequirements } from "../types";

const mockOpenaiChat = vi.fn();
vi.mock("../openai", () => ({
  openaiChat: (...args: unknown[]) => mockOpenaiChat(...args),
}));

function restaurant(overrides: Partial<Restaurant>): Restaurant {
  return {
    id: overrides.id ?? "r",
    name: overrides.name ?? "Restaurant",
    cuisine: overrides.cuisine ?? "Restaurant",
    price: overrides.price ?? "$$",
    rating: overrides.rating ?? 4.5,
    review_count: overrides.review_count ?? 100,
    address: overrides.address ?? "New York, NY",
    is_closed: false,
    ...overrides,
  };
}

describe("restaurant cuisine rerank", () => {
  beforeEach(() => {
    mockOpenaiChat.mockReset();
  });

  it("keeps fallback recommendations cuisine-aligned when broad search returns higher-rated generic restaurants", async () => {
    mockOpenaiChat.mockRejectedValueOnce(new Error("ranking timeout"));

    const requirements: UserRequirements = {
      cuisine: "Japanese",
      location: "New York",
      party_size: 2,
    };

    const result = await rankAndExplain(
      requirements,
      [
        restaurant({
          id: "french",
          name: "La Grande Boucherie",
          cuisine: "French Restaurant",
          rating: 4.8,
          review_count: 10000,
        }),
        restaurant({
          id: "american",
          name: "Au Cheval",
          cuisine: "American Restaurant",
          rating: 4.9,
          review_count: 8000,
        }),
        restaurant({
          id: "japanese",
          name: "Sozai Japanese Restaurant",
          cuisine: "Japanese Restaurant",
          rating: 4.6,
          review_count: 500,
        }),
        restaurant({
          id: "ramen",
          name: "Tonchin Ramen",
          cuisine: "Ramen Restaurant",
          rating: 4.5,
          review_count: 700,
        }),
      ],
      "",
      [],
      "New York"
    );

    expect(result.cards.map((card) => card.restaurant.id)).toEqual(["japanese", "ramen"]);
    expect(result.cards.map((card) => card.why_recommended).join("\n")).not.toContain(
      "still aligned with your Japanese ask"
    );
    expect(result.cards.every((card) => /Japanese|Ramen/i.test(card.restaurant.cuisine))).toBe(true);
  });

  it("uses a short ranker budget so fallback cards can return before the chat route timeout", async () => {
    mockOpenaiChat.mockRejectedValueOnce(new Error("ranking timeout"));

    await rankAndExplain(
      { cuisine: "Chinese", location: "New York", party_size: 2 },
      [
        restaurant({
          id: "chinese",
          name: "Great NY Noodletown",
          cuisine: "Chinese Restaurant",
        }),
      ],
      "",
      [],
      "New York"
    );

    expect(mockOpenaiChat).toHaveBeenCalledWith(expect.objectContaining({ timeout_ms: 10_000 }));
  });
});
