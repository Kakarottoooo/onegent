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

type RequestedDates = { checkin?: string; checkout?: string };

/** Minimal interface: only .act() + activePage() needed. */
type Actable = {
  act: (instruction: string) => Promise<unknown>;
  context: {
    activePage: () => { url: () => string; screenshot: (opts?: object) => Promise<Buffer>; evaluate: EvalFn; goto: (url: string, opts?: object) => Promise<unknown> } | undefined;
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
  startDomain?: string,         // e.g. "expedia.com" — used to detect wrong-domain clicks
  requestedDates?: RequestedDates, // checkin/checkout to append to hotel URL (avoids no-availability false positive)
): Promise<ClickResult> {
  trace(`[find-listing] looking for "${targetHotelName}" in search results`);

  const page = stagehand.context?.activePage();

  // Fast path 0: DOM link extraction — find the hotel's href directly in the search results
  // and navigate via goto(). This is the most reliable approach for OTA sites (Expedia/Hotels.com)
  // because stagehand.act() can accidentally click brand logos or Google Maps links that
  // redirect to a third-party brand site (e.g. IHG.com) instead of the OTA hotel detail page.
  if (page && startDomain) {
    const directHref = await page.evaluate(
      ({ hotelName, domain }: { hotelName: string; domain: string }) => {
        // Include purely-numeric words (e.g. "414" in "414 Hotel") regardless of length —
        // hotel numbers are the most distinctive part of a name and must not be dropped.
        const nameWords = hotelName.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 || /^\d+$/.test(w));
        // Find all <a> tags that link within the same OTA domain.
        // Check the URL *hostname* so that survey redirect URLs like
        // "directword.io/survey/domain=www.hotels.com/..." are excluded even though
        // they contain the domain string in their path/query parameters.
        const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter(a => {
            if (a.href.startsWith("/")) return true; // relative URL — always within current domain
            try {
              const url = new URL(a.href);
              return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
            } catch {
              return false;
            }
          });
        // Score each candidate by how many hotel name words appear in its text or href
        const scored = candidates.map(a => {
          const text = (a.textContent ?? "").toLowerCase().replace(/\s+/g, " ").trim();
          const href = (a.href ?? "").toLowerCase();
          const score = nameWords.filter((w: string) => text.includes(w) || href.includes(w)).length;
          return { href: a.href, text, score };
        });
        const best = scored.sort((x, y) => y.score - x.score)[0];
        // Require at least half the name words to match
        if (best && best.score >= Math.ceil(nameWords.length * 0.5)) {
          return best.href;
        }
        return null;
      },
      { hotelName: targetHotelName, domain: startDomain }
    ).catch(() => null);

    // Reject search/listing page links — only hotel detail pages are valid targets.
    // Hotels.com search URLs contain "Hotel-Search", "regionId=", "destination=" in the path/query.
    // Expedia search URLs contain "/Hotel-Search" or similar patterns.
    // These look like valid matches (e.g. "Times Square" in the URL matches name words)
    // but navigating to them leads to another search results page, not a hotel detail page.
    const isSearchUrl = directHref && (() => {
      try {
        const u = new URL(directHref);
        const pathAndQuery = (u.pathname + u.search).toLowerCase();
        return pathAndQuery.includes("hotel-search") ||
               pathAndQuery.includes("regionid=") ||
               pathAndQuery.includes("destination=") ||
               pathAndQuery.includes("/search?") ||
               pathAndQuery.includes("/hotels?");
      } catch { return false; }
    })();
    if (isSearchUrl) {
      trace(`[find-listing] DOM link looks like a search URL — skipping: ${directHref!.slice(0, 80)}`);
    }
    if (directHref && !isSearchUrl) {
      trace(`[find-listing] DOM link found for "${targetHotelName}": ${directHref.slice(0, 80)}`);
      try {
        // Append check-in/out dates to the hotel URL so Expedia loads real availability.
        // Without dates the page shows a placeholder that triggers a false-positive no-availability.
        let hotelUrlWithDates = directHref;
        const chkin  = requestedDates?.checkin;
        const chkout = requestedDates?.checkout;
        if (chkin && chkout && !directHref.includes("chkin=")) {
          try {
            const hotelUrl = new URL(directHref);
            hotelUrl.searchParams.set("chkin", chkin);
            hotelUrl.searchParams.set("chkout", chkout);
            hotelUrlWithDates = hotelUrl.toString();
            trace(`[find-listing] appended dates: chkin=${chkin} chkout=${chkout}`);
          } catch {
            // URL construction failed — use bare href
          }
        }
        await (page as unknown as { goto: (url: string, opts?: object) => Promise<unknown> })
          .goto(hotelUrlWithDates, { waitUntil: "domcontentloaded", timeout: 25000 });
        await sleep(1000);
        const landedUrl = page.url();
        const onStartDomain = landedUrl.toLowerCase().includes(startDomain.toLowerCase());
        if (onStartDomain) {
          trace(`[find-listing] DOM goto succeeded — on ${landedUrl.slice(0, 80)}`);
          return "clicked";
        }
        trace(`[find-listing] DOM goto went to wrong domain (${landedUrl.slice(0, 60)}) — trying act() fallback`);
        await page.evaluate(() => window.history.back()).catch(() => {});
        await sleep(800);
      } catch (gotoErr) {
        trace(`[find-listing] DOM goto failed: ${(gotoErr as Error).message?.slice(0, 60)}`);
      }
    }
  }

  // Fast path 1: stagehand.act() — AI-driven click.
  // Used when DOM extraction fails or no startDomain given.
  // IMPORTANT: specify to stay within the OTA domain and not click logos/badges.
  const domainHint = startDomain
    ? ` IMPORTANT: stay on ${startDomain} — do NOT click any link that goes to a different website, brand site, Google Maps, or any third-party page. Do NOT navigate to Google or any search engine.`
    : "";
  try {
    await stagehand.act(
      `In the hotel search results list on the CURRENT PAGE ONLY, ` +
      `find the listing card for "${targetHotelName}". ` +
      `Do NOT click hotels with similar but different names. ` +
      `Click only the hotel NAME or TITLE text link that stays on the same website. ` +
      `Do NOT click "Visit hotel website", "View on map", Google Maps widgets, or any external link.` +
      domainHint
    );
    trace(`[find-listing] direct act() succeeded for "${targetHotelName}"`);
    await sleep(1500);
    if (page) {
      const currentUrl = page.url();
      if (startDomain && !currentUrl.toLowerCase().includes(startDomain.toLowerCase())) {
        trace(`[find-listing] act() went to wrong domain (${currentUrl.slice(0, 80)}) — going back`);
        await page.evaluate(() => window.history.back()).catch(() => {});
        await sleep(1200);
        throw new Error(`wrong domain after act() click`);
      }
      const pageTitle = await page.evaluate(() => document.title).catch(() => "");
      const h1Text = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? "").catch(() => "");
      const nameWords = targetHotelName.toLowerCase().split(/\s+/).filter(w => w.length > 3 || /^\d+$/.test(w));
      const combinedText = (pageTitle + " " + h1Text).toLowerCase();
      const matchScore = nameWords.filter(w => combinedText.includes(w)).length;
      const matchRatio = nameWords.length > 0 ? matchScore / nameWords.length : 1;
      if (matchRatio < 0.5) {
        trace(`[find-listing] act() wrong hotel page (ratio ${matchRatio.toFixed(2)}) — going back`);
        await page.evaluate(() => window.history.back()).catch(() => {});
        await sleep(1000);
        throw new Error(`wrong hotel page`);
      }
      trace(`[find-listing] act() verified correct hotel page (ratio ${matchRatio.toFixed(2)})`);
    }
    return "clicked";
  } catch (err) {
    trace(`[find-listing] direct act() failed: ${(err as Error).message?.slice(0, 80)}`);
  }

  // Fallback: scroll + AI perception loop
  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    const page = stagehand.context?.activePage();
    if (!page) break;

    const perception = await perceiveAndDecide(page as Parameters<typeof perceiveAndDecide>[0], {
      task: `Find and click the hotel whose name EXACTLY matches "${targetHotelName}" in the search results. Do not click hotels with similar but different names.`,
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

  // Early no_availability check: if page text is dominated by "sold out" across all rooms,
  // bail before trying to click Reserve (avoids stagehand.act() picking wrong elements).
  const soldOutCheck = await page.evaluate(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    const soldOutCount = (text.match(/\bsold out\b/g) ?? []).length;
    const reserveCount = (text.match(/\breserve\b|\bi'?ll reserve\b|\bbook now\b/gi) ?? []).length;
    // If there are many "sold out" signals and no (or very few) reserve buttons visible, no availability
    return soldOutCount >= 2 && reserveCount === 0;
  }).catch(() => false);

  if (soldOutCheck) {
    trace("[find-listing] all rooms appear sold out (no Reserve buttons found) — no_availability");
    return "no_availability";
  }

  // Step 1: When a preference is given, try stagehand.act() first.
  // Works well on sites where room names are clear text labels.
  // Note: Expedia uses "Reserve" buttons per room (no <select> quantity dropdowns),
  // so the instruction avoids requiring a dropdown interaction.
  if (roomPreference) {
    try {
      await stagehand.act(
        `In the room availability table, find the room type that best matches "${roomPreference}". ` +
        `If there is a quantity dropdown next to that room, set it to 1. ` +
        `If "${roomPreference}" is not available, locate the cheapest available room instead. ` +
        `Do NOT click any Reserve or Book button yet — only identify or set the quantity.`
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

  // Step 3: Click "I'll reserve" / "Reserve" / "View prices" via stagehand.act().
  // On Booking.com: button says "I'll reserve".
  // On Expedia: button says "Reserve" — clicking opens a room-detail modal, then
  //   a second "Reserve" click in the modal proceeds to checkout.
  // On IHG brand site hotel detail page: button says "View Prices" (takes you to room list).
  try {
    await stagehand.act(
      `Click the primary booking action button to proceed. ` +
      `This may say "I'll reserve", "Reserve", "View Prices", "Check Prices", "Book Now", or "Select Room". ` +
      `Do not interact with any dropdown — only click the main booking button. ` +
      `If a modal or dialog appears after clicking, click the "Reserve" button inside the modal too.`
    );
    trace("[find-listing] clicked reserve/book via act()");
  } catch (actErr) {
    trace(`[find-listing] act() reserve failed: ${(actErr as Error).message?.slice(0, 80)}`);

    // JS click fallback
    const clicked = await page.evaluate(() => {
      function isVisible(el: Element): boolean {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
      }
      const pattern = /i.?ll reserve|reserve|book now|view prices|check prices|select room/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!clicked) {
      trace("[find-listing] could not click reserve — no_availability");
      return "no_availability";
    }
    trace("[find-listing] JS fallback click on reserve button worked");
  }

  // Wait briefly for Expedia-style modal to appear after first Reserve click.
  await sleep(1200);

  // Check if a modal/dialog appeared (Expedia two-click Reserve flow).
  // If so, click the Reserve button inside the modal to proceed to checkout.
  const modalReserveClicked = await page.evaluate(() => {
    function isVisible(el: Element): boolean {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
    }
    // Look for a modal/dialog container
    const modal = document.querySelector<HTMLElement>(
      '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="Modal"], ' +
      '[class*="dialog"], [class*="Dialog"], [class*="overlay"], [class*="Overlay"]'
    );
    if (!modal) return false;
    // Find Reserve button inside the modal
    const pattern = /^reserve$/i;
    const btn = Array.from(modal.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
      .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
    if (btn) {
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return true;
    }
    return false;
  }).catch(() => false);

  if (modalReserveClicked) {
    trace("[find-listing] Expedia modal Reserve button clicked (two-click flow)");
  } else {
    trace("[find-listing] no modal detected after reserve click — single-click flow assumed");
  }

  return "selected";
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
