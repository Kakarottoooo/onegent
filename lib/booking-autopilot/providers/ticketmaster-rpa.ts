/**
 * Ticketmaster programmatic RPA — phase 1: navigate to seat selection.
 *
 * Flow:
 *   attraction/artist page → calendar slot click → sidebar "Find Tickets"
 *   → /event/ page with seat map → STOP for user to pick seats
 *   → poll "Reserve Tickets" (enabled once user has selected seats) → click
 *   → checkout.ticketmaster URL → hand off to existing guestDetails/payment layers
 *
 * Auth handling: if any navigation lands on auth.ticketmaster.com we pause
 * and wait for the user to sign in (URL leaves the auth domain). Cookies from
 * .ticketmaster-cookies.json usually prevent this, but it's a safety net.
 */
import type { Page } from "playwright";

type TraceFn = (msg: string) => void;

export interface TicketmasterRpaResult {
  reached_checkout: boolean;
  currentUrl: string;
  activePage?: Page;
  needs_login?: boolean;
  error?: string;
}

interface TargetDateTime {
  monthName: string;   // "May"
  monthIndex: number;  // 0-based (4 = May)
  day: number;         // 20
  year: number;        // 2026
  time?: string;       // "7:00 PM" — optional
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Pull the target date/time out of the task string. ActivityCard.tsx builds
 * task text like: `Book tickets for "X" on May 20, 2026.` — we look for a
 * `${month} ${day}, ${year}` substring plus an optional "H:MM AM/PM" time.
 */
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
 * Read the month/year of the currently-active calendar tab.
 * Ticketmaster renders a strip of month tabs (Feb / Mar / Apr 2026 / May / Jun)
 * — the active one has aria-selected="true" (or similar) and includes the year
 * in its aria-label. Returns null if the tab strip is not found / not parsed.
 */
async function readCurrentCalendarMonth(page: Page, trace: TraceFn): Promise<{ monthIndex: number; year: number } | null> {
  const text = await page.evaluate(() => {
    const collect = (el: Element | null): string =>
      ((el?.getAttribute?.("aria-label") ?? "") + " " + (el?.textContent ?? "")).trim();
    const direct = document.querySelector(
      '[role="tab"][aria-selected="true"], [aria-selected="true"], [aria-current="true"], [aria-current="page"], [aria-current="date"]'
    );
    if (direct) return collect(direct);
    // Fallback: any element whose aria-label contains "selected" (TM uses this).
    const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"]'));
    const hit = all.find(el => /selected/i.test(el.getAttribute("aria-label") ?? ""));
    return hit ? collect(hit) : "";
  }).catch(() => "");

  if (!text) {
    trace("[tm-rpa] Calendar month tab not found (no selected/current element)");
    return null;
  }
  const lower = text.toLowerCase();
  const monthIndex = MONTH_NAMES.findIndex(m => lower.includes(m));
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (monthIndex < 0 || !yearMatch) {
    trace(`[tm-rpa] Could not parse current month from tab text: "${text.slice(0, 80)}"`);
    return null;
  }
  return { monthIndex, year: parseInt(yearMatch[1], 10) };
}

/**
 * Advance / rewind the calendar until the active month matches `target`.
 * Uses the Next Month / Previous Month chevrons visible at the right side of
 * the month-tab strip. Caps at 12 hops so a bad DOM match can't infinite-loop.
 */
async function navigateToTargetMonth(page: Page, target: TargetDateTime, trace: TraceFn): Promise<boolean> {
  const MAX_HOPS = 12;
  for (let i = 0; i < MAX_HOPS; i++) {
    const current = await readCurrentCalendarMonth(page, trace);
    if (!current) {
      trace("[tm-rpa] Month nav: giving up (can't read current month)");
      return false;
    }
    const diff = (target.year - current.year) * 12 + (target.monthIndex - current.monthIndex);
    if (diff === 0) {
      trace(`[tm-rpa] Month nav: on target ${target.monthName} ${target.year}`);
      return true;
    }
    const wantNext = diff > 0;
    const labels = wantNext ? ["next month", "next"] : ["previous month", "previous", "prev month", "prev"];
    const clicked = await page.evaluate((labelList: string[]) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .filter(isVisible);
      const btn = nodes.find(el => {
        const aria = (el.getAttribute("aria-label") ?? "").toLowerCase().trim();
        const txt  = (el.textContent ?? "").toLowerCase().trim();
        return labelList.some(lbl => aria === lbl || aria.includes(lbl) || txt === lbl);
      });
      if (!btn) return false;
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.click();
      return true;
    }, labels).catch(() => false);

    if (!clicked) {
      trace(`[tm-rpa] Month nav: ${wantNext ? "next" : "previous"} button not found (diff=${diff})`);
      return false;
    }
    trace(`[tm-rpa] Month nav: clicked ${wantNext ? "next" : "previous"} (current=${current.year}-${String(current.monthIndex + 1).padStart(2, "0")}, diff=${diff})`);
    await page.waitForTimeout(900);
  }
  trace("[tm-rpa] Month nav: exceeded 12 hops");
  return false;
}

/**
 * Click the calendar/event slot that matches the target date (and time if
 * provided). Ticketmaster attraction pages list events as <a> or <button>
 * elements; we match by day number + month name in the visible text.
 */
async function clickCalendarSlot(page: Page, target: TargetDateTime, trace: TraceFn): Promise<boolean> {
  const result = await page.evaluate(
    ({ monthName, day, year, time }: { monthName: string; day: number; year: number; time?: string }) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Candidate clickables: anchors, buttons, and role="button"/"link" elements
      const selector = 'a, button, [role="button"], [role="link"]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);

      const dayStr = String(day);
      const dayPadded = dayStr.padStart(2, "0");
      const monthLower = monthName.toLowerCase();
      const timeLower = (time ?? "").toLowerCase();

      // Score each candidate: +3 for month match, +3 for day match, +2 for time match.
      // We want ALL three (or month+day when no time) to agree.
      let best: { el: HTMLElement; score: number; label: string } | null = null;
      for (const el of nodes) {
        const text = (el.textContent ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
        const combined = `${text} ${aria}`;
        if (!combined) continue;

        let score = 0;
        if (combined.includes(monthLower) || combined.includes(monthLower.slice(0, 3))) score += 3;
        // Match day as whole number (not substring of "20" in "2026").
        // Accept "may 20", "20,", " 20 ", "20th", "05/20".
        const dayRx = new RegExp(`\\b${dayStr}(st|nd|rd|th)?\\b|\\b${dayPadded}\\b`);
        if (dayRx.test(combined)) score += 3;
        if (timeLower && combined.includes(timeLower)) score += 2;
        // Year match is a weak bonus (some calendars don't show year).
        if (combined.includes(String(year))) score += 1;

        // Ignore tiny elements (likely nav chevrons).
        if (el.offsetWidth < 30 || el.offsetHeight < 20) continue;

        if (score >= 6 && (!best || score > best.score)) {
          best = { el, score, label: text.slice(0, 80) };
        }
      }

      if (!best) return { clicked: false, matchedLabel: null, candidates: nodes.length };
      best.el.scrollIntoView({ behavior: "auto", block: "center" });
      best.el.click();
      return { clicked: true, matchedLabel: best.label, candidates: nodes.length };
    },
    {
      monthName: target.monthName,
      day: target.day,
      year: target.year,
      time: target.time,
    }
  ).catch((err: Error) => {
    trace(`[tm-rpa] calendar click evaluate failed: ${err.message?.slice(0, 100)}`);
    return { clicked: false, matchedLabel: null, candidates: 0 };
  });

  if (result.clicked) {
    trace(`[tm-rpa] Calendar slot clicked: "${result.matchedLabel}" (${result.candidates} candidates scanned)`);
    return true;
  }
  trace(`[tm-rpa] No calendar slot matched ${target.monthName} ${target.day}, ${target.year}${target.time ? ` ${target.time}` : ""} (${result.candidates} candidates scanned)`);
  return false;
}

/**
 * Fallback used when the task text carries no date (e.g. resident shows like
 * Wicked / Hamilton — the activity pipeline returns an attraction URL with no
 * datetime, so ActivityCard builds a dateless task). Click the first time-slot
 * button in DOM order, which corresponds to the earliest available showtime
 * on the calendar. Trace includes the slot's aria-label so the user can see
 * in the `npm run dev` terminal which show was chosen and manually redirect
 * the browser if they want a different date.
 */
async function clickFirstAvailableSlot(page: Page, trace: TraceFn): Promise<boolean> {
  const result = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const selector = 'a, button, [role="button"], [role="link"]';
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);

    // Time slot buttons read like "2:00 PM" or "2:00 PM, Wednesday, April 22".
    // Match if the visible text or aria-label STARTS with a time pattern.
    const timePattern = /^\s*\d{1,2}:\d{2}\s*(am|pm)\b/i;
    const timeSlots = nodes.filter(el => {
      if (el.offsetWidth < 30 || el.offsetHeight < 20) return false;
      const text = (el.textContent ?? "").trim();
      const aria = (el.getAttribute("aria-label") ?? "").trim();
      return timePattern.test(text) || timePattern.test(aria);
    });

    if (timeSlots.length === 0) {
      return { clicked: false, label: null, candidates: 0 };
    }
    const chosen = timeSlots[0];
    chosen.scrollIntoView({ behavior: "auto", block: "center" });
    chosen.click();
    const label = ((chosen.getAttribute("aria-label") ?? chosen.textContent) ?? "")
      .trim().replace(/\s+/g, " ").slice(0, 120);
    return { clicked: true, label, candidates: timeSlots.length };
  }).catch((err: Error) => {
    trace(`[tm-rpa] first-slot evaluate failed: ${err.message?.slice(0, 100)}`);
    return { clicked: false, label: null, candidates: 0 };
  });

  if (result.clicked) {
    trace(`[tm-rpa] Fallback: clicked first available slot → "${result.label}" (${result.candidates} slots total)`);
    return true;
  }
  trace(`[tm-rpa] Fallback: no time-slot buttons found on page`);
  return false;
}

/**
 * After a calendar slot is selected, Ticketmaster shows a right-side panel
 * with an "Event information" header and a prominent blue "Find Tickets"
 * button. We wait for it to appear then click it.
 */
async function clickFindTickets(page: Page, trace: TraceFn): Promise<boolean> {
  // Wait up to 8s for the button to render in the sidebar.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const selector = 'a, button, [role="button"], [role="link"]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
      const pattern = /^\s*(find tickets|buy tickets|get tickets)\s*$/i;
      const candidate = nodes.find(el => pattern.test((el.textContent ?? "").trim()));
      if (candidate) {
        candidate.scrollIntoView({ behavior: "auto", block: "center" });
        candidate.click();
        return (candidate.textContent ?? "").trim();
      }
      return null;
    }).catch(() => null);

    if (clicked) {
      trace(`[tm-rpa] Clicked Find Tickets: "${clicked}"`);
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace("[tm-rpa] Find Tickets button not found within 8s");
  return false;
}

/** True once the page lands on /event/ or shows a seat-map canvas/iframe. */
async function waitForEventPage(page: Page, trace: TraceFn, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = (() => { try { return page.url(); } catch { return ""; } })();
    if (url.includes("/event/")) {
      trace(`[tm-rpa] Event page reached: ${url.slice(0, 120)}`);
      return true;
    }
    const hasSeatMap = await page.evaluate(() => {
      return !!document.querySelector('canvas, [data-testid*="seat" i], iframe[src*="seat" i], [class*="seat-map" i]');
    }).catch(() => false);
    if (hasSeatMap) {
      trace(`[tm-rpa] Seat map detected at: ${url.slice(0, 120)}`);
      return true;
    }
    await page.waitForTimeout(500);
  }
  trace("[tm-rpa] Event page did not load within timeout");
  return false;
}

/**
 * Poll the "Reserve Tickets" button. Ticketmaster disables it until seats
 * are selected. We give the user up to 10min to pick seats — long enough for
 * anyone, short enough that abandoned sessions don't hang forever.
 */
async function pollReserveTickets(page: Page, trace: TraceFn, timeoutMs = 10 * 60 * 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("button, [role='button']"))
        .filter(isVisible);
      const pattern = /reserve tickets|checkout|continue to checkout/i;
      const btn = btns.find(el => pattern.test((el.textContent ?? "").trim()));
      if (!btn) return { present: false, enabled: false };
      const disabled = btn.hasAttribute("disabled") ||
        btn.getAttribute("aria-disabled") === "true" ||
        (btn as HTMLButtonElement).disabled;
      return { present: true, enabled: !disabled };
    }).catch(() => ({ present: false, enabled: false }));

    if (state.present && state.enabled) {
      trace("[tm-rpa] Reserve Tickets enabled — clicking");
      const clicked = await page.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("button, [role='button']"))
          .filter(isVisible);
        const pattern = /reserve tickets|checkout|continue to checkout/i;
        const btn = btns.find(el => pattern.test((el.textContent ?? "").trim()));
        if (!btn) return false;
        btn.scrollIntoView({ behavior: "auto", block: "center" });
        btn.click();
        return true;
      }).catch(() => false);
      return clicked;
    }

    // Heartbeat log every 30s so the user sees we're still waiting.
    if (Date.now() - lastLog > 30000) {
      trace(`[tm-rpa] Waiting for user to select seats… Reserve Tickets ${state.present ? "visible but disabled" : "not yet rendered"}`);
      lastLog = Date.now();
    }
    await page.waitForTimeout(2000);
  }
  trace("[tm-rpa] Reserve Tickets poll timed out (10 min)");
  return false;
}

/**
 * Checkout page "payment gate" — between Reserve Tickets and the real payment
 * form, Ticketmaster shows an order summary with two required actions:
 *   1. Tick the "I have read and agree to Terms of Use & Standard Purchase
 *      Policy" checkbox (CONDITIONS OF PURCHASE, marked REQUIRED)
 *   2. Click the green "Proceed to Payment" button
 *
 * Both are static known UI — Layer 1 territory per the booking architecture
 * in CLAUDE.md. We retry for a few seconds because the order summary renders
 * progressively.
 */
async function passPaymentGate(page: Page, trace: TraceFn): Promise<boolean> {
  // Step 1: tick the Terms checkbox (if present and not already ticked).
  const checkboxDeadline = Date.now() + 10000;
  let checkboxHandled = false;
  while (Date.now() < checkboxDeadline) {
    const state = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter(isVisible);
      for (const box of boxes) {
        // Collect surrounding text: aria-label, aria-labelledby target, and up
        // to 4 ancestors' textContent. Terms checkboxes sit inside a wrapper
        // whose label is a sibling paragraph.
        let labelText = box.getAttribute("aria-label") ?? "";
        const labelledBy = box.getAttribute("aria-labelledby");
        if (labelledBy) {
          labelText += " " + (document.getElementById(labelledBy)?.textContent ?? "");
        }
        let parent: HTMLElement | null = box.parentElement;
        for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) {
          labelText += " " + (parent.textContent ?? "");
        }
        if (/agree|terms|conditions of purchase|purchase polic/i.test(labelText)) {
          const alreadyChecked = box.checked;
          if (!alreadyChecked) {
            box.scrollIntoView({ behavior: "auto", block: "center" });
            box.click();
          }
          return { found: true, alreadyChecked };
        }
      }
      return { found: false, alreadyChecked: false };
    }).catch(() => ({ found: false, alreadyChecked: false }));

    if (state.found) {
      trace(`[tm-rpa] Terms checkbox ${state.alreadyChecked ? "already ticked" : "ticked"}`);
      checkboxHandled = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  if (!checkboxHandled) {
    trace("[tm-rpa] Terms checkbox not found (page may not require it — continuing)");
  }

  // Step 2: click "Proceed to Payment".
  await page.waitForTimeout(500);
  const proceedDeadline = Date.now() + 10000;
  let lastDisabledLog = 0;
  while (Date.now() < proceedDeadline) {
    const state = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .filter(isVisible);
      const pattern = /^\s*proceed to payment\s*$/i;
      const btn = nodes.find(el => pattern.test((el.textContent ?? "").trim()));
      if (!btn) return { found: false, disabled: false, clicked: false };
      const disabled = btn.hasAttribute("disabled") ||
        btn.getAttribute("aria-disabled") === "true" ||
        (btn as HTMLButtonElement).disabled;
      if (disabled) return { found: true, disabled: true, clicked: false };
      btn.scrollIntoView({ behavior: "auto", block: "center" });
      btn.click();
      return { found: true, disabled: false, clicked: true };
    }).catch(() => ({ found: false, disabled: false, clicked: false }));

    if (state.clicked) {
      trace("[tm-rpa] Clicked Proceed to Payment");
      await page.waitForTimeout(2000);
      return true;
    }
    if (state.found && state.disabled && Date.now() - lastDisabledLog > 2000) {
      trace("[tm-rpa] Proceed to Payment still disabled — waiting");
      lastDisabledLog = Date.now();
    }
    await page.waitForTimeout(500);
  }
  trace("[tm-rpa] Proceed to Payment not reachable within 10s (user may need to click it manually)");
  return false;
}

/**
 * After Proceed to Payment, Ticketmaster navigates to payments.ticketmaster.com
 * with a "PAY WITH" section offering two radios: Credit / Debit Card, PayPal.
 * The form is REQUIRED and has no default — without a click the user is stuck.
 * Our default flow is self-pay with card, so auto-select Credit / Debit Card.
 */
async function selectCreditCardRadio(page: Page, trace: TraceFn): Promise<boolean> {
  // Wait for the payments page navigation + radio render (can take 3–8s).
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // Path 1: visible native radio input whose surrounding text mentions credit/debit.
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      for (const radio of radios) {
        let labelText = radio.getAttribute("aria-label") ?? "";
        const labelledBy = radio.getAttribute("aria-labelledby");
        if (labelledBy) {
          labelText += " " + (document.getElementById(labelledBy)?.textContent ?? "");
        }
        let parent: HTMLElement | null = radio.parentElement;
        for (let i = 0; parent && i < 5; i++, parent = parent.parentElement) {
          labelText += " " + (parent.textContent ?? "");
        }
        if (/credit\s*\/?\s*debit|credit card/i.test(labelText)) {
          const alreadySelected = radio.checked;
          if (!alreadySelected) {
            // Radios are often visually hidden — click the nearest visible label.
            const container = (radio.closest("label") ?? radio.parentElement) as HTMLElement | null;
            const clickTarget = (container && isVisible(container)) ? container : radio;
            clickTarget.scrollIntoView({ behavior: "auto", block: "center" });
            clickTarget.click();
            if (!radio.checked) radio.click(); // belt + suspenders
          }
          return { found: true, alreadySelected, path: "input" };
        }
      }

      // Path 2: no native radio matched — look for a clickable label / role="radio".
      const clickables = Array.from(document.querySelectorAll<HTMLElement>('label, [role="radio"], button, [role="button"]'))
        .filter(isVisible);
      const hit = clickables.find(el => /credit\s*\/?\s*debit\s*card/i.test((el.textContent ?? "").trim()));
      if (hit) {
        hit.scrollIntoView({ behavior: "auto", block: "center" });
        hit.click();
        return { found: true, alreadySelected: false, path: "label" };
      }

      return { found: false, alreadySelected: false, path: null };
    }).catch(() => ({ found: false, alreadySelected: false, path: null as string | null }));

    if (state.found) {
      trace(`[tm-rpa] Credit/Debit Card ${state.alreadySelected ? "already selected" : `selected via ${state.path}`}`);
      await page.waitForTimeout(1500); // let card form fields render
      return true;
    }
    await page.waitForTimeout(500);
  }
  trace("[tm-rpa] Credit/Debit Card radio not found within 20s — user may need to pick payment method manually");
  return false;
}

/**
 * Wait until the URL leaves auth.ticketmaster.com (user has signed in).
 * Returns true if sign-in completed, false on timeout.
 */
async function waitForAuthClear(page: Page, trace: TraceFn, timeoutMs = 10 * 60 * 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const url = (() => { try { return page.url(); } catch { return ""; } })();
    if (!url.includes("auth.ticketmaster")) {
      trace(`[tm-rpa] Auth cleared, now at: ${url.slice(0, 120)}`);
      return true;
    }
    if (Date.now() - lastLog > 30000) {
      trace("[tm-rpa] Waiting for user to sign in…");
      lastLog = Date.now();
    }
    await page.waitForTimeout(2000);
  }
  trace("[tm-rpa] Auth wait timed out (10 min)");
  return false;
}

/**
 * Main entry. Called from stagehand-executor as an early-return block when
 * the active page belongs to ticketmaster.com / ticketmaster.ca.
 */
export async function bookTicketmasterProgrammatic(
  page: Page,
  task: string,
  trace: TraceFn,
  _stagehand?: { act: (s: string) => Promise<unknown> },
  _getAllPages?: () => Page[]
): Promise<TicketmasterRpaResult> {
  const getUrl = () => { try { return page.url(); } catch { return ""; } };

  trace(`[tm-rpa] Starting Ticketmaster RPA. Current URL: ${getUrl().slice(0, 140)}`);

  // Auth gate (cookies may have expired).
  if (getUrl().includes("auth.ticketmaster")) {
    trace("[tm-rpa] Landed on auth URL — waiting for user sign-in");
    const ok = await waitForAuthClear(page, trace);
    if (!ok) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        needs_login: true,
        error: "User did not sign in within 10 minutes.",
      };
    }
  }

  const target = parseTargetDateTime(task);
  if (target) {
    trace(`[tm-rpa] Target: ${target.monthName} ${target.day}, ${target.year}${target.time ? ` @ ${target.time}` : ""}`);
  } else {
    trace("[tm-rpa] No date found in task — will fall back to first available showtime (typical for resident shows like Wicked/Hamilton)");
  }

  // Layer 1A: click calendar slot if we're on attraction/artist page (no /event/ yet).
  const urlBeforeCalendar = getUrl();
  const onEventAlready = urlBeforeCalendar.includes("/event/");
  if (!onEventAlready) {
    // Give the calendar a moment to render.
    await page.waitForTimeout(1500);
    let slotClicked = false;
    if (target) {
      // Advance the calendar to the target month if it's not already showing.
      await navigateToTargetMonth(page, target, trace);
      await page.waitForTimeout(500);
      slotClicked = await clickCalendarSlot(page, target, trace);
      if (!slotClicked) {
        trace("[tm-rpa] Target date not matched — falling back to first available slot");
        slotClicked = await clickFirstAvailableSlot(page, trace);
      }
    } else {
      slotClicked = await clickFirstAvailableSlot(page, trace);
    }

    if (slotClicked) {
      // Sidebar "Find Tickets" should appear ~1–2s after slot click.
      await page.waitForTimeout(1200);
      const findClicked = await clickFindTickets(page, trace);
      if (!findClicked) {
        trace("[tm-rpa] Find Tickets click failed after calendar slot — user may need to advance manually");
      }
      // Wait for navigation to /event/ page.
      await waitForEventPage(page, trace, 20000);
    }
  }

  // Auth gate mid-flow (clicking Find Tickets can trigger sign-in).
  if (getUrl().includes("auth.ticketmaster")) {
    trace("[tm-rpa] Auth redirect during navigation — waiting for sign-in");
    const ok = await waitForAuthClear(page, trace);
    if (!ok) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        needs_login: true,
        error: "User did not sign in within 10 minutes.",
      };
    }
  }

  // Layer 1B: wait for user to pick seats, then auto-click Reserve Tickets.
  // If we never made it to /event/, still poll in case user navigated manually.
  const reserved = await pollReserveTickets(page, trace);
  if (!reserved) {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      error: "User did not select seats within 10 minutes (Reserve Tickets never clicked).",
    };
  }

  // After Reserve Tickets, Ticketmaster may push us through a final auth step.
  await page.waitForTimeout(1500);
  if (getUrl().includes("auth.ticketmaster")) {
    trace("[tm-rpa] Post-reserve auth redirect — waiting for sign-in");
    const ok = await waitForAuthClear(page, trace);
    if (!ok) {
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        needs_login: true,
        error: "Sign-in required after Reserve Tickets but user did not complete it.",
      };
    }
  }

  // Wait for checkout URL so the normal guest/payment pipeline can take over.
  const checkoutDeadline = Date.now() + 15000;
  while (Date.now() < checkoutDeadline) {
    const u = getUrl();
    if (u.includes("checkout.ticketmaster") || u.includes("/checkout")) {
      trace(`[tm-rpa] Checkout reached: ${u.slice(0, 140)}`);
      // Let the order summary / Conditions of Purchase block finish rendering
      // before we try to tick the checkbox.
      await page.waitForTimeout(1500);
      const gatePassed = await passPaymentGate(page, trace);
      // Proceed to Payment navigates to payments.ticketmaster.com — wait for
      // that host, then auto-select Credit/Debit Card (our default flow).
      if (gatePassed) {
        const paymentsDeadline = Date.now() + 15000;
        while (Date.now() < paymentsDeadline) {
          const now = getUrl();
          if (now.includes("payments.ticketmaster") || now !== u) {
            trace(`[tm-rpa] Payment page reached: ${now.slice(0, 140)}`);
            break;
          }
          await page.waitForTimeout(500);
        }
        await selectCreditCardRadio(page, trace);
      }
      return { reached_checkout: true, currentUrl: getUrl(), activePage: page };
    }
    await page.waitForTimeout(500);
  }

  trace(`[tm-rpa] Did not reach checkout URL after Reserve Tickets. Final URL: ${getUrl().slice(0, 140)}`);
  return {
    reached_checkout: false,
    currentUrl: getUrl(),
    error: "Reserve Tickets clicked but checkout page did not load.",
  };
}
