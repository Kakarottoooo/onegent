/**
 * loop.ts — Main AI booking loop.
 *
 * Orchestrates the perception → reasoning → execution cycle:
 *   1. Take screenshot + read DOM
 *   2. Call LLM (Claude Haiku) → structured NextAction
 *   3. Execute action with Playwright / Stagehand
 *   4. Repeat until "done" or maxSteps reached
 *
 * This is intentionally site-agnostic. No Booking.com selectors,
 * no keyword lists — the LLM handles all page understanding.
 */

import type { Page } from "playwright";
import type { BookingProfile } from "../types";
import type { AILoopResult, LoopStepRecord } from "./types";
import { perceiveAndDecide } from "./perceive";
import { executeAction } from "./execute";

const DEFAULT_MAX_STEPS = 25;
/** Delay between steps — gives the page time to react before next screenshot */
const STEP_DELAY_MS = 700;
/** Extra wait after navigation-triggering actions (clicks that load new pages) */
const NAV_DELAY_MS = 1500;

/** Actions that likely trigger page navigation — give more time after these */
const NAV_ACTIONS = new Set(["act"]);

export interface AILoopOptions {
  maxSteps?: number;
  /** Optional callback to receive live trace messages (same as executor trace) */
  trace?: (msg: string) => void;
}

export async function runAIBookingLoop(
  page: Page,
  task: string,
  profile: BookingProfile,
  opts: AILoopOptions = {},
): Promise<AILoopResult> {
  const { maxSteps = DEFAULT_MAX_STEPS, trace = () => {} } = opts;
  const steps: LoopStepRecord[] = [];
  /** Short summaries of recent steps — fed back to LLM to prevent repetition */
  const recentSteps: string[] = [];

  const profileHint = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
    country: profile.country,
  };

  trace(`[ai-loop] starting — task: "${task.slice(0, 80)}" maxSteps=${maxSteps}`);

  for (let i = 0; i < maxSteps; i++) {
    const stepStart = Date.now();
    const url = page.url();
    trace(`[ai-loop] ── step ${i + 1}/${maxSteps} ── ${url.slice(0, 80)}`);

    // ── 1. Perceive ──────────────────────────────────────────────────────────
    let perception;
    try {
      perception = await perceiveAndDecide(page, { task, profileHint, recentSteps });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trace(`[ai-loop] perceive error: ${errMsg.slice(0, 160)}`);

      // Non-recoverable billing/quota errors — stop immediately
      const fatal = /credit balance|insufficient_quota|payment required|billing|quota exceeded/i.test(errMsg);
      if (fatal) {
        trace("[ai-loop] fatal billing/quota error — aborting loop");
        return { outcome: "failed", finalUrl: url, steps, summary: `API billing error: ${errMsg.slice(0, 120)}` };
      }

      steps.push({
        stepIndex: i,
        url,
        stage: "unknown",
        action: { type: "scroll_down", reasoning: "perceive error", confidence: 0 },
        durationMs: Date.now() - stepStart,
      });
      await sleep(STEP_DELAY_MS);
      continue;
    }

    const { stage, pageDescription, nextAction } = perception;
    trace(
      `[ai-loop] stage=${stage} | action=${nextAction.type} | conf=${nextAction.confidence.toFixed(2)} | ${nextAction.reasoning.slice(0, 100)}`
    );

    const record: LoopStepRecord = {
      stepIndex: i,
      url,
      stage,
      action: nextAction,
      durationMs: 0,
    };

    // ── 2. Check terminal condition ──────────────────────────────────────────
    if (nextAction.type === "done") {
      record.durationMs = Date.now() - stepStart;
      steps.push(record);
      const outcome = nextAction.outcome ?? "completed";
      trace(`[ai-loop] done — outcome=${outcome} | "${pageDescription}"`);
      return { outcome, finalUrl: url, steps, summary: pageDescription };
    }

    // ── 3. Execute ───────────────────────────────────────────────────────────
    try {
      await executeAction(page, nextAction, trace);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace(`[ai-loop] execute error (step ${i + 1}): ${msg.slice(0, 120)} — continuing`);
    }

    record.durationMs = Date.now() - stepStart;
    steps.push(record);

    // Feed short summary of this step back to LLM for next iteration
    recentSteps.push(
      `step${i + 1}[${nextAction.type}]: ${nextAction.reasoning.slice(0, 70)}`
    );

    // Extra delay after likely-navigation actions
    const delay = NAV_ACTIONS.has(nextAction.type) ? NAV_DELAY_MS : STEP_DELAY_MS;
    await sleep(delay);
  }

  trace(`[ai-loop] reached max steps (${maxSteps}) without completing`);
  return {
    outcome: "failed",
    finalUrl: page.url(),
    steps,
    summary: `Reached max steps (${maxSteps}) without completing the booking`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
