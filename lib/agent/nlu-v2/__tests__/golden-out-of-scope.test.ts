/**
 * Golden test cases for NLU v2 · out-of-scope detection + reply contract.
 *
 * Drives the REAL `unifiedTurn()` LLM call (state + reply in one shot)
 * with raw user messages. Two suites:
 *
 *   1. OUT-OF-SCOPE cases — non-travel topics must come back with
 *      intent==="chitchat", scenario===null, and an "out_of_scope:" tag
 *      in planning_assumptions. Reply must be a polite decline.
 *
 *   2. IN-SCOPE GUARD cases — casual restaurant/hotel phrasings (and
 *      messages where the prev turn was OOS but the user pivots) must
 *      NOT be flagged out_of_scope. Catches the "今晚帮我找个 nashville
 *      好吃的餐厅 → declined" regression class.
 *
 * Requires OPENAI_API_KEY. CI without the key skips the whole file.
 */

import { describe, it, expect } from "vitest";
import { unifiedTurn } from "../unified";
import type { IntentState } from "../types";

const hasApiKey = Boolean(process.env.OPENAI_API_KEY);

// Each unified call takes a few seconds; raise the per-test timeout so
// slow network doesn't cause flakes. 30s = openaiChat's 25s timeout + slack.
const TIMEOUT_MS = 30_000;

function assertOutOfScope(state: IntentState) {
  expect(state.intent).toBe("chitchat");
  expect(state.scenario).toBeNull();
  expect(Array.isArray(state.planning_assumptions)).toBe(true);
  const hasOutOfScopeTag = state.planning_assumptions.some(
    (entry) => typeof entry === "string" && entry.startsWith("out_of_scope:"),
  );
  expect(hasOutOfScopeTag).toBe(true);
}

function assertInScope(
  state: IntentState,
  expectedScenario: "restaurant" | "hotel" | "flight" | "activity" | "trip",
) {
  expect(state.scenario).toBe(expectedScenario);
  const hasOutOfScopeTag = state.planning_assumptions.some(
    (entry) => typeof entry === "string" && entry.toLowerCase().startsWith("out_of_scope:"),
  );
  expect(hasOutOfScopeTag).toBe(false);
}

describe.skipIf(!hasApiKey)("Golden out-of-scope cases · unified tags non-travel as chitchat + writes decline reply", () => {
  it(
    "O1. English electronics shopping → intent=chitchat, scenario=null, planning_assumptions has out_of_scope:",
    async () => {
      const { state, reply } = await unifiedTurn({
        prev_state: null,
        new_user_message: "help me buy a laptop for coding",
      });
      assertOutOfScope(state);
      // Decline reply should mention travel scope, however phrased.
      expect(reply.toLowerCase()).toMatch(/travel|onegent|chatgpt|claude|restaurant|hotel/);
    },
    TIMEOUT_MS,
  );

  it(
    "O2. Chinese fitness request → intent=chitchat, scenario=null, planning_assumptions has out_of_scope:",
    async () => {
      const { state } = await unifiedTurn({
        prev_state: null,
        new_user_message: "推荐 brooklyn 周六早上的瑜伽课",
      });
      assertOutOfScope(state);
    },
    TIMEOUT_MS,
  );

  it(
    "O3. English gift request → intent=chitchat, scenario=null, planning_assumptions has out_of_scope:",
    async () => {
      const { state } = await unifiedTurn({
        prev_state: null,
        new_user_message: "gift ideas for my mom birthday budget 150",
      });
      assertOutOfScope(state);
    },
    TIMEOUT_MS,
  );
});

describe.skipIf(!hasApiKey)("Golden in-scope guard · casual phrasings must NOT be flagged out_of_scope", () => {
  it(
    "I1. Casual Chinese restaurant request → scenario=restaurant, no out_of_scope tag, reply does NOT decline",
    async () => {
      const { state, reply } = await unifiedTurn({
        prev_state: null,
        new_user_message: "今晚帮我找个 nashville 好吃的餐厅",
      });
      assertInScope(state, "restaurant");
      // Reply must NOT be the OOS decline. Decline always mentions
      // ChatGPT/Claude or "other topics" — assert those don't appear.
      expect(reply.toLowerCase()).not.toMatch(/chatgpt|claude|其他主题|other topics/);
    },
    TIMEOUT_MS,
  );

  it(
    "I2. Casual Chinese hotel request → scenario=hotel, no out_of_scope tag",
    async () => {
      const { state } = await unifiedTurn({
        prev_state: null,
        new_user_message: "帮我订个东京的酒店",
      });
      assertInScope(state, "hotel");
    },
    TIMEOUT_MS,
  );

  it(
    "I3. Stale out_of_scope from prev turn must be scrubbed when scenario clarifies",
    async () => {
      const prev: IntentState = {
        confidence: 0.5,
        turn_count: 1,
        updated_at: new Date().toISOString(),
        intent: "chitchat",
        scenario: null,
        party_type: "solo",
        member_names: [],
        refined_target_id: null,
        planning_assumptions: ["out_of_scope: gift ideas"],
      };
      const { state } = await unifiedTurn({
        prev_state: prev,
        new_user_message: "actually, can you book me a table at Carbone NYC tomorrow 7pm for 2",
      });
      assertInScope(state, "restaurant");
    },
    TIMEOUT_MS,
  );
});
