import { describe, it, expect } from "vitest";
import {
  UserRequirementsSchema,
  RankedItemArraySchema,
  ChatRequestSchema,
} from "../schemas";

describe("UserRequirementsSchema", () => {
  it("accepts a minimal empty object", () => {
    const result = UserRequirementsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated object", () => {
    const result = UserRequirementsSchema.safeParse({
      cuisine: "Italian",
      purpose: "date",
      budget_per_person: 60,
      atmosphere: ["romantic", "quiet"],
      noise_level: "quiet",
      location: "Nashville, TN",
      party_size: 2,
      constraints: ["no chains"],
      priorities: ["atmosphere"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid purpose enum", () => {
    const result = UserRequirementsSchema.safeParse({ purpose: "party" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid noise_level", () => {
    const result = UserRequirementsSchema.safeParse({ noise_level: "silent" });
    expect(result.success).toBe(false);
  });
});

describe("RankedItemArraySchema", () => {
  const validItem = {
    rank: 1,
    restaurant_index: 0,
    score: 8.5,
    why_recommended: "Great for dates",
    best_for: "Romantic evenings",
    watch_out: "Book ahead",
    not_great_if: "You want lively",
    estimated_total: "$80-100",
  };

  it("accepts a valid array", () => {
    const result = RankedItemArraySchema.safeParse([validItem]);
    expect(result.success).toBe(true);
  });

  it("accepts an empty array", () => {
    const result = RankedItemArraySchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects a negative restaurant_index", () => {
    const result = RankedItemArraySchema.safeParse([
      { ...validItem, restaurant_index: -1 },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects a non-array input", () => {
    const result = RankedItemArraySchema.safeParse({ rank: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects an item missing why_recommended", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { why_recommended: _, ...incomplete } = validItem;
    const result = RankedItemArraySchema.safeParse([incomplete]);
    expect(result.success).toBe(false);
  });
});

describe("ChatRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = ChatRequestSchema.safeParse({
      message: "Best Italian restaurant for a date",
      history: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty message", () => {
    const result = ChatRequestSchema.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a message over 500 chars", () => {
    const result = ChatRequestSchema.safeParse({ message: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects history with more than 20 entries", () => {
    const result = ChatRequestSchema.safeParse({
      message: "test",
      history: Array(21).fill({ role: "user", content: "hi" }),
    });
    expect(result.success).toBe(false);
  });

  it("defaults history to [] when omitted", () => {
    const result = ChatRequestSchema.safeParse({ message: "test" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.history).toEqual([]);
  });

  it("trims whitespace from message", () => {
    const result = ChatRequestSchema.safeParse({ message: "  test  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe("test");
  });

  it("accepts confirmed constraints from a confirm card", () => {
    const result = ChatRequestSchema.safeParse({
      message: "帮我订一个5月20号到24号的纽约酒店，预算300一天",
      category_hint: "hotel",
      confirmed_constraints: {
        city: "New York",
        check_in: "2026-05-20",
        check_out: "2026-05-24",
        budget_per_night: 300,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmed_constraints?.check_in).toBe("2026-05-20");
    }
  });
});
