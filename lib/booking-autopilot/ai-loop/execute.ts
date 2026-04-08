/**
 * execute.ts — Execution layer of the AI loop.
 *
 * Receives a NextAction from the LLM and executes it using Playwright.
 * This module knows NOTHING about booking logic — it only translates
 * typed action structs into browser operations.
 *
 * "act" actions delegate element-finding to Stagehand's page.act(),
 * which uses AI vision internally to locate and interact with elements.
 */

import type { Page } from "playwright";
import type { NextAction } from "./types";

/** Stagehand augments Page with .act() — cast to access it. */
type StagehandPage = Page & {
  act: (instruction: string) => Promise<void>;
};

/**
 * Execute a single AI-decided action on the page.
 * Returns true if the action was executed, false if it was skipped.
 */
export async function executeAction(
  page: Page,
  action: NextAction,
  trace: (msg: string) => void,
): Promise<boolean> {
  const sp = page as StagehandPage;

  switch (action.type) {
    case "act": {
      if (!action.instruction) {
        trace("[execute] act: missing instruction, skipping");
        return false;
      }
      trace(`[execute] act: "${action.instruction}"`);
      await sp.act(action.instruction);
      return true;
    }

    case "fill_form": {
      if (!action.fields || Object.keys(action.fields).length === 0) {
        trace("[execute] fill_form: no fields provided, skipping");
        return false;
      }
      for (const [fieldLabel, value] of Object.entries(action.fields)) {
        if (!value) continue;
        const displayValue = value.replace(/\d(?=\d{4})/g, "*"); // mask card-like numbers in logs
        trace(`[execute] fill_form: "${fieldLabel}" = "${displayValue}"`);
        await sp.act(`Fill the ${fieldLabel} field with "${value}"`);
        // Small delay between fields — avoids focus/blur race conditions
        await sleep(350);
      }
      return true;
    }

    case "scroll_down": {
      trace("[execute] scroll_down");
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.75)));
      await sleep(600);
      return true;
    }

    case "scroll_up": {
      trace("[execute] scroll_up");
      await page.evaluate(() => window.scrollBy(0, -Math.round(window.innerHeight * 0.75)));
      await sleep(400);
      return true;
    }

    case "wait": {
      trace("[execute] wait: waiting for networkidle");
      await page
        .waitForLoadState("networkidle", { timeout: 6000 })
        .catch(() => trace("[execute] wait: networkidle timeout, continuing"));
      return true;
    }

    case "done": {
      // Terminal action — the loop handles this, nothing to execute
      trace(`[execute] done: outcome=${action.outcome ?? "completed"}`);
      return true;
    }

    default: {
      trace(`[execute] unknown action type: ${(action as NextAction).type}`);
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
