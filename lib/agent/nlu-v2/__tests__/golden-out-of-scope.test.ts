/**
 * Golden test cases for NLU v2 · out-of-scope (non-travel) decline path.
 *
 * Unlike the other golden-*.test.ts files (which hand-build IntentState and
 * only exercise the router), this one drives the REAL extractor with raw
 * user messages so we can verify the US-005 prompt contract end-to-end:
 *
 *   When the user asks about a non-travel topic (electronics, shopping,
 *   gifts, fitness, credit cards, personal advice), the extractor must emit
 *     - intent === "chitchat"
 *     - scenario === null
 *     - planning_assumptions contains an entry starting with "out_of_scope:"
 *
 * This is the regression guard that catches silent prompt drift in
 * lib/agent/nlu-v2/extractor.ts. Requires OPENAI_API_KEY; the whole suite
 * is skipped when absent so CI without the key still passes.
 */

import { describe, it, expect } from "vitest";
import { extractState } from "../extractor";

const hasApiKey = Boolean(process.env.OPENAI_API_KEY);

// Each LLM call takes a few seconds; raise the per-test timeout so slow
// network doesn't cause flakes. 30s is the same budget extractor.ts sets
// for its own openaiChat timeout (20s) plus some slack.
const TIMEOUT_MS = 30_000;

function assertOutOfScope(state: Awaited<ReturnType<typeof extractState>>) {
  expect(state.intent).toBe("chitchat");
  expect(state.scenario).toBeNull();
  expect(Array.isArray(state.planning_assumptions)).toBe(true);
  const hasOutOfScopeTag = state.planning_assumptions.some(
    (entry) => typeof entry === "string" && entry.startsWith("out_of_scope:"),
  );
  expect(hasOutOfScopeTag).toBe(true);
}

describe.skipIf(!hasApiKey)("Golden out-of-scope cases · extractor tags non-travel as chitchat", () => {
  it(
    "O1. English electronics shopping → intent=chitchat, scenario=null, planning_assumptions has out_of_scope:",
    async () => {
      const state = await extractState({
        prev_state: null,
        new_user_message: "help me buy a laptop for coding",
      });
      assertOutOfScope(state);
    },
    TIMEOUT_MS,
  );

  it(
    "O2. Chinese fitness request → intent=chitchat, scenario=null, planning_assumptions has out_of_scope:",
    async () => {
      const state = await extractState({
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
      const state = await extractState({
        prev_state: null,
        new_user_message: "gift ideas for my mom birthday budget 150",
      });
      assertOutOfScope(state);
    },
    TIMEOUT_MS,
  );
});
