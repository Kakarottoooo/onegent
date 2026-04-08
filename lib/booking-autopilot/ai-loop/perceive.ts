/**
 * perceive.ts — Perception layer of the AI loop.
 *
 * Takes a screenshot + simplified DOM, calls Claude Haiku with a structured
 * prompt, and returns a typed PerceptionResult with the next action to take.
 *
 * Design principles:
 * - One LLM call per step (~1s, ~$0.001)
 * - Screenshot is JPEG 60% quality (~40–80 KB)
 * - DOM is reduced to max 60 interactive elements (not raw HTML)
 * - Output is always valid JSON matching NextAction
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { PerceptionResult } from "./types";

// Lazily instantiated so ANTHROPIC_API_KEY is read at call time, not at import time.
// This matters when .env.local is loaded after module imports (e.g. in test scripts).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const SYSTEM_PROMPT = `You are a browser automation agent deciding the single next action to complete an online booking.
You receive a screenshot and a list of interactive elements, and return ONE structured JSON action.

RULES:
- Return ONLY valid JSON — no markdown, no code fences, no explanation
- ONE action per response
- STOP (type "done", outcome "paused_payment") when you see: CVV/CVC field, "Pay Now", "Confirm Payment", "Complete Booking", "Complete Purchase", "立即付款", "确认支付"
- STOP (type "done", outcome "no_availability") when the page clearly shows no rooms or no availability
- STOP (type "done", outcome "captcha") when blocked by CAPTCHA or "verify you are human"
- Never repeat an action that appears in recentSteps
- On a hotel detail page, scroll down first to find the room list before trying to click anything
- Always prefer the cheapest available option unless the task specifies otherwise`;

/**
 * Extracts interactive element text from the page DOM.
 * Kept short (max 60 elements) to fit within token budget.
 */
async function getInteractiveElements(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const els = document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="option"], h1, h2, h3, label'
      );
      return Array.from(els)
        .map(el => {
          const text = (el.textContent || (el as HTMLInputElement).placeholder || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80);
          const tag = el.tagName.toLowerCase();
          const inputType = (el as HTMLInputElement).type || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          const label = ariaLabel ? `[${ariaLabel}]` : "";
          return text ? `[${tag}${inputType ? `:${inputType}` : ""}]${label} ${text}` : null;
        })
        .filter(Boolean)
        .slice(0, 60)
        .join("\n");
    });
  } catch {
    return "(could not read DOM)";
  }
}

export interface PerceiveOptions {
  /** Natural language goal for the overall booking */
  task: string;
  /** Key profile fields used when LLM decides to fill_form */
  profileHint: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    country?: string;
  };
  /** Last 3 step reasonings — prevents the LLM from repeating itself */
  recentSteps: string[];
}

export async function perceiveAndDecide(
  page: Page,
  opts: PerceiveOptions,
): Promise<PerceptionResult> {
  const [screenshotBuf, interactiveElements] = await Promise.all([
    page.screenshot({ type: "jpeg", quality: 60 }),
    getInteractiveElements(page),
  ]);

  const currentUrl = page.url();

  const userPrompt = `Task: ${opts.task}
URL: ${currentUrl}
Recent steps (do NOT repeat): ${opts.recentSteps.slice(-3).join(" → ") || "none"}

Interactive elements on page:
${interactiveElements}

User profile (use when filling forms):
  first_name: ${opts.profileHint.first_name}
  last_name: ${opts.profileHint.last_name}
  email: ${opts.profileHint.email}
  phone: ${opts.profileHint.phone}
  country: ${opts.profileHint.country ?? ""}

Return this JSON (no markdown):
{
  "stage": "<listing|hotel_detail|room_selection|guest_form|payment_form|paused_payment|confirmation|no_availability|captcha|unknown>",
  "pageDescription": "<one sentence describing what you see>",
  "nextAction": {
    "type": "<act|fill_form|scroll_down|scroll_up|wait|done>",
    "instruction": "<for 'act': natural language, e.g. 'click the cheapest available room'>",
    "fields": {"<field label>": "<value>"},
    "outcome": "<for 'done' only: paused_payment|completed|no_availability|captcha>",
    "reasoning": "<why this action>",
    "confidence": 0.9
  }
}`;

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: screenshotBuf.toString("base64"),
          },
        },
        { type: "text", text: userPrompt },
      ],
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";

  try {
    // Strip markdown fences if LLM added them despite instructions
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return JSON.parse(cleaned) as PerceptionResult;
  } catch {
    // Graceful fallback: scroll down and try again next step
    return {
      stage: "unknown",
      pageDescription: "LLM response parse error",
      nextAction: {
        type: "scroll_down",
        reasoning: `Failed to parse LLM response: ${raw.slice(0, 120)}`,
        confidence: 0.1,
      },
    };
  }
}
