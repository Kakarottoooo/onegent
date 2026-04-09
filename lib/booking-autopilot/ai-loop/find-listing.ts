/**
 * find-listing.ts — Phase 4: AI-driven listing selection and room picking.
 *
 * Two functions:
 * - clickTargetListingAI: finds and clicks the target hotel in search results
 * - selectRoomAI: selects a room on a hotel detail page (by preference or cheapest)
 *
 * Both use stagehand.act() so they work on any booking website.
 * No hardcoded selectors, no site-specific DOM knowledge.
 */

import { perceiveAndDecide } from "./perceive";

/** Evaluate signature that matches Playwright's Page.evaluate() overloads. */
type EvalFn = {
  <T>(fn: () => T): Promise<T>;
  <T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
};

/** Minimal interface: only .act() + activePage() needed. */
type Actable = {
  act: (instruction: string) => Promise<unknown>;
  context: {
    activePage: () => { url: () => string; screenshot: (opts?: object) => Promise<Buffer>; evaluate: EvalFn } | undefined;
    pages: () => unknown[];
  } | null;
};

type ClickResult = "clicked" | "not_found" | "no_availability";
type RoomResult  = "selected" | "no_availability";

/**
 * Find and click a hotel by name in a search results listing page.
 *
 * Strategy:
 * 1. Try stagehand.act() with the hotel name directly (fast path)
 * 2. If that fails, scroll down and use AI perception to check if hotel is visible
 * 3. Repeat up to maxScrolls times
 */
export async function clickTargetListingAI(
  stagehand: Actable,
  targetHotelName: string,
  trace: (msg: string) => void,
  maxScrolls = 5,
): Promise<ClickResult> {
  trace(`[find-listing] looking for "${targetHotelName}" in search results`);

  // Fast path: try direct act() first.
  // IMPORTANT: click the hotel NAME/TITLE link, not the "See availability" button.
  // "See availability" only expands an inline accordion on the search page — it does NOT
  // open the hotel detail page. The hotel name link opens the hotel page in a new tab.
  try {
    await stagehand.act(
      `In the hotel search results list (NOT the search bar at the top), ` +
      `find the listing for "${targetHotelName}" and click the hotel NAME or TITLE text ` +
      `(the large clickable hotel name, NOT the "See availability" button) ` +
      `to navigate to the hotel detail page.`
    );
    trace(`[find-listing] direct act() succeeded for "${targetHotelName}"`);
    return "clicked";
  } catch (err) {
    trace(`[find-listing] direct act() failed: ${(err as Error).message?.slice(0, 80)}`);
  }

  // Fallback: scroll + AI perception loop
  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    const page = stagehand.context?.activePage();
    if (!page) break;

    const perception = await perceiveAndDecide(page as Parameters<typeof perceiveAndDecide>[0], {
      task: `Find and click the hotel named "${targetHotelName}" in the search results`,
      profileHint: { first_name: "", last_name: "", email: "", phone: "" },
      recentSteps: scroll > 0 ? [`scroll_down (x${scroll})`] : [],
    }).catch(() => null);

    if (!perception) break;

    if (perception.stage === "no_availability") {
      trace(`[find-listing] AI says no_availability`);
      return "no_availability";
    }

    if (perception.nextAction.type === "act" && perception.nextAction.confidence >= 0.65) {
      try {
        await stagehand.act(perception.nextAction.instruction!);
        trace(`[find-listing] AI perception click: "${perception.nextAction.instruction?.slice(0, 60)}"`);
        return "clicked";
      } catch (err) {
        trace(`[find-listing] AI perception click failed: ${(err as Error).message?.slice(0, 60)}`);
      }
    }

    // Scroll down to reveal more results
    trace(`[find-listing] scroll ${scroll + 1}/${maxScrolls} — hotel not visible yet`);
    await stagehand.act("scroll down to see more hotel results").catch(() =>
      page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
    );
    await sleep(600);
  }

  trace(`[find-listing] hotel "${targetHotelName}" not found after ${maxScrolls} scrolls`);
  return "not_found";
}

/**
 * Select a room on a hotel detail page.
 *
 * When `roomPreference` is provided (e.g. "king suite", "double queen", "twin"),
 * the function tries to find the matching room type first.
 * Falls back to cheapest if no match is found.
 *
 * Strategy:
 * 1. Scroll to room list
 * 2. If preference given: try stagehand.act() with preference instruction (fast path)
 * 3. JS evaluate: find the quantity <select> in the row matching the preference
 *    (or cheapest row if no preference / no match), set it to "1"
 * 4. stagehand.act() to click "I'll reserve" (simple click — no dropdown)
 * 5. JS click fallback if act() fails
 */
export async function selectRoomAI(
  stagehand: Actable,
  trace: (msg: string) => void,
  roomPreference?: string,
): Promise<RoomResult> {
  const prefLabel = roomPreference ? `"${roomPreference}"` : "cheapest";
  trace(`[find-listing] selecting room (preference: ${prefLabel})`);

  const ctx = stagehand.context;
  if (!ctx) return "no_availability";
  const page = ctx.activePage();
  if (!page) return "no_availability";

  // Scroll to reveal the room list
  try {
    await stagehand.act("scroll down past the hotel photos to find the room list or availability table");
    await sleep(800);
  } catch {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8)).catch(() => {});
    await sleep(600);
  }

  // Step 1: When a preference is given, try stagehand.act() first.
  // Works well on sites where room names are clear text labels.
  if (roomPreference) {
    try {
      await stagehand.act(
        `In the room availability table, find the room type that best matches "${roomPreference}". ` +
        `Set its quantity selector to 1 (select "1" from the dropdown next to that room). ` +
        `If "${roomPreference}" is not available, select the cheapest available room instead. ` +
        `Do NOT click "I'll reserve" yet — only set the quantity.`
      );
      trace(`[find-listing] act() set quantity for room preference "${roomPreference}"`);
      await sleep(600);
    } catch (err) {
      trace(`[find-listing] act() preference select failed: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  // Step 2: JS evaluate to set the correct <select> to "1".
  // This handles React dropdowns where stagehand.act() may emit the wrong schema
  // (gpt-4o-mini omits the required `twoStep` field for selectOptionFromDropdown).
  // When preference is given: find the select whose container row text contains the preference.
  // Fall back to cheapest if no matching row is found or no preference specified.
  const quantitySet = await page.evaluate((pref: string | null) => {
    // Collect all quantity-style selects (options include "0" and "1")
    const allSelects = Array.from(
      document.querySelectorAll<HTMLSelectElement>("select")
    ).filter(sel => {
      const vals = Array.from(sel.options).map(o => o.value);
      return vals.includes("0") && vals.includes("1");
    });

    if (allSelects.length === 0) return false;

    let target: HTMLSelectElement | undefined;

    if (pref) {
      const prefWords = pref.toLowerCase().split(/\s+/).filter(Boolean);
      // Find a select whose nearest row/section contains all preference words
      target = allSelects.find(sel => {
        const row = sel.closest("tr, [class*='room'], [class*='rate'], [data-testid*='room'], section");
        const text = (row?.textContent ?? "").toLowerCase().replace(/\s+/g, " ");
        return prefWords.every(word => text.includes(word));
      });
    }

    if (!target) {
      // No preference or no match — pick cheapest: select with lowest price in row
      const withPrices = allSelects
        .filter(sel => sel.value === "0")
        .map(sel => {
          const row = sel.closest("tr, [class*='room'], [class*='rate'], div");
          const match = (row?.textContent ?? "").match(/[\$¥€£]([\d,]+)/);
          const price = match ? parseFloat(match[1].replace(",", "")) : Infinity;
          return { sel, price };
        })
        .sort((a, b) => a.price - b.price);

      target = withPrices[0]?.sel;
    }

    if (!target) return false;

    const opt1 = Array.from(target.options).find(o => o.value === "1");
    if (!opt1) return false;

    // Use native setter so React sees the change
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    nativeSetter?.call(target, "1");
    target.value = "1"; // belt and braces
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.dispatchEvent(new Event("input",  { bubbles: true }));
    return true;
  }, roomPreference ?? null).catch(() => false);

  if (quantitySet) {
    trace(`[find-listing] quantity set to 1 via JS (preference: ${prefLabel})`);
    await sleep(600);
  } else {
    trace("[find-listing] quantity select not found or already set — proceeding to reserve click");
  }

  // Step 3: Click "I'll reserve" via stagehand.act() — simple click only, no dropdowns.
  try {
    await stagehand.act(
      `Click the button labelled "I'll reserve" to proceed to checkout. ` +
      `Do not interact with any dropdown — only click the reserve button.`
    );
    trace("[find-listing] clicked I'll reserve via act()");
    return "selected";
  } catch (actErr) {
    trace(`[find-listing] act() reserve failed: ${(actErr as Error).message?.slice(0, 80)}`);
  }

  // Step 4: JS click fallback
  const clicked = await page.evaluate(() => {
    function isVisible(el: Element): boolean {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
    }
    const pattern = /i.?ll reserve|reserve|book now/i;
    const btn = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
      .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (clicked) {
    trace("[find-listing] JS fallback click on reserve button worked");
    return "selected";
  }

  trace("[find-listing] could not click reserve — no_availability");
  return "no_availability";
}

/**
 * @deprecated Use selectRoomAI instead.
 */
export const selectCheapestRoomAI = (
  stagehand: Actable,
  trace: (msg: string) => void,
): Promise<RoomResult> => selectRoomAI(stagehand, trace);

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}
