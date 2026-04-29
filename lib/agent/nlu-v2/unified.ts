/**
 * NLU v2 — Unified turn (state + reply in one LLM call).
 *
 * Replaces the old two-call pipeline (extractor → chat) where Layer 2
 * produced an IntentState JSON and Layer 1 separately wrote the
 * assistant_reply. That split allowed cross-layer inconsistency: the
 * extractor could (rarely) emit `scenario="restaurant"` AND a stray
 * `out_of_scope:` planning_assumption tag, and the chat layer keyed off
 * the tag to decline — telling the user "Onegent only does travel" right
 * after they typed a perfectly good restaurant request.
 *
 * The fix is structural, not a prompt patch: do both jobs in ONE call so
 * the model can't disagree with itself. The same LLM that decides the
 * state also writes the reply, looking at the same evidence at the same
 * time. Output schema is `{ state: IntentState, reply: string }`.
 *
 * Router (Layer 3) still runs after as a pure function on the returned
 * state — it decides confirm-card vs. ask-clarification UI dispatch
 * deterministically, independent of how the model phrased its reply.
 *
 * Default model: gpt-4o-mini (cheap, fast). Override via the `model`
 * param to e.g. anthropic/claude-sonnet-4-6 if reply quality is rough.
 */

import { openaiChat } from "../../openai";
import {
  type Turn,
  buildExtractorSystemPrompt,
  buildExtractorUserPrompt,
  buildWeekdayLookup,
  coerceIntentState,
  downgradeSpuriousRefine,
  fillCreateRoomPartySize,
  formatHistory,
  formatPrevState,
  mergePrevIntoNew,
  scrubWholeMonthAssumption,
  upgradeMultiPartyToRoom,
} from "./extractor";
import type { IntentState } from "./types";

export interface UnifiedTurnInput {
  /** Previous IntentState — null on the first turn of a conversation. */
  prev_state: IntentState | null;
  /** The user's latest message. */
  new_user_message: string;
  /** Conversation history so far. */
  history?: Turn[];
  /** Override model (provider/model string). Default: gpt-4o-mini. */
  model?: string;
  /** Optional override API key (BYOK). */
  apiKey?: string;
}

export interface UnifiedTurnOutput {
  /** Parsed + coerced + scrubbed IntentState. */
  state: IntentState;
  /** Natural-language reply for the user (1-3 sentences typically). */
  reply: string;
}

/**
 * Single LLM call that returns both the new IntentState and the
 * assistant's reply. See module doc for the architectural rationale.
 */
export async function unifiedTurn(input: UnifiedTurnInput): Promise<UnifiedTurnOutput> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayDayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const weekdayLookup = buildWeekdayLookup(now);
  const prevSummary = input.prev_state
    ? formatPrevState(input.prev_state)
    : "(none — this is the first turn)";
  const historyBlock = formatHistory(input.history ?? []);

  const systemPrompt = buildUnifiedSystemPrompt(today, todayDayOfWeek, nowHHMM, weekdayLookup);
  const userPrompt = buildExtractorUserPrompt({
    prevSummary,
    historyBlock,
    newUser: input.new_user_message,
    newAssistant: "",
  });

  const raw = await openaiChat({
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    // Bigger budget than extract-only because we now also include a reply
    // string (1-3 sentences ≈ 60-180 tokens) on top of the IntentState JSON.
    max_tokens: 1500,
    timeout_ms: 25_000,
    model: input.model,
    response_format: { type: "json_object" },
  });

  const { stateRaw, reply } = parseUnifiedRaw(raw);

  // Same defensive coerce + scrub pipeline the old extractor ran. These are
  // post-processing safety nets independent of the LLM's reasoning quality;
  // moving to a unified call doesn't make them less useful.
  const parsedState = coerceIntentState(stateRaw, input.prev_state);
  const merged = mergePrevIntoNew(input.prev_state, parsedState);
  const scrubbed = scrubWholeMonthAssumption(
    merged,
    input.history ?? [],
    input.new_user_message,
  );
  const partyFilled = fillCreateRoomPartySize(scrubbed);
  const upgraded = upgradeMultiPartyToRoom(partyFilled);
  const finalState = downgradeSpuriousRefine(upgraded, input.history ?? []);

  return { state: finalState, reply: reply.trim() };
}

// ─── Prompt construction ─────────────────────────────────────────────────

function buildUnifiedSystemPrompt(
  today: string,
  todayDayOfWeek: string,
  nowHHMM: string,
  weekdayLookup: string,
): string {
  // Reuse the extractor's full system prompt — same calendar, same scenario
  // rules, same OOS guard, same worked examples — and append the reply
  // guidance + new combined output schema.
  const stateRules = buildExtractorSystemPrompt(today, todayDayOfWeek, nowHHMM, weekdayLookup);

  return `${stateRules}

═══════════════════════════════════════════════════════════════════════
ADDITIONAL JOB — write the user-facing reply in the SAME response.
═══════════════════════════════════════════════════════════════════════

After deciding the new state, also write a short natural-language reply
that picks up from the conversation. ONE call, BOTH outputs.

REPLY GUIDANCE:
  - Match the user's language. Chinese in → Chinese out. English in → English out.
  - Keep it short: 1-3 sentences, max ~300 chars. Don't be robotic.
  - Don't quote internal field names ("scenario", "missing", JSON, etc.).
  - Don't repeat info the user already gave.
  - Pick the right tone based on what the state looks like AFTER your update:

    1) state.scenario is SET and all required fields collected (city / date /
       time / etc. all filled per the scenario):
       → One-sentence summary of what you understood, then prompt them to
         tap Confirm. Example: "Got it — Carbone NYC tomorrow 7pm for 2.
         Tap Confirm below to run the autopilot." A confirm card will
         render under your reply automatically.

       FORBIDDEN in this case too — never claim work is DONE when the
       user has only just provided enough info to confirm. The autopilot
       has NOT run yet. Specifically do not write:
         · "已经完成" / "预定已经完成" / "已经预定" / "已经搞定"
         · "已经找到了" / "找到了，准备好了"
         · "Booked!" / "Done!" / "Reservation confirmed"
       The right phrasing is "ready to confirm" / "可以确认了" /
       "确认一下就开始预订" — i.e., something is ready, not something is
       finished.

    2) state.scenario is SET but some required fields are still missing:
       → You MUST ask for those missing fields in your reply. Phrase it
         as ONE friendly question covering all of them together (don't
         fire 3 separate questions). Quick-pick buttons will render
         under your reply for common gaps so the user can tap instead
         of type.

       FORBIDDEN in this case — empty-promise replies with no question.
       The user sees these and waits for nothing to happen. ALWAYS end
       case 2 replies with the actual question(s) covering the missing
       fields. Never write any of these (or paraphrases of them):
         · "好的，我来帮你找..." / "好的，我会帮你找..."
         · "好的，我已经找到了" / "已经找到" / "找到了"
         · "好的，已经预定完成" / "已经完成" / "预定已经完成"
         · "请稍等" / "请等等" / "稍候" / "稍等一下" / "马上就好"
         · "Got it, I'll help you find..." / "On it!" / "Hold on"
         · "Sounds good, working on it" / "One moment" / "Give me a sec"
         · "Just a sec — looking that up" (without an immediate question)
       These phrases imply work is happening when in fact NOTHING is
       running until you finish asking the missing fields. If you find
       yourself wanting to write any of these, STOP and ask the
       questions instead.

       LYING ABOUT COMPLETION is the worst variant: never claim
       something is "done" / "已经完成" / "预定好了" / "booked" while
       state.scenario still has missing required fields. The booking
       hasn't happened. The user will catch the lie and lose trust.

       Required fields per scenario (these are what triggers case 2):
         restaurant : city, date, time, party_size
         hotel      : city, check_in, check_out (or nights)
         flight     : origin, dest, departure_date
         activity   : event_name, city, event_date
         trip       : destination_city, date_range, departure_city, traveler_count

       Examples (good):
         missing=[time, party_size]      → "今晚几点？几个人？" / "What time and how many?"
         missing=[city]                  → "Which city are you thinking?"
         missing=[origin, departure_date] → "From where, and what day?"
         missing=[time]                   → "今晚几点？(下面有时间选项)"

    3) state.scenario is NULL and intent="chitchat" with NO out_of_scope tag:
       → Reply naturally to whatever they said (greeting / small talk /
         casual question). You can gently steer toward booking if relevant.

    4) state.scenario is NULL AND planning_assumptions contains an entry
       starting with "out_of_scope:" — meaning the message is a NON-TRAVEL
       topic per the rules above:
       → Politely decline. State that Onegent focuses on travel
         (restaurants, hotels, flights, activities, trip planning) and
         suggest ChatGPT or Claude for other topics. Warm but clear,
         1-2 sentences.

  IMPORTANT — internal consistency: if state.scenario is non-null, you
  MUST NOT decline as out-of-scope. The two are mutually exclusive. The
  scenario itself proves the message is in scope. Only follow case 4
  when scenario is null.

═══════════════════════════════════════════════════════════════════════
OUTPUT FORMAT — single JSON object with EXACTLY two top-level keys.
═══════════════════════════════════════════════════════════════════════

{
  "state": <full IntentState object per the schema above>,
  "reply": <string — your user-facing reply>
}

Do NOT wrap in markdown fences. Do NOT add other top-level keys.
"state" must contain the IntentState fields directly (intent, scenario,
party_type, etc.) — it is the IntentState object, not a nested wrapper.
`;
}

// ─── Output parsing ──────────────────────────────────────────────────────

interface UnifiedRaw {
  stateRaw: Record<string, unknown>;
  reply: string;
}

function parseUnifiedRaw(raw: string): UnifiedRaw {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "[nlu-v2 unified] JSON parse failed. raw:",
      raw.slice(0, 200),
    );
    throw new Error(`Unified returned non-JSON: ${(err as Error).message}`);
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("Unified returned non-object");
  }
  const root = obj as Record<string, unknown>;

  // Tolerate the model occasionally flattening { state, reply } back into
  // a single state-shaped object with reply as a sibling field. If we see
  // a recognizable IntentState key at the root (intent / scenario), treat
  // the whole root as state and pull reply from the same level.
  let stateRaw: Record<string, unknown>;
  let reply: string;

  if (root.state && typeof root.state === "object") {
    stateRaw = root.state as Record<string, unknown>;
    reply = typeof root.reply === "string" ? root.reply : "";
  } else if ("intent" in root || "scenario" in root) {
    // Fallback: model flattened it. Strip the reply field out of the
    // state copy so the IntentState stays clean.
    const { reply: maybeReply, ...rest } = root;
    stateRaw = rest as Record<string, unknown>;
    reply = typeof maybeReply === "string" ? maybeReply : "";
  } else {
    throw new Error("Unified output missing 'state' field");
  }

  return { stateRaw, reply };
}
