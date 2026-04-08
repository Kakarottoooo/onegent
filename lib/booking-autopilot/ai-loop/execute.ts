/**
 * execute.ts — Execution layer of the AI loop.
 *
 * Receives a NextAction from the LLM and executes it using Playwright/Stagehand.
 * This module knows NOTHING about booking logic — it only translates
 * typed action structs into browser operations.
 *
 * "act" actions delegate to the Stagehand V3 instance's .act() method.
 * scroll/wait/evaluate use the raw Playwright page from stagehand.context.activePage().
 */

import type { Page } from "playwright";
import type { NextAction } from "./types";

/**
 * StagehandLike: the V3 Stagehand instance interface needed for act/fill_form.
 * We keep it minimal to avoid importing the full Stagehand package here.
 */
export type StagehandLike = {
  act: (instruction: string) => Promise<unknown>;
  context: {
    activePage: () => {
      url: () => string;
      evaluate: Page["evaluate"];
      waitForLoadState: Page["waitForLoadState"];
    } | undefined;
  };
};

/**
 * Execute a single AI-decided action.
 * - act/fill_form: uses stagehand.act() (AI-driven element interaction)
 * - scroll/wait: uses the raw page from stagehand.context.activePage()
 * Returns true if the action was executed, false if skipped.
 */
export async function executeAction(
  stagehand: StagehandLike,
  action: NextAction,
  trace: (msg: string) => void,
): Promise<boolean> {
  const getPage = () => stagehand.context.activePage();

  switch (action.type) {
    case "act": {
      if (!action.instruction) {
        trace("[execute] act: missing instruction, skipping");
        return false;
      }
      trace(`[execute] act: "${action.instruction}"`);
      await stagehand.act(action.instruction);
      return true;
    }

    case "fill_form": {
      if (!action.fields || Object.keys(action.fields).length === 0) {
        trace("[execute] fill_form: no fields provided, skipping");
        return false;
      }
      for (const [fieldLabel, value] of Object.entries(action.fields)) {
        if (!value) continue;
        const displayValue = value.replace(/\d(?=\d{4})/g, "*"); // mask card numbers in logs
        trace(`[execute] fill_form: "${fieldLabel}" = "${displayValue}"`);
        await stagehand.act(`Fill the ${fieldLabel} field with "${value}"`);
        await sleep(350);
      }
      return true;
    }

    case "scroll_down": {
      trace("[execute] scroll_down");
      const p = getPage();
      if (p) await p.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.75)));
      await sleep(600);
      return true;
    }

    case "scroll_up": {
      trace("[execute] scroll_up");
      const p = getPage();
      if (p) await p.evaluate(() => window.scrollBy(0, -Math.round(window.innerHeight * 0.75)));
      await sleep(400);
      return true;
    }

    case "wait": {
      trace("[execute] wait: waiting for networkidle");
      const p = getPage();
      if (p) {
        await p
          .waitForLoadState("networkidle", { timeout: 6000 })
          .catch(() => trace("[execute] wait: networkidle timeout, continuing"));
      }
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
