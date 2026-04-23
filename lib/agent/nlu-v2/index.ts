/**
 * NLU v2 — public API barrel.
 *
 * Use `analyzeConversationalV2()` as the top-level entry. It orchestrates
 * all three layers (extractor → router → chat) and returns a v1-shape
 * response so `/api/chat/parse`'s callers don't need to change.
 */

import { extractState, type Turn } from "./extractor";
import { routeIntent, buildStateSummary } from "./router";
import { chatTurn } from "./chat";
import type {
  IntentState,
  RouterAction,
  NluV2ParseResult,
} from "./types";

// Re-exports so callers can `import { ... } from "@/lib/agent/nlu-v2"`.
export { extractState, type Turn } from "./extractor";
export { routeIntent, getMissingForScenario, buildStateSummary } from "./router";
export { chatTurn } from "./chat";
export type {
  IntentState,
  RouterAction,
  NluV2ParseResult,
  NluIntent,
  NluScenario,
  PartyType,
  QuickPick,
  RestaurantFields,
  HotelFields,
  FlightFields,
  ActivityFields,
} from "./types";

// ─── Top-level orchestrator ───────────────────────────────────────────────

export interface AnalyzeV2Input {
  message: string;
  history: Turn[];
  prev_state?: IntentState | null;
  /** Optional per-layer model overrides (from AgentModelConfig). */
  model?: {
    chat?: string;       // Layer 1
    extractor?: string;  // Layer 2
  };
  apiKey?: string;
  /**
   * Id of a Plan or Room the user is editing, if any. Plumbed through to
   * IntentState.refined_target_id so downstream code knows refine_existing
   * is in scope. Mirror of v1's ConversationalNLUInput.pinned_target_id.
   */
  pinned_target_id?: string;
}

/**
 * Orchestrates all three layers and returns a v1-compatible
 * NluV2ParseResult. Call order:
 *   1. Extractor (Layer 2) builds the new IntentState from history + this turn.
 *   2. Router (Layer 3) decides the RouterAction.
 *   3. Chat (Layer 1) generates the assistant_reply text.
 *
 * Step 3 could run in parallel with step 2, but we serialize so the chat
 * model sees the router's decision (via buildStateSummary) and can phrase
 * its reply accordingly.
 */
export async function analyzeConversationalV2(
  input: AnalyzeV2Input,
): Promise<NluV2ParseResult> {
  // Layer 2: extract state
  const state = await extractState({
    prev_state: input.prev_state ?? null,
    new_user_message: input.message,
    history: input.history,
    model: input.model?.extractor,
    apiKey: input.apiKey,
  });

  // Plumb pinned_target_id through. v1 trusted this signal to escalate
  // ambiguous edits to intent=refine_existing; v2's extractor doesn't see
  // this param (it's out-of-band from the user message), so we inject here.
  if (input.pinned_target_id) {
    state.refined_target_id = input.pinned_target_id;
  }

  // Layer 3: decide action (pure function)
  const action = routeIntent(state);

  // Layer 1: generate natural reply
  const stateSummary = buildStateSummary(state);
  const { reply } = await chatTurn({
    history: input.history,
    new_user_message: input.message,
    state_summary: stateSummary,
    action,
    model: input.model?.chat,
    apiKey: input.apiKey,
  });

  return toV1CompatShape(state, action, reply);
}

// ─── V1-compat projection ─────────────────────────────────────────────────
// Flattens v2's (state, action, reply) into the same ConversationalNLUResult
// shape `/api/chat/parse` has been returning since Phase 1. This lets the
// frontend (ConversationalChat + ConfirmCard) render v2 responses without
// any component changes.

function toV1CompatShape(
  state: IntentState,
  action: RouterAction,
  reply: string,
): NluV2ParseResult {
  const collected = flattenScenarioFields(state);
  const missing = action.type === "ask_clarification" ? action.missing : [];
  const quickPicks = action.type === "ask_clarification" ? action.suggested_quick_picks ?? null : null;
  const confirmReady = action.type === "show_confirm_card";

  // Stage 1 guardrail: trip packaging is solo-only. Multi-party trip rooms
  // are a Stage 2 feature (see NLU_REFACTOR_PLAN_C.md + TRIP_PACKAGING_PLAN.md).
  // If the extractor tags a trip as create_room — easy to do when it over-
  // interprets "2 people" as multi-decider — force it back to create_plan
  // so the frontend routes through the trip confirm card (Package my trip)
  // instead of the Decision Room confirm card (which commit endpoint would
  // reject with 501 "coming in Stage 2"). Drop this override when Stage 2
  // multi-party trip rooms land.
  const effectiveIntent =
    state.scenario === "trip" && state.intent === "create_room"
      ? "create_plan"
      : state.intent;

  return {
    intent: effectiveIntent,
    scenario: state.scenario,
    party_type: state.party_type,
    member_names: state.member_names,
    collected_constraints: collected,
    missing_fields: missing,
    suggested_clarify_question: action.type === "ask_clarification" ? reply : null,
    suggested_quick_picks: quickPicks,
    confirm_ready: confirmReady,
    refined_target_id: state.refined_target_id,
    assistant_reply: reply,
    __v2_state: state,
    __v2_action: action,
  };
}

/**
 * Turn the scenario-specific sub-state into a flat `collected_constraints`
 * bag so v1-consuming code (like `/api/chat/commit`) can read the fields
 * through its existing lookup helpers.
 *
 * Key renames exist for scenarios where v2's cleaner naming collides with
 * v1-era canonical keys used by the commit route and planners. Keeping
 * flattenScenarioFields emission aligned with v1 keys means no downstream
 * code has to care whether NLU v1 or v2 produced the state.
 */
/** @internal — exported for unit tests. */
export function flattenScenarioFields(state: IntentState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (state.scenario === "restaurant" && state.restaurant) {
    Object.assign(out, stripUndef(state.restaurant));
  } else if (state.scenario === "hotel" && state.hotel) {
    const h = stripUndef(state.hotel) as Record<string, unknown>;
    // Rename star_rating → stars so buildRoomContext/buildCreatorConstraintSeed
    // (app/api/chat/commit/route.ts) find it via its existing alias chain.
    if ("star_rating" in h) {
      h.stars = h.star_rating;
      delete h.star_rating;
    }
    Object.assign(out, h);
  } else if (state.scenario === "flight" && state.flight) {
    const f = stripUndef(state.flight) as Record<string, unknown>;
    // Rename date → departure_date for the same reason.
    if ("date" in f) {
      f.departure_date = f.date;
      delete f.date;
    }
    Object.assign(out, f);
  } else if (state.scenario === "activity" && state.activity) {
    Object.assign(out, stripUndef(state.activity));
  } else if (state.scenario === "trip" && state.trip) {
    Object.assign(out, stripUndef(state.trip));
  }
  return out;
}

function stripUndef<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj as unknown as Record<string, unknown>)) {
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
