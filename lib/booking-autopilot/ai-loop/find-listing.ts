/**
 * find-listing.ts — Phase 4: AI-driven listing selection and room picking.
 *
 * Two functions:
 * - clickTargetListingAI: finds and clicks the target hotel in search results
 * - selectCheapestRoomAI: selects the cheapest available room on a hotel detail page
 *
 * Both use stagehand.act() so they work on any booking website.
 * No hardcoded selectors, no site-specific DOM knowledge.
 */

import { perceiveAndDecide } from "./perceive";

/** Minimal interface: only .act() + activePage() needed. */
type Actable = {
  act: (instruction: string) => Promise<unknown>;
  context: {
    activePage: () => { url: () => string; screenshot: (opts?: object) => Promise<Buffer>; evaluate: <T>(fn: () => T) => Promise<T> } | undefined;
  };
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

  // Fast path: try direct act() first
  try {
    await stagehand.act(
      `Find and click the hotel listing named "${targetHotelName}" in the search results. ` +
      `Click on its name or "See availability" button to open the hotel detail page.`
    );
    trace(`[find-listing] direct act() succeeded for "${targetHotelName}"`);
    return "clicked";
  } catch (err) {
    trace(`[find-listing] direct act() failed: ${(err as Error).message?.slice(0, 80)}`);
  }

  // Fallback: scroll + AI perception loop
  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    const page = stagehand.context.activePage();
    if (!page) break;

    const perception = await perceiveAndDecide(page, {
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
 * Select the cheapest available room on a hotel detail page.
 *
 * Strategy:
 * 1. Scroll to room list
 * 2. AI perception to find the cheapest room action
 * 3. stagehand.act() to select it and click Reserve/Book
 */
export async function selectCheapestRoomAI(
  stagehand: Actable,
  trace: (msg: string) => void,
): Promise<RoomResult> {
  trace(`[find-listing] selecting cheapest room`);

  const page = stagehand.context.activePage();
  if (!page) return "no_availability";

  // Scroll to reveal the room list
  try {
    await stagehand.act("scroll down to find the available rooms or room prices section");
    await sleep(800);
  } catch {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8)).catch(() => {});
    await sleep(600);
  }

  // AI perception to decide room selection action
  const perception = await perceiveAndDecide(page, {
    task: "Select the cheapest available room. Set quantity to 1 if needed, then click Reserve or Book.",
    profileHint: { first_name: "", last_name: "", email: "", phone: "" },
    recentSteps: [],
  }).catch(() => null);

  if (!perception) {
    trace(`[find-listing] perception failed, trying generic act`);
    // Generic fallback
    try {
      await stagehand.act(
        "Select 1 room in the cheapest available room option and click the Reserve or Book button"
      );
      return "selected";
    } catch {
      return "no_availability";
    }
  }

  if (perception.stage === "no_availability") {
    trace(`[find-listing] AI says no_availability on room page`);
    return "no_availability";
  }

  if (perception.nextAction.type === "act" && perception.nextAction.instruction) {
    try {
      await stagehand.act(perception.nextAction.instruction);
      trace(`[find-listing] room selected: "${perception.nextAction.instruction.slice(0, 60)}"`);
      return "selected";
    } catch (err) {
      trace(`[find-listing] room act failed: ${(err as Error).message?.slice(0, 60)}`);
    }
  }

  // Last resort: generic instruction
  try {
    await stagehand.act(
      "Click the Reserve or Book button for the cheapest available room"
    );
    return "selected";
  } catch {
    return "no_availability";
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}
