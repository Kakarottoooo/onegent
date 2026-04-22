/**
 * SeatGeek programmatic RPA — navigation layer.
 *
 * Flow:
 *   seatgeek.com homepage → fill search → autocomplete dropdown → click Top Result
 *   → /{slug}-tickets/ listing page → parse target date → match event row
 *   (click "Show more" if the row is hidden) → event detail page → pick cheapest
 *   ticket in the sidebar → /checkout URL → click "Add new card" to open the
 *   billing + card modal → return reached_checkout so the executor falls through
 *   to provider.fillGuestForm / provider.fillPaymentForm.
 *
 * The active page is routed through real Chrome (see core/real-chrome.ts)
 * because DataDome blocks Playwright's bundled Chromium.
 */
import type { Page } from "playwright";

type TraceFn = (msg: string) => void;

export interface SeatGeekRpaResult {
  reached_checkout: boolean;
  currentUrl: string;
  activePage?: Page;
  needs_login?: boolean;
  error?: string;
}

interface TargetDateTime {
  monthName: string;
  monthIndex: number;
  day: number;
  year: number;
  time?: string;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function parseTargetDateTime(task: string): TargetDateTime | null {
  const monthPattern = new RegExp(
    `\\b(${MONTH_NAMES.join("|")})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`,
    "i"
  );
  const match = task.match(monthPattern);
  if (!match) return null;
  const monthName = match[1];
  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (isNaN(day) || isNaN(year) || monthIndex < 0) return null;

  const timeMatch = task.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm))\b/i);
  return {
    monthName: monthName.slice(0, 1).toUpperCase() + monthName.slice(1).toLowerCase(),
    monthIndex,
    day,
    year,
    time: timeMatch?.[1].toUpperCase().replace(/\s+/g, " "),
  };
}

/**
 * Pull the attraction/event name from the task. ActivityCard.tsx builds task
 * text like: `Book tickets for "Hamilton" on May 20, 2026.` — grab the text
 * inside the first pair of quotes. Fallback: first capitalised token cluster
 * after "for".
 */
function parseAttractionName(task: string): string | null {
  const quoted = task.match(/["\u201C\u201D]([^"\u201C\u201D]{2,80})["\u201C\u201D]/);
  if (quoted?.[1]) return quoted[1].trim();
  const afterFor = task.match(/\bfor\s+([A-Z][\w'&\-. ]{1,60})/);
  return afterFor?.[1]?.trim() ?? null;
}

/**
 * Type a string into an already-focused input by dispatching per-char
 * keydown/input/keyup so React-controlled search boxes fire their autocomplete
 * handler. Native-setter `value = "..."` alone is ignored by some React
 * autocomplete widgets.
 */
async function typeIntoSearchBox(page: Page, query: string, trace: TraceFn): Promise<boolean> {
  const focused = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .filter(el => isVisible(el));
    const search = candidates.find(el => {
      const t = (el.type || "").toLowerCase();
      if (t !== "" && t !== "text" && t !== "search") return false;
      const ph = (el.placeholder || "").toLowerCase();
      const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      return (
        ph.includes("search") || lbl.includes("search") || role === "combobox" ||
        ph.includes("team") || ph.includes("artist") || ph.includes("event") ||
        ph.includes("performer") || ph.includes("venue")
      );
    });
    if (!search) return false;
    search.scrollIntoView({ behavior: "auto", block: "center" });
    search.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }).catch(() => false);

  if (!focused) {
    trace("[sg-rpa] Search box not found on homepage");
    return false;
  }

  // Use Playwright's keyboard to fire real keydown/input/keyup. This is what
  // SG's autocomplete listener actually subscribes to.
  for (const ch of query) {
    await page.keyboard.type(ch, { delay: 40 });
  }
  return true;
}

/**
 * Wait for the autocomplete dropdown to render, then click the row that mentions
 * "Top Result" (or falls back to the first suggestion whose text includes the
 * query). Returns true on success.
 */
async function clickAutocompleteTopResult(
  page: Page,
  query: string,
  trace: TraceFn,
): Promise<boolean> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((q: string) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // SeatGeek autocomplete lives in a floating listbox / ul with role=option items.
      // We can't rely on a stable class name, so we collect all visible <a>/<li>/[role=option]
      // that appear after the search input and look through their text.
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(
        'a, li, [role="option"], [role="link"], button'
      )).filter(isVisible);

      const qLower = q.toLowerCase();

      // Prefer a row whose parent cluster mentions "Top Result" (SG highlights the
      // best match with a "Top Result" label). Walk up a few ancestors to check.
      const withAncestorText = nodes.map(el => {
        let ctx = (el.textContent ?? "").trim();
        let parent: HTMLElement | null = el.parentElement;
        for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) {
          ctx += " | " + (parent.textContent ?? "").trim();
        }
        return { el, text: (el.textContent ?? "").trim(), ctx: ctx.toLowerCase() };
      });

      const topResult = withAncestorText.find(item =>
        item.ctx.includes("top result") &&
        item.text.toLowerCase().includes(qLower) &&
        item.text.length > 0 &&
        item.text.length < 120
      );
      if (topResult) {
        topResult.el.scrollIntoView({ behavior: "auto", block: "center" });
        topResult.el.click();
        return { kind: "top-result", label: topResult.text.slice(0, 80) };
      }

      // Fallback: first link/option that contains the query and points to a
      // /{slug}-tickets URL — these are the attraction/performer rows.
      const performerLink = nodes.find(el => {
        const href = (el as HTMLAnchorElement).href ?? "";
        const text = (el.textContent ?? "").trim();
        return (
          /-tickets(\?|$|\/)/.test(href.toLowerCase()) &&
          text.toLowerCase().includes(qLower) &&
          text.length > 0 &&
          text.length < 120
        );
      });
      if (performerLink) {
        performerLink.scrollIntoView({ behavior: "auto", block: "center" });
        performerLink.click();
        return { kind: "performer-link", label: (performerLink.textContent ?? "").trim().slice(0, 80) };
      }

      return { kind: null, label: null };
    }, query).catch(() => ({ kind: null as string | null, label: null as string | null }));

    if (clicked.kind) {
      trace(`[sg-rpa] Autocomplete click (${clicked.kind}): "${clicked.label}"`);
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace("[sg-rpa] Autocomplete dropdown did not yield a clickable Top Result in 10s");
  return false;
}

/** True once the URL matches /{slug}-tickets pattern or the sidebar ticket list renders. */
async function waitForListingPage(page: Page, trace: TraceFn, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = (() => { try { return page.url(); } catch { return ""; } })();
    if (/seatgeek\.com\/[a-z0-9-]+-tickets(\?|$|\/)/i.test(url)) {
      trace(`[sg-rpa] Listing page reached: ${url.slice(0, 140)}`);
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace("[sg-rpa] Listing URL not reached within timeout");
  return false;
}

/**
 * Click "Show more" / "Show all" expanders on the listing page so that all
 * upcoming dates become visible for date matching. Safe to call repeatedly.
 */
async function expandAllShows(page: Page, trace: TraceFn): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const clicked = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /^\s*(show more|show all|see more|load more|view all)\b/i;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .filter(isVisible);
      const btn = nodes.find(el => pattern.test((el.textContent ?? "").trim()));
      if (!btn) return false;
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.click();
      return true;
    }).catch(() => false);
    if (!clicked) return;
    trace(`[sg-rpa] Clicked "Show more" (pass ${i + 1})`);
    await page.waitForTimeout(700);
  }
}

/**
 * Scan visible event rows on the listing page and click the one matching the
 * target month/day/year. Each row has a date label (e.g. "Wed May 20 7:00 PM")
 * and links to an event detail page. Returns true if a row was clicked.
 */
async function clickMatchingEventRow(
  page: Page,
  target: TargetDateTime,
  trace: TraceFn,
): Promise<boolean> {
  const result = await page.evaluate(
    ({ monthAbbrList, day, year, time }: {
      monthAbbrList: string[]; day: number; year: number; time?: string;
    }) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // SG event rows are <a href="/.../tickets/..."> — event detail links.
      const nodes = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .filter(el => isVisible(el) && el.href && /\/tickets\/\d+|\/-tickets?\/|seatgeek\.com\/.+\/tickets\//i.test(el.href));

      const targetMonthAbbr = monthAbbrList[new Date(`${monthAbbrList[0]} 1, 2000`).getMonth()]; // placeholder

      // Build a plain list: each anchor + its visible text + combined ancestor text.
      const rows = nodes.map(el => {
        let ctx = (el.textContent ?? "").trim();
        let parent: HTMLElement | null = el.parentElement;
        for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
          ctx += " | " + (parent.textContent ?? "").trim();
        }
        return { el, ctx: ctx.toLowerCase().replace(/\s+/g, " "), href: el.href };
      });

      const dayStr = String(day);
      const timeLower = (time ?? "").toLowerCase();

      let best: { el: HTMLAnchorElement; score: number; label: string } | null = null;
      for (const row of rows) {
        let score = 0;
        // Month match: abbreviation (jan/feb/…) OR full name present.
        const hasMonth = monthAbbrList.some(m => new RegExp(`\\b${m}\\b`).test(row.ctx));
        if (hasMonth) score += 3;
        // Day match as whole word (not "20" matching "2026").
        const dayRx = new RegExp(`\\b${dayStr}(st|nd|rd|th)?\\b`);
        if (dayRx.test(row.ctx)) score += 3;
        if (timeLower && row.ctx.includes(timeLower)) score += 2;
        if (row.ctx.includes(String(year))) score += 1;

        if (score >= 6 && (!best || score > best.score)) {
          const label = (row.el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
          best = { el: row.el, score, label };
        }
        void targetMonthAbbr;
      }

      if (!best) return { clicked: false, label: null, scanned: rows.length };
      best.el.scrollIntoView({ behavior: "auto", block: "center" });
      best.el.click();
      return { clicked: true, label: best.label, scanned: rows.length };
    },
    {
      monthAbbrList: [MONTH_ABBR[target.monthIndex]],
      day: target.day,
      year: target.year,
      time: target.time,
    }
  ).catch((err: Error) => {
    trace(`[sg-rpa] event row evaluate failed: ${err.message?.slice(0, 100)}`);
    return { clicked: false, label: null, scanned: 0 };
  });

  if (result.clicked) {
    trace(`[sg-rpa] Event row clicked: "${result.label}" (${result.scanned} rows scanned)`);
    return true;
  }
  trace(`[sg-rpa] No event row matched ${target.monthName} ${target.day}, ${target.year}${target.time ? ` ${target.time}` : ""} (${result.scanned} rows scanned)`);
  return false;
}

/** Fallback: click the first visible event link. Used when no date was parsed. */
async function clickFirstEventRow(page: Page, trace: TraceFn): Promise<boolean> {
  const result = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
      .filter(el => isVisible(el) && el.href && /\/tickets\/\d+|seatgeek\.com\/.+\/tickets\//i.test(el.href))
      .filter(el => (el.textContent ?? "").trim().length > 5);

    if (nodes.length === 0) return { clicked: false, label: null };
    const first = nodes[0];
    first.scrollIntoView({ behavior: "auto", block: "center" });
    first.click();
    return { clicked: true, label: (first.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120) };
  }).catch(() => ({ clicked: false, label: null }));

  if (result.clicked) {
    trace(`[sg-rpa] Fallback: clicked first event row → "${result.label}"`);
    return true;
  }
  trace("[sg-rpa] Fallback: no event rows found on listing page");
  return false;
}

/**
 * Extract ticket quantity from task text. Looks for patterns like "Buy 2 tickets",
 * "2 tickets", "for 2 people". Defaults to 1 (solo intent is the common case from
 * chat flow where NLU found no explicit count). SeatGeek's modal caps at 6+, so
 * clamp values >6 to 6 and warn via trace — the RPA will click "6+" and let the
 * next screen ask for the real number.
 */
function parseTicketQuantity(task: string, trace: TraceFn): number {
  const patterns: RegExp[] = [
    /\bbuy\s+(\d{1,2})\s+tickets?\b/i,
    /\b(\d{1,2})\s+tickets?\b/i,
    /\bfor\s+(\d{1,2})\s+(?:people|guests|adults)\b/i,
    /\bnum_tickets?\s*[:=]\s*(\d{1,2})\b/i,
  ];
  for (const rx of patterns) {
    const m = task.match(rx);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (isFinite(n) && n >= 1 && n <= 20) {
        if (n > 6) {
          trace(`[sg-rpa] Ticket quantity ${n} exceeds modal max (6+) — clamping to 6+`);
          return 6;
        }
        return n;
      }
    }
  }
  return 1;
}

/**
 * Detect and dismiss the "How many tickets?" modal that SeatGeek shows on some
 * event detail pages (common for Broadway resident shows like Wicked/Hamilton).
 * The modal has a row of buttons labeled "1", "2", "3", "4", "5", "6+". Clicks
 * the button matching `qty` (1-6; 7+ maps to "6+").
 *
 * Returns true if a button was clicked, false if no modal was present (benign
 * — many SG events don't gate behind this picker). We poll briefly because the
 * modal animates in after the detail page loads.
 */
async function selectTicketQuantityModal(
  page: Page,
  qty: number,
  trace: TraceFn,
  timeoutMs = 4000,
): Promise<boolean> {
  const target = qty >= 6 ? "6+" : String(qty);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate((wanted: string) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
      };
      // First, confirm a "How many tickets" header is visible — we don't want
      // to accidentally click a bare "1" somewhere else on the page.
      const headers = Array.from(document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, [role="heading"], p, span, div'
      )).filter(isVisible);
      const hasHeader = headers.some(el => {
        const t = (el.textContent ?? "").trim().toLowerCase();
        return /how many tickets/.test(t) && t.length < 80;
      });
      if (!hasHeader) return { found: false, clicked: false, label: null as string | null };

      // Find the number button. SG renders these as <button> or <a role=button>
      // with just "1" / "2" / ... / "6+" as the visible label.
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        'button, [role="button"], a'
      )).filter(isVisible);
      const btn = candidates.find(el => {
        const t = (el.textContent ?? "").trim();
        if (t !== wanted) return false;
        // Guard against tiny icons or huge containers — the number button is
        // roughly square and 30-80px wide.
        const r = el.getBoundingClientRect();
        return r.width >= 20 && r.width <= 140 && r.height >= 20 && r.height <= 100;
      });
      if (!btn) return { found: true, clicked: false, label: null };
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.click();
      return { found: true, clicked: true, label: btn.textContent?.trim() ?? wanted };
    }, target).catch((err: Error) => {
      trace(`[sg-rpa] quantity modal evaluate failed: ${err.message?.slice(0, 100)}`);
      return { found: false, clicked: false, label: null as string | null };
    });

    if (result.clicked) {
      trace(`[sg-rpa] Quantity modal: clicked "${result.label}" (target qty=${qty})`);
      await page.waitForTimeout(700); // let modal unmount + ticket list render
      return true;
    }
    if (result.found && !result.clicked) {
      trace(`[sg-rpa] Quantity modal visible but button "${target}" not found — waiting`);
    }
    await page.waitForTimeout(300);
  }
  trace("[sg-rpa] No quantity modal detected (skipping — likely not required for this event)");
  return false;
}

/** True once we're on an event detail URL (contains "/tickets/" segment with trailing id). */
async function waitForEventDetailPage(page: Page, trace: TraceFn, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = (() => { try { return page.url(); } catch { return ""; } })();
    if (/seatgeek\.com\/.+\/tickets\/\d+/i.test(url) || url.includes("/tickets/")) {
      // Also verify the sidebar listings have loaded — SG renders a price list
      // (per-ticket rows with $XX labels) on the event detail page.
      const hasPriceList = await page.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], li'))
          .filter(isVisible);
        // Needle: "$NNN" price label
        return nodes.some(el => /\$\s?\d{1,4}(\.\d{1,2})?/.test((el.textContent ?? "").trim()));
      }).catch(() => false);
      if (hasPriceList) {
        trace(`[sg-rpa] Event detail page + price list: ${url.slice(0, 140)}`);
        return true;
      }
    }
    await page.waitForTimeout(500);
  }
  trace("[sg-rpa] Event detail page did not load within timeout");
  return false;
}

/**
 * Pick the cheapest visible ticket on the event detail page and click it.
 *
 * Strategy (geometric heuristic, no href dependency): SG's listing rows are
 * <div onClick> with client-side routing — they have no `href` at all. Old
 * selectors like `a[href*="listing="]` return 0 matches. Instead we:
 *
 *   1. Find every element whose text contains `$<N>` (real rows AND noise).
 *   2. Walk up to the closest "clickable-looking" ancestor (anchor / role=button
 *      / cursor:pointer via computed style / listing-sized bounds).
 *   3. Require the ancestor's textContent to include a seating keyword
 *      (Orchestra/Mezzanine/Row X/Section/etc) — this filters out the seat-map
 *      pills, header chips, and sort toggles which also show prices.
 *   4. Dedupe by ancestor, sort by price asc, return the cheapest.
 *
 * Click uses `page.mouse.click(x, y)` at the bounding-rect center — React
 * components sometimes ignore `el.click()` because their handlers are attached
 * through event delegation + pointerdown sequences that synthetic MouseEvents
 * don't replay. Real mouse clicks always fire.
 *
 * On failure we dump the top 3 price-bearing nodes' outerHTML (truncated 200
 * chars) so the next iteration can see what the DOM actually looks like.
 */
async function clickCheapestTicket(page: Page, trace: TraceFn): Promise<boolean> {
  const result = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
    };
    const seatingKeyword = /\b(orchestra|mezzanine|balcony|section|grand tier|front row|rear|loge|floor|general admission|ga|lower|upper|row [a-z0-9]+)\b/i;
    const carouselHint = /\barrow keys\b|\bbetween images\b|\bfirst image\b/i;

    // Walk up from a price-bearing leaf and return the first ancestor whose
    // own textContent contains BOTH a $price AND a seating keyword. That
    // ancestor IS the full listing row — regardless of whether it's wrapped
    // in an anchor, has cursor:pointer, etc.
    //
    // Bail if we outgrow a single row (width > 1100 or height > 500) — past
    // that we'd pick the whole listings panel. Length limit 800 to allow
    // listings with extended aria descriptions / perks copy.
    //
    // `walkDiag` collects the text of each ancestor we visited, for the first
    // few failures — so we can debug why a match isn't happening.
    const walkDiag: string[] = [];
    const findListingRowAncestor = (
      start: HTMLElement,
      collectDiag: boolean,
    ): HTMLElement | null => {
      let cur: HTMLElement | null = start;
      for (let depth = 0; cur && depth < 14; depth++) {
        const r = cur.getBoundingClientRect();
        if (r.width > 1100 || r.height > 500) {
          if (collectDiag) walkDiag.push(`[bail depth=${depth} ${Math.round(r.width)}x${Math.round(r.height)}]`);
          return null;
        }
        // Use innerText (not textContent) — block elements get newlines
        // inserted between them, so <p>Orchestra</p><p>Row F</p> becomes
        // "Orchestra\nRow F" (→ "Orchestra Row F" after whitespace collapse)
        // instead of the useless "OrchestraRow F" that textContent returns.
        // That matters because "\borchestra\b" fails against "OrchestraRow"
        // (no word boundary between "a" and "R"), but matches fine against
        // "Orchestra Row".
        const text = ((cur as HTMLElement).innerText ?? cur.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim();
        const hasPrice = /\$\s?\d/.test(text);
        const hasKeyword = seatingKeyword.test(text);
        if (collectDiag && depth < 6) {
          walkDiag.push(
            `d=${depth} ${cur.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} ` +
            `len=${text.length} $=${hasPrice ? 1 : 0} kw=${hasKeyword ? 1 : 0} :: ${text.slice(0, 120)}`
          );
        }
        if (text.length >= 10 && text.length <= 800 &&
            hasPrice && hasKeyword && !carouselHint.test(text)) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    };

    // Collect all leaf-ish elements with a dollar sign. We use a broad query
    // and filter by "textContent contains $ and is short enough to be a row
    // label, not a page section".
    const allNodes = Array.from(document.querySelectorAll<HTMLElement>(
      "div, li, a, button, span, [role]"
    )).filter(isVisible);

    type Candidate = {
      ancestor: HTMLElement;
      price: number;
      label: string;
    };
    const byAncestor = new Map<HTMLElement, Candidate>();
    let sawPrice = 0, sawCarousel = 0, sawNoAncestor = 0;

    for (const el of allNodes) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 280) continue;
      if (!/\$\s?\d/.test(text)) continue;
      sawPrice++;
      if (carouselHint.test(text)) { sawCarousel++; continue; }

      // Walk up to the full listing row (ancestor whose OWN text has both
      // price and seating keyword). Collect diag only for the first failure
      // so we can see why the walk didn't land on a row.
      const collectDiag = sawNoAncestor === 0 && byAncestor.size === 0;
      const ancestor = findListingRowAncestor(el, collectDiag);
      if (!ancestor) { sawNoAncestor++; continue; }
      const ancText = (ancestor.innerText ?? ancestor.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();

      const priceMatches = ancText.match(/\$\s?(\d{1,4}(?:\.\d{1,2})?)/g);
      if (!priceMatches) continue;
      const last = priceMatches[priceMatches.length - 1];
      const num = parseFloat(last.replace(/[^0-9.]/g, ""));
      if (!isFinite(num) || num <= 0) continue;

      const existing = byAncestor.get(ancestor);
      if (!existing || num < existing.price) {
        byAncestor.set(ancestor, {
          ancestor,
          price: num,
          label: ancText.slice(0, 120),
        });
      }
    }

    const rows = Array.from(byAncestor.values()).sort((a, b) => a.price - b.price);

    // Build a diagnostic dump — first 3 price-bearing raw nodes' outerHTML.
    const diagNodes = allNodes
      .filter(el => {
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        return t.length > 0 && t.length < 280 && /\$\s?\d/.test(t) && !carouselHint.test(t);
      })
      .slice(0, 3)
      .map(el => (el.outerHTML ?? "").replace(/\s+/g, " ").slice(0, 200));

    if (rows.length === 0) {
      return {
        clicked: false, label: null as string | null, price: 0,
        scanned: 0,
        totalCandidates: allNodes.length,
        sawPrice, sawCarousel, sawNoAncestor,
        diagNodes,
        walkDiag,
        clickX: 0, clickY: 0,
      };
    }

    const cheapest = rows[0];
    cheapest.ancestor.scrollIntoView({ behavior: "auto", block: "center" });
    const rect = cheapest.ancestor.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Click in-page. Stagehand's wrapped Page does not expose `page.mouse`
    // on the Node side, so we can't use page.mouse.click from the caller —
    // do it inside the evaluate. Fire a full event sequence (pointerdown →
    // mousedown → pointerup → mouseup → click) so React's delegated
    // listeners pick it up regardless of which phase they're bound to.
    const targetEl = document.elementFromPoint(cx, cy) ?? cheapest.ancestor;
    const dispatch = (type: string, ctor: typeof MouseEvent) => {
      const ev = new ctor(type, {
        bubbles: true, cancelable: true,
        clientX: cx, clientY: cy,
        button: 0, buttons: 1,
        view: window,
      });
      targetEl.dispatchEvent(ev);
    };
    try {
      // PointerEvent may not exist in older browsers — fall back to MouseEvent.
      const PE = (window as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
      dispatch("pointerdown", PE);
      dispatch("mousedown", MouseEvent);
      dispatch("pointerup", PE);
      dispatch("mouseup", MouseEvent);
      dispatch("click", MouseEvent);
    } catch {
      // Last-resort fallback — native element.click().
    }
    // Always also fire native click as a belt-and-suspenders. React's onClick
    // listens to the `click` event which bubbles up from .click() too.
    try { (targetEl as HTMLElement).click(); } catch { /* noop */ }

    return {
      clicked: true,
      label: cheapest.label,
      price: cheapest.price,
      scanned: rows.length,
      totalCandidates: allNodes.length,
      sawPrice, sawCarousel, sawNoAncestor,
      diagNodes,
      walkDiag,
      targetTag: (targetEl as HTMLElement).tagName.toLowerCase(),
      clickX: cx,
      clickY: cy,
    };
  }).catch((err: Error) => ({
    clicked: false, label: null as string | null, price: 0,
    scanned: 0, totalCandidates: 0,
    sawPrice: 0, sawCarousel: 0, sawNoAncestor: 0,
    diagNodes: [] as string[],
    walkDiag: [] as string[],
    targetTag: "",
    clickX: 0, clickY: 0,
    err: err.message?.slice(0, 80),
  }));

  if (!result.clicked) {
    trace(
      `[sg-rpa] No ticket rows found on event detail page (` +
      `total=${result.totalCandidates}, sawPrice=${result.sawPrice}, ` +
      `sawCarousel=${result.sawCarousel}, sawNoAncestor=${result.sawNoAncestor})`
    );
    for (const [i, snippet] of (result.diagNodes ?? []).entries()) {
      trace(`[sg-rpa]   diag[${i}]: ${snippet}`);
    }
    for (const [i, step] of (result.walkDiag ?? []).entries()) {
      trace(`[sg-rpa]   walk[${i}]: ${step}`);
    }
    return false;
  }

  // Click already fired inside page.evaluate — log and return.
  trace(
    `[sg-rpa] Cheapest ticket clicked: $${result.price} — "${result.label}" ` +
    `(${result.scanned}/${result.totalCandidates} rows, ` +
    `target=${result.targetTag}@${Math.round(result.clickX)},${Math.round(result.clickY)})`
  );
  return true;
}

/**
 * After a listing row is clicked, SG opens a right-side detail panel with a
 * "1 ticket" dropdown and a "Continue" button. The button is what finally
 * navigates to the /checkout domain — without it we just sit on the detail
 * page. Accept any variant (Continue, Checkout, Proceed to checkout, Buy).
 */
/**
 * Single-pass search-and-click for a Continue/Checkout button. No polling —
 * used both standalone (with retry in waitForCheckoutUrl) and by legacy
 * callers. Matches: "Continue", "Continue to Checkout", "Proceed to Checkout",
 * "Checkout", "Buy Now", "Buy Tickets". Length cap 40 rules out paragraph-
 * length CTA rows.
 */
interface ClickContinueResult {
  clicked: boolean;
  label: string | null;
  diag: {
    url: string;
    dialogCount: number;
    classDialogCount: number;
    scope: "dialog" | "classDialog" | "document" | "none";
    candidates: string[];
    checkedBoxes: number;
  };
}

/**
 * Detect + mark the target Continue/Checkout button without clicking it.
 * Returns a boolean `marked` and full diag. The actual click is then done via
 * Playwright `locator.click()` which dispatches real CDP mouse events — SG
 * guards its checkout navigation behind `isTrusted=true`, so JS-dispatched
 * events close the modal but never navigate.
 *
 * Also auto-ticks any unchecked checkboxes inside the modal first (some
 * interstitials have a "I agree" gate).
 */
async function clickContinueOnce(page: Page): Promise<ClickContinueResult> {
  const MARKER = "data-sg-rpa-click";
  // Step 1: detect and mark the button in-page, return diag + label.
  const detection = await page.evaluate((marker: string) => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (el as HTMLElement).offsetParent !== null;
    };
    const pattern = /^\s*(continue|checkout|proceed to checkout|proceed|buy (?:now|tickets?)|i agree)\b/i;

    // Clear any stale markers from prior iterations.
    document.querySelectorAll(`[${marker}]`).forEach((el) => el.removeAttribute(marker));

    // Priority 1: visible [role=dialog]/[aria-modal]. Priority 2: class-based
    // modal fallback. Priority 3: whole document.
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
    )).filter(isVisible);
    const classDialogs = Array.from(document.querySelectorAll<HTMLElement>(
      '[class*="Modal" i], [class*="Dialog" i]'
    )).filter(isVisible).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 150;
    });
    const chosenScopes: HTMLElement[] = dialogs.length > 0
      ? dialogs
      : classDialogs.length > 0
        ? classDialogs
        : [];
    const scopeKind: "dialog" | "classDialog" | "document" | "none" =
      dialogs.length > 0 ? "dialog"
      : classDialogs.length > 0 ? "classDialog"
      : "document";
    const scopesToScan: ParentNode[] = chosenScopes.length > 0 ? chosenScopes : [document];

    // Auto-tick any unchecked, non-disabled checkboxes inside the active
    // modal — Before You Buy sometimes has an "I agree" gate. Bare .click()
    // is enough for checkbox state; React re-renders from the DOM checked
    // property so no need for trusted events here.
    let checkedBoxes = 0;
    for (const scope of chosenScopes) {
      const boxes = Array.from(scope.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
      )).filter((b) => isVisible(b) && !b.checked && !b.disabled);
      for (const b of boxes) {
        try { b.click(); checkedBoxes++; } catch { /* ignore */ }
      }
    }

    const allCandidateTexts: string[] = [];
    let markedLabel: string | null = null;
    for (const scope of scopesToScan) {
      const nodes = Array.from(scope.querySelectorAll<HTMLElement>(
        'button, a, [role="button"]'
      )).filter(isVisible);
      // Prefer longer/more specific labels: "Continue to Checkout" > "Continue".
      const candidates = nodes
        .map(el => ({ el, text: ((el as HTMLElement).innerText ?? el.textContent ?? "").trim() }))
        .filter(c => c.text && c.text.length < 40 && pattern.test(c.text))
        .sort((a, b) => b.text.length - a.text.length);
      for (const c of candidates.slice(0, 5)) allCandidateTexts.push(c.text);

      const btn = candidates[0]?.el;
      if (!btn) continue;
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.setAttribute(marker, "1");
      markedLabel = ((btn as HTMLElement).innerText ?? btn.textContent ?? "").trim().slice(0, 40);
      break;
    }

    return {
      marked: markedLabel !== null,
      label: markedLabel,
      diag: {
        url: location.href.slice(0, 140),
        dialogCount: dialogs.length,
        classDialogCount: classDialogs.length,
        scope: scopeKind,
        candidates: allCandidateTexts,
        checkedBoxes,
      },
    };
  }, MARKER).catch(() => ({
    marked: false,
    label: null as string | null,
    diag: {
      url: "",
      dialogCount: 0,
      classDialogCount: 0,
      scope: "none" as const,
      candidates: [] as string[],
      checkedBoxes: 0,
    },
  }));

  if (!detection.marked) {
    return { clicked: false, label: null, diag: detection.diag };
  }

  // Step 2: click via Playwright locator — CDP dispatches trusted events so
  // SG's isTrusted guard accepts it and location.assign('/checkout') fires.
  try {
    await page.locator(`[${MARKER}="1"]`).first().click({ timeout: 2500 });
    return { clicked: true, label: detection.label, diag: detection.diag };
  } catch {
    // Fall back: try in-page .click() — better than nothing.
    try {
      await page.evaluate((marker: string) => {
        const el = document.querySelector<HTMLElement>(`[${marker}="1"]`);
        el?.click();
      }, MARKER);
      return { clicked: true, label: detection.label, diag: detection.diag };
    } catch {
      return { clicked: false, label: detection.label, diag: detection.diag };
    }
  }
}

async function clickContinueButton(page: Page, trace: TraceFn, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await clickContinueOnce(page);
    if (result.clicked) {
      trace(`[sg-rpa] Continue button clicked: "${result.label}"`);
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace("[sg-rpa] Continue button not found after ticket row click");
  return false;
}

/**
 * Wait for /checkout URL (SG's secure checkout domain), clicking any visible
 * Continue/Checkout button on each poll iteration. Handles the multi-step
 * flow: detail panel "Continue" → "Before You Buy" interstitial "Continue to
 * Checkout" → /checkout. Idempotent: if the button is already gone (e.g. page
 * transitioning) the click is a no-op.
 *
 * `clickedLabels` de-dupes trace noise — we only log each distinct label
 * once, so repeated clicks on the same "Continue" button while SG is
 * transitioning don't spam the trace.
 */
async function waitForCheckoutUrl(
  page: Page,
  trace: TraceFn,
  timeoutMs = 20000,
  getAllPages?: () => Page[],
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs;
  const clickedLabels = new Set<string>();
  const loggedDiagKeys = new Set<string>();
  let iter = 0;
  while (Date.now() < deadline) {
    iter++;
    const candidates: Page[] = getAllPages ? getAllPages() : [page];
    for (const pg of candidates) {
      const url = (() => { try { return pg.url(); } catch { return ""; } })();
      if (url.includes("seatgeek.com/checkout") || url.includes("/checkout?")) {
        trace(`[sg-rpa] Checkout URL reached: ${url.slice(0, 140)}`);
        return pg;
      }
    }

    // Try to advance: click a Continue/Checkout button on any candidate page.
    // Stop at the first page that yields a click so we don't fire multiple
    // clicks per cycle.
    for (const pg of candidates) {
      const result = await clickContinueOnce(pg);
      const d = result.diag;
      // Dedup diag log by (scope + candidates) so we only emit when state
      // actually changes iteration-to-iteration.
      const diagKey = `${d.scope}|${d.dialogCount}|${d.classDialogCount}|${d.candidates.join(",")}`;
      if (!loggedDiagKeys.has(diagKey)) {
        trace(
          `[sg-rpa] iter=${iter} url=${d.url} ` +
          `dialogs=${d.dialogCount} classDialogs=${d.classDialogCount} scope=${d.scope} ` +
          `checkedBoxes=${d.checkedBoxes} candidates=[${d.candidates.join(" | ")}]`
        );
        loggedDiagKeys.add(diagKey);
      }
      if (result.clicked) {
        const label = result.label ?? "(unknown)";
        if (!clickedLabels.has(label)) {
          trace(`[sg-rpa] Advance click: "${label}"`);
          clickedLabels.add(label);
        }
        break;
      }
    }

    await page.waitForTimeout(500);
  }
  trace("[sg-rpa] Did not reach /checkout URL within timeout");
  return null;
}

/**
 * On the SG checkout page, click the "Add new card" button to open the billing
 * + card modal. If the modal is already open (has a visible card-number input)
 * we skip the click.
 */
async function openAddNewCardModal(page: Page, trace: TraceFn): Promise<boolean> {
  // If the modal is already open we're done.
  const alreadyOpen = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const card = document.querySelector<HTMLInputElement>(
      'input[autocomplete="cc-number"], input[name*="cardNumber" i], input[id*="cardNumber" i]'
    );
    return !!(card && isVisible(card));
  }).catch(() => false);

  if (alreadyOpen) {
    trace("[sg-rpa] Card modal already open");
    return true;
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /^\s*(add (a )?new card|add card|add a card|use a new card)\b/i;
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .filter(isVisible);
      const btn = nodes.find(el => pattern.test((el.textContent ?? "").trim()));
      if (!btn) return false;
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.click();
      return true;
    }).catch(() => false);

    if (clicked) {
      trace('[sg-rpa] Clicked "Add new card"');
      // Give the modal a moment to render.
      await page.waitForTimeout(1200);
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace('[sg-rpa] "Add new card" button not found — modal may already be inline');
  return false;
}

/**
 * Main entry. Called from stagehand-executor as an early-return block when
 * the active page belongs to seatgeek.com.
 */
export async function bookSeatGeekProgrammatic(
  page: Page,
  task: string,
  trace: TraceFn,
  _stagehand?: { act: (s: string) => Promise<unknown> },
  getAllPages?: () => Page[],
): Promise<SeatGeekRpaResult> {
  const getUrl = () => { try { return page.url(); } catch { return ""; } };

  trace(`[sg-rpa] Starting SeatGeek RPA. Current URL: ${getUrl().slice(0, 140)}`);

  const target = parseTargetDateTime(task);
  const attraction = parseAttractionName(task);

  if (target) {
    trace(`[sg-rpa] Target date: ${target.monthName} ${target.day}, ${target.year}${target.time ? ` @ ${target.time}` : ""}`);
  } else {
    trace("[sg-rpa] No date in task — will pick first available event (resident show like Hamilton)");
  }
  if (attraction) {
    trace(`[sg-rpa] Attraction: "${attraction}"`);
  } else {
    trace("[sg-rpa] No attraction in task — assuming user started on a listing/event URL directly");
  }

  // ── Stage A: homepage search → listing ───────────────────────────────────
  // Only search from homepage; if already on a listing/event URL, skip.
  //
  // SG URL conventions we must distinguish:
  //   listing:      seatgeek.com/wicked-tickets            (slug-tickets, no extra path)
  //   listing+qs:   seatgeek.com/wicked-tickets?...
  //   event detail: seatgeek.com/wicked-tickets/broadway/2026-05-20-7-pm/17805166
  //                 (extra path segments ending in a numeric event id)
  //
  // Previous regex required literal "/tickets/<digits>" which never matches SG's
  // real detail URLs — the whole slug is {name}-tickets, not a plain /tickets/.
  // Must check onEventAlready first and exclude it from onListingAlready,
  // otherwise event-detail URLs get misclassified as listings and we try to
  // find event rows on the sidebar (none exist → fallback failure).
  const onEventAlready = /seatgeek\.com\/[a-z0-9-]+-tickets\/[^?]+\/\d{4,}/i.test(getUrl());
  const onListingAlready =
    !onEventAlready && /seatgeek\.com\/[a-z0-9-]+-tickets(\?|$|\/)/i.test(getUrl());

  if (!onListingAlready && !onEventAlready && attraction) {
    await page.waitForTimeout(1200); // allow homepage scripts to settle
    const typed = await typeIntoSearchBox(page, attraction, trace);
    if (!typed) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        error: "Could not find SeatGeek homepage search input.",
      };
    }
    await page.waitForTimeout(800);
    const picked = await clickAutocompleteTopResult(page, attraction, trace);
    if (!picked) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        error: `Autocomplete did not produce a clickable result for "${attraction}".`,
      };
    }
    const landedOnListing = await waitForListingPage(page, trace);
    if (!landedOnListing) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        error: "Autocomplete clicked but did not land on a listing page.",
      };
    }
  }

  // ── Stage B: listing → event row → detail ────────────────────────────────
  if (!onEventAlready) {
    await page.waitForTimeout(1200);
    await expandAllShows(page, trace);

    let rowClicked = false;
    if (target) {
      rowClicked = await clickMatchingEventRow(page, target, trace);
      if (!rowClicked) {
        trace("[sg-rpa] Target date not matched — falling back to first event row");
        rowClicked = await clickFirstEventRow(page, trace);
      }
    } else {
      rowClicked = await clickFirstEventRow(page, trace);
    }
    if (!rowClicked) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        error: "No event row could be clicked on the listing page.",
      };
    }

    const onDetail = await waitForEventDetailPage(page, trace);
    if (!onDetail) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        error: "Event row clicked but event detail page never loaded.",
      };
    }
  }

  // ── Stage C: detail → cheapest ticket → checkout ────────────────────────
  await page.waitForTimeout(1000);
  // Some SG detail pages gate behind a "How many tickets?" modal (Broadway
  // resident shows in particular). Resolve the user's quantity from the task
  // text — defaults to 1 when chat didn't specify. Returns false (benign) when
  // the modal is absent, so the flow continues straight to ticket rows.
  const qty = parseTicketQuantity(task, trace);
  trace(`[sg-rpa] Target ticket quantity: ${qty}`);
  await selectTicketQuantityModal(page, qty, trace);

  const ticketClicked = await clickCheapestTicket(page, trace);
  if (!ticketClicked) {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      error: "Could not click a ticket row on the event detail page.",
    };
  }

  // Ticket row opens a detail panel with a Continue button — that button is
  // what actually navigates to /checkout. Clicking the row alone just opens
  // the panel with a URL fragment (#listing=<id>), no domain change.
  await page.waitForTimeout(800);
  await clickContinueButton(page, trace);

  const checkoutPage = await waitForCheckoutUrl(page, trace, 20000, getAllPages);
  if (!checkoutPage) {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      error: "Ticket clicked but /checkout page never loaded.",
    };
  }

  // ── Stage D: open "Add new card" modal ──────────────────────────────────
  await checkoutPage.waitForTimeout(1500);
  await openAddNewCardModal(checkoutPage, trace);

  const finalUrl = (() => { try { return checkoutPage.url(); } catch { return getUrl(); } })();
  return {
    reached_checkout: true,
    currentUrl: finalUrl,
    activePage: checkoutPage,
  };
}
