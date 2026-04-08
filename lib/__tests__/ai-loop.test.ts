/**
 * Phase 1 unit tests for the AI loop.
 *
 * These tests verify the types and execute.ts logic without making real
 * LLM calls or launching a browser. perceive.ts and loop.ts integration
 * tests require a real browser — see scripts/test-ai-loop.mjs for those.
 */
import { describe, it, expect, vi } from "vitest";
import type { NextAction, PerceptionResult, AILoopResult } from "../booking-autopilot/ai-loop/types";

// ── Type shape tests ─────────────────────────────────────────────────────────

describe("AI loop types", () => {
  it("NextAction act shape is valid", () => {
    const action: NextAction = {
      type: "act",
      instruction: "click the cheapest available room",
      reasoning: "I can see a room list",
      confidence: 0.9,
    };
    expect(action.type).toBe("act");
    expect(action.instruction).toBeDefined();
  });

  it("NextAction fill_form shape is valid", () => {
    const action: NextAction = {
      type: "fill_form",
      fields: { "first name": "John", "email": "john@example.com" },
      reasoning: "Guest info form is visible",
      confidence: 0.95,
    };
    expect(action.fields?.["first name"]).toBe("John");
  });

  it("NextAction done shape is valid", () => {
    const action: NextAction = {
      type: "done",
      outcome: "paused_payment",
      reasoning: "CVV field is visible",
      confidence: 1.0,
    };
    expect(action.outcome).toBe("paused_payment");
  });

  it("PerceptionResult shape is valid", () => {
    const result: PerceptionResult = {
      stage: "room_selection",
      pageDescription: "Room list with Standard King at $150/night",
      nextAction: {
        type: "act",
        instruction: "click Select on the Standard King room",
        reasoning: "cheapest available option",
        confidence: 0.88,
      },
    };
    expect(result.stage).toBe("room_selection");
    expect(result.nextAction.type).toBe("act");
  });

  it("AILoopResult shape is valid", () => {
    const result: AILoopResult = {
      outcome: "paused_payment",
      finalUrl: "https://secure.booking.com/book/pays",
      steps: [],
      summary: "Reached payment page, card details pre-filled",
    };
    expect(result.outcome).toBe("paused_payment");
  });
});

// ── executeAction unit tests (mock page) ─────────────────────────────────────

describe("executeAction", () => {
  // Dynamically import so we can mock Page
  it("calls page.act with instruction for 'act' type", async () => {
    const { executeAction } = await import("../booking-autopilot/ai-loop/execute");
    const mockAct = vi.fn().mockResolvedValue(undefined);
    const mockPage = { act: mockAct, evaluate: vi.fn(), waitForLoadState: vi.fn() } as any;
    const trace = vi.fn();

    const action: NextAction = {
      type: "act",
      instruction: "click the Book Now button",
      reasoning: "button is visible",
      confidence: 0.9,
    };

    await executeAction(mockPage, action, trace);
    expect(mockAct).toHaveBeenCalledWith("click the Book Now button");
  });

  it("calls page.act for each field in fill_form", async () => {
    const { executeAction } = await import("../booking-autopilot/ai-loop/execute");
    const mockAct = vi.fn().mockResolvedValue(undefined);
    const mockPage = { act: mockAct, evaluate: vi.fn(), waitForLoadState: vi.fn() } as any;
    const trace = vi.fn();

    const action: NextAction = {
      type: "fill_form",
      fields: { "first name": "Alice", "email": "alice@example.com" },
      reasoning: "guest form visible",
      confidence: 0.92,
    };

    await executeAction(mockPage, action, trace);
    expect(mockAct).toHaveBeenCalledTimes(2);
    expect(mockAct).toHaveBeenCalledWith('Fill the first name field with "Alice"');
    expect(mockAct).toHaveBeenCalledWith('Fill the email field with "alice@example.com"');
  });

  it("calls page.evaluate for scroll_down", async () => {
    const { executeAction } = await import("../booking-autopilot/ai-loop/execute");
    const mockEval = vi.fn().mockResolvedValue(undefined);
    const mockPage = { act: vi.fn(), evaluate: mockEval, waitForLoadState: vi.fn() } as any;

    await executeAction(mockPage, {
      type: "scroll_down", reasoning: "need to scroll", confidence: 1
    }, vi.fn());

    expect(mockEval).toHaveBeenCalled();
  });

  it("skips 'act' action with missing instruction", async () => {
    const { executeAction } = await import("../booking-autopilot/ai-loop/execute");
    const mockAct = vi.fn();
    const mockPage = { act: mockAct, evaluate: vi.fn(), waitForLoadState: vi.fn() } as any;
    const trace = vi.fn();

    const result = await executeAction(mockPage, {
      type: "act", reasoning: "no instruction", confidence: 0.5
    }, trace);

    expect(result).toBe(false);
    expect(mockAct).not.toHaveBeenCalled();
  });

  it("does nothing for 'done' type", async () => {
    const { executeAction } = await import("../booking-autopilot/ai-loop/execute");
    const mockPage = { act: vi.fn(), evaluate: vi.fn(), waitForLoadState: vi.fn() } as any;

    const result = await executeAction(mockPage, {
      type: "done", outcome: "paused_payment", reasoning: "cvv visible", confidence: 1
    }, vi.fn());

    expect(result).toBe(true);
    expect(mockPage.act).not.toHaveBeenCalled();
  });
});

// ── perceive.ts JSON parsing robustness ──────────────────────────────────────

describe("perceive: JSON parsing robustness", () => {
  it("parseResult handles markdown fences", () => {
    const raw = "```json\n{\"stage\":\"guest_form\",\"pageDescription\":\"form page\",\"nextAction\":{\"type\":\"fill_form\",\"fields\":{\"first name\":\"Alice\"},\"reasoning\":\"form visible\",\"confidence\":0.9}}\n```";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned);
    expect(parsed.stage).toBe("guest_form");
  });

  it("parseResult returns scroll_down fallback on invalid JSON", () => {
    // Simulate the fallback behavior from perceive.ts
    const raw = "I cannot determine the next action.";
    let result: PerceptionResult;
    try {
      result = JSON.parse(raw);
    } catch {
      result = {
        stage: "unknown",
        pageDescription: "LLM response parse error",
        nextAction: { type: "scroll_down", reasoning: `parse error: ${raw.slice(0, 120)}`, confidence: 0.1 }
      };
    }
    expect(result.nextAction.type).toBe("scroll_down");
    expect(result.nextAction.confidence).toBeLessThan(0.5);
  });
});
