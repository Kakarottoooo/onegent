/**
 * NLU v2 — Layer 1 conversational model.
 *
 * Generates a natural-language assistant reply given the conversation so
 * far. Does NOT produce structured output — that's Layer 2's job.
 * Its only responsibility is to sound human: ask for missing info
 * conversationally, confirm what was understood, match the user's
 * language.
 *
 * Default model: OpenAI gpt-4o-mini (cheap, fast, good enough for chat).
 * Users can upgrade to anthropic/claude-sonnet-4-6 via AgentModelConfig —
 * wired via the `model` override param.
 */

import { openaiChat } from "../../openai";
import type { Turn } from "./extractor";
import type { RouterAction } from "./types";

export interface ChatTurnInput {
  /** Conversation history up to (but not including) the new user message. */
  history: Turn[];
  /** The user's latest message. */
  new_user_message: string;
  /**
   * Human-readable summary of current state from Layer 3's buildStateSummary().
   * E.g. "User wants NY trip, 3 nights, from SFO. Still needs: travelers."
   */
  state_summary: string;
  /**
   * The router's decision for this turn — gives the chat model enough context
   * to phrase a good reply:
   *   - continue_chat       → reply casually
   *   - ask_clarification   → ask for the specific missing fields
   *   - show_confirm_card   → summarize what's understood, hint at confirm
   */
  action: RouterAction;
  /** Model override (provider/model string, e.g. "anthropic/claude-sonnet-4-6"). */
  model?: string;
  /** Optional override API key. */
  apiKey?: string;
}

export interface ChatTurnOutput {
  reply: string;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function chatTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
  const system = buildSystemPrompt(input.state_summary, input.action);

  // Rebuild the OpenAI message list: history + new user message
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...input.history.slice(-12),
    { role: "user", content: input.new_user_message },
  ];

  const reply = await openaiChat({
    system,
    messages,
    max_tokens: 300,
    timeout_ms: 20_000,
    model: input.model,
  });

  return { reply: reply.trim() };
}

// ─── System prompt ───────────────────────────────────────────────────────
// Deliberately short (~25 lines). The "rules" for classifying, for missing
// fields, for JSON schemas — all of that lives in Layer 2. Layer 1 only
// needs to sound natural and respond to the specific action the router picked.

function buildSystemPrompt(stateSummary: string, action: RouterAction): string {
  const actionHint = buildActionHint(action);
  return `You are Onegent, a friendly travel-booking assistant. Chat with the user naturally — don't be robotic, don't produce JSON, don't explain your internals.

Reply in the user's language (English / 中文 / etc. — match whatever they wrote).

Keep replies short (1-3 sentences usually). Don't repeat info the user already gave.

Current conversation state (for YOUR context, do NOT quote verbatim):
${stateSummary}

Your task this turn:
${actionHint}
`;
}

function buildActionHint(action: RouterAction): string {
  switch (action.type) {
    case "continue_chat":
      return `- Just reply naturally to what the user said. Small-talk, acknowledge, or gently steer toward booking if relevant.`;
    case "ask_clarification":
      return `- Ask for the missing info listed below. Phrase as one friendly question covering all of them at once (don't fire 4 questions in a row).
- Missing: ${action.missing.join(", ")}
${action.suggested_quick_picks ? `- Quick-pick options will be shown to the user under your reply, so you can reference them ("pick one below" or "or let me know what works").` : ""}`;
    case "show_confirm_card":
      return `- All required info is collected. Give a one-sentence summary of what you understood, then say something like "Ready to ${action.kind === "trip" ? "package your trip" : action.kind === "room" ? "set up the room" : "run the search"}? Tap confirm below." The UI will render a confirm card under your reply.`;
  }
}
