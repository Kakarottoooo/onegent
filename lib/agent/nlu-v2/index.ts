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
  ProxyConstraints,
  RestaurantFields,
  HotelFields,
  FlightFields,
  ActivityFields,
} from "./types";

// ─── v1 compatibility aliases ─────────────────────────────────────────────
// The v1 module (lib/conversational-nlu.ts) was retired in Phase C cleanup.
// Its exported type names live on here as aliases so existing callers
// (page.tsx, ConfirmCard, commit/parse routes) can
// migrate their imports with a one-line path change.

/** @deprecated Use NluV2ParseResult. Kept as an alias for the v1 → v2 migration. */
export type ConversationalNLUResult = import("./types").NluV2ParseResult;
/** @deprecated Use NluIntent. */
export type ConversationalIntent = import("./types").NluIntent;
/** @deprecated Use NluScenario. */
export type ConversationalScenario = import("./types").NluScenario;

/**
 * Crash-fallback NLU result the /api/chat/parse route can return when the
 * v2 pipeline throws. Kept in the v2 barrel so the v1 file can be deleted.
 *
 * Shape mirrors v1's buildFallbackResult: intent=chitchat, scenario=null,
 * confirm_ready=false — the UI renders the assistant_reply as a regular
 * chat bubble and waits for the user to rephrase.
 */
export function buildFallbackResult(message: string): import("./types").NluV2ParseResult {
  return {
    intent: "chitchat",
    scenario: null,
    party_type: "solo",
    member_names: [],
    collected_constraints: {},
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: false,
    refined_target_id: null,
    assistant_reply:
      message.trim().length === 0
        ? null
        : "Sorry, I didn't catch that — could you rephrase?",
  };
}

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
// frontend (homepage chat + ConfirmCard) render v2 responses without
// any component changes.

function toV1CompatShape(
  state: IntentState,
  action: RouterAction,
  reply: string,
): NluV2ParseResult {
  const collected = flattenScenarioFields(state);
  // Proxy member constraints are top-level on IntentState but flat on v1's
  // collected_constraints — write them back under the v1 key so /api/chat/commit's
  // sanitizeProxyMemberConstraints picks them up unchanged.
  if (state.proxy_member_constraints && Object.keys(state.proxy_member_constraints).length > 0) {
    collected.proxy_member_constraints = state.proxy_member_constraints;
  }
  const missing = action.type === "ask_clarification" ? action.missing : [];
  const quickPicks = action.type === "ask_clarification" ? action.suggested_quick_picks ?? null : null;
  const confirmReady = action.type === "show_confirm_card";

  // Stage 2 (2026-04): multi-party trip rooms are now supported. The former
  // Stage 1 guardrail that forced `trip + create_room → create_plan` is
  // removed — the commit route's scenario==="trip" branch handles both
  // solo (create_plan) and multi (create_room + flow="chat") now.
  const effectiveIntent = state.intent;

  const directBooking =
    action.type === "show_confirm_card" && action.directBooking === true;

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
    ...(directBooking ? { direct_booking: true } : {}),
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
