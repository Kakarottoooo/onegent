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
import type { Locator, Page } from "playwright";
import { isTicketmasterDomainUrl } from "./ticketmaster-status";

type TraceFn = (msg: string) => void;

export interface TicketmasterRpaResult {
  reached_checkout: boolean;
  currentUrl: string;
  activePage?: Page;
  needs_login?: boolean;
  needs_user_choice?: boolean;
  handoff_ready?: boolean;
  summary?: string;
  error?: string;
}

export interface TargetDateTime {
  monthName: string;   // "May"
  monthIndex: number;  // 0-based (4 = May)
  day: number;         // 20
  year: number;        // 2026
  time?: string;       // "7:00 PM" — optional
}

// ── Stage classifier ────────────────────────────────────────────────────────
// Used to route the main flow and to emit clean trace lines. Each stage maps
// to a deterministic outcome:
//   artist_calendar   → click target slot OR stop with "select showtime"
//   event_seat_map    → poll Reserve Tickets; user selects seat in browser
//   ticket_selected   → Reserve Tickets enabled; click and continue
//   account           → hand off to user (sign-in / create-account boundary)
//   checkout          → handed off to existing guest/payment pipeline
//   unknown           → caller decides
export type TicketmasterStage =
  | "artist_calendar"
  | "event_seat_map"
  | "ticket_selected"
  | "account"
  | "checkout"
  | "unknown";

export interface TicketmasterStageSnapshot {
  url: string;
  hasSeatMap: boolean;
  hasYourTicketsPanel: boolean;
  hasSubtotal: boolean;
  hasReserveButton: boolean;
  reserveEnabled: boolean;
  hasSeatSelection: boolean;
  hasSignInHeading: boolean;
  hasEmailInput: boolean;
}

/**
 * Pure stage classifier — operates on a DOM snapshot so it can be unit-tested
 * without a live browser. Caller collects the snapshot via page.evaluate.
 */
export function classifyTicketmasterStage(
  snap: TicketmasterStageSnapshot,
): TicketmasterStage {
  const url = snap.url.toLowerCase();
  // Account stage: highest priority — never proceed past this boundary even
  // if other DOM signals are present (Ticketmaster sometimes layers a sign-in
  // overlay over the seat map).
  if (
    /\/auth\.|auth\.ticketmaster|\.ticketmaster\.[^/]+\/identity\b|\/login\b|\/signin\b|create.?account/i.test(url) ||
    snap.hasSignInHeading ||
    (snap.hasEmailInput && /sign.?in|create.?account|checkout/i.test(url))
  ) {
    return "account";
  }
  if (/checkout\.ticketmaster|\.ticketmaster\.[^/]+\/checkout\b|payments\.ticketmaster/i.test(url)) {
    return "checkout";
  }
  if (snap.hasReserveButton && snap.reserveEnabled && snap.hasSeatSelection) {
    return "ticket_selected";
  }
  if (snap.hasSeatMap || snap.hasYourTicketsPanel || snap.hasReserveButton || /\/event\//i.test(url)) {
    return "event_seat_map";
  }
  if (/\/artist\/|\/attraction\/|\/.+-tickets\//i.test(url)) {
    return "artist_calendar";
  }
  return "unknown";
}

async function readTicketmasterStageSnapshot(page: Page): Promise<TicketmasterStageSnapshot> {
  const url = (() => { try { return page.url(); } catch { return ""; } })();
  const dom = await page.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hasSeatMap = !!document.querySelector(
      'canvas, [data-testid*="seat" i], iframe[src*="seat" i], [class*="seat-map" i]'
    );
    const allText = (document.body?.innerText ?? "").toLowerCase();
    const hasYourTicketsPanel = /your tickets/i.test(document.body?.innerText ?? "");
    const hasSubtotal = /subtotal/i.test(document.body?.innerText ?? "");
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .filter(isVisible);
    // startsWith semantics — TM renders Reserve buttons with a trailing
    // chevron / arrow icon. Anchored regex would miss "Reserve Tickets >".
    const reserveBtn = buttons.find(el => {
      const t = (el.textContent ?? "").trim().toLowerCase();
      return t.startsWith("reserve tickets") ||
        t.startsWith("continue to checkout") ||
        t === "reserve" || t.startsWith("reserve ");
    });
    const hasReserveButton = !!reserveBtn;
    const reserveEnabled = !!reserveBtn && !(
      reserveBtn.hasAttribute("disabled") ||
      reserveBtn.getAttribute("aria-disabled") === "true" ||
      (reserveBtn as HTMLButtonElement).disabled
    );
    // "Seat selected" signal: a section/row/seat label rendered in the
    // right-hand Your Tickets panel — TM uses elements like
    //   "Section 100", "Row C", "Seat 3" or "100/C/3" patterns.
    const hasSeatSelection =
      /section\s+\w+.*\brow\s+\w+|\brow\s+\w+.*\bseat\s+\d+|sec(?:tion)?\s*\d+\s*[\/,]\s*row/i.test(allText) ||
      /\bsection\b.*\bseat\b/i.test(allText.slice(0, 4000));
    const hasSignInHeading = !!Array.from(
      document.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]')
    ).find(el => /sign in or create account|sign in|create account/i.test((el.textContent ?? "").trim()));
    const hasEmailInput = !!document.querySelector(
      'input[type="email"], input[name="email" i], input[id*="email" i], input[autocomplete="email"]'
    );
    return {
      hasSeatMap,
      hasYourTicketsPanel,
      hasSubtotal,
      hasReserveButton,
      reserveEnabled,
      hasSeatSelection,
      hasSignInHeading,
      hasEmailInput,
    };
  }).catch(() => ({
    hasSeatMap: false,
    hasYourTicketsPanel: false,
    hasSubtotal: false,
    hasReserveButton: false,
    reserveEnabled: false,
    hasSeatSelection: false,
    hasSignInHeading: false,
    hasEmailInput: false,
  }));
  return { url, ...dom };
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_ALIASES = new Map<string, number>([
  ...MONTH_NAMES.map((name, index) => [name, index] as const),
  ["jan", 0],
  ["feb", 1],
  ["mar", 2],
  ["apr", 3],
  ["jun", 5],
  ["jul", 6],
  ["aug", 7],
  ["sep", 8],
  ["sept", 8],
  ["oct", 9],
  ["nov", 10],
  ["dec", 11],
]);

function normalizeTargetTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.toUpperCase().replace(/\s+/g, " ");
}

function parseTaskTime(task: string): string | undefined {
  const timeMatch = task.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm))\b/i);
  return normalizeTargetTime(timeMatch?.[1]);
}

/**
 * Pull the target date/time out of the task string. ActivityCard.tsx builds
 * task text like: `Book tickets for "X" on May 20, 2026.` — we look for a
 * `${month} ${day}, ${year}` substring plus an optional "H:MM AM/PM" time.
 */
export function parseTargetDateTime(task: string): TargetDateTime | null {
  const isoMatch = task.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hour = isoMatch[4] == null ? null : parseInt(isoMatch[4], 10);
    const minute = isoMatch[5] == null ? null : parseInt(isoMatch[5], 10);
    if (monthIndex >= 0 && monthIndex < 12 && day >= 1 && day <= 31) {
      const time = hour == null || minute == null
        ? parseTaskTime(task)
        : normalizeTargetTime(`${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`);
      return {
        monthName: MONTH_NAMES[monthIndex].slice(0, 1).toUpperCase() + MONTH_NAMES[monthIndex].slice(1),
        monthIndex,
        day,
        year,
        time,
      };
    }
  }

  const monthPattern = new RegExp(
    `\\b(${Array.from(MONTH_ALIASES.keys()).join("|")})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`,
    "i"
  );
  const match = task.match(monthPattern);
  if (!match) return null;
  const monthName = match[1].toLowerCase().replace(/\.$/, "");
  const monthIndex = MONTH_ALIASES.get(monthName) ?? -1;
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (isNaN(day) || isNaN(year) || monthIndex < 0) return null;

  return {
    monthName: MONTH_NAMES[monthIndex].slice(0, 1).toUpperCase() + MONTH_NAMES[monthIndex].slice(1),
    monthIndex,
    day,
    year,
    time: parseTaskTime(task),
  };
}

async function safeScrollIntoView(locator: Locator): Promise<void> {
  // Stagehand v3 strips locator.scrollIntoViewIfNeeded — observed live:
  // "best.locator.scrollIntoViewIfNeeded is not a function" → caller crash.
  // Try Playwright's native first; fall back to locator.evaluate scrollIntoView;
  // last resort: silently skip (click({force:true}) handles offscreen).
  const loc = locator as unknown as {
    scrollIntoViewIfNeeded?: (opts?: { timeout?: number }) => Promise<void>;
    evaluate?: (fn: (el: Element) => void) => Promise<void>;
  };
  try {
    if (typeof loc.scrollIntoViewIfNeeded === "function") {
      await loc.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => { /* ignore */ });
      return;
    }
    if (typeof loc.evaluate === "function") {
      await loc.evaluate((el: Element) => {
        (el as HTMLElement).scrollIntoView({ behavior: "auto", block: "center" });
      }).catch(() => { /* ignore */ });
    }
  } catch {
    // any sync throw — caller can still click({force:true})
  }
}

async function locatorLabel(locator: Locator): Promise<string> {
  // Same defensive pattern as locatorLooksVisible — Stagehand v3 may
  // strip textContent / getAttribute on certain locator depths. Type-
  // guard before calling and swallow synchronous throws.
  const loc = locator as unknown as {
    textContent?: (opts?: { timeout?: number }) => Promise<string | null>;
    getAttribute?: (n: string, opts?: { timeout?: number }) => Promise<string | null>;
    evaluate?: <R>(fn: (el: Element) => R) => Promise<R>;
  };
  let text: string | null = "";
  let aria: string | null = "";
  let title: string | null = "";
  try {
    if (typeof loc.textContent === "function") {
      text = await loc.textContent({ timeout: 300 }).catch(() => "");
    }
    if (typeof loc.getAttribute === "function") {
      [aria, title] = await Promise.all([
        loc.getAttribute("aria-label", { timeout: 300 }).catch(() => ""),
        loc.getAttribute("title", { timeout: 300 }).catch(() => ""),
      ]);
    }
  } catch {
    // continue with whatever we got
  }
  // Final fallback: pull via locator.evaluate if available.
  if (!text && !aria && !title && typeof loc.evaluate === "function") {
    const blob = await loc.evaluate((el: Element) => {
      const e = el as HTMLElement;
      return [
        e.textContent ?? "",
        e.getAttribute("aria-label") ?? "",
        e.getAttribute("title") ?? "",
      ].join(" ");
    }).catch(() => "");
    return (blob ?? "").replace(/\s+/g, " ").trim();
  }
  return `${text ?? ""} ${aria ?? ""} ${title ?? ""}`.replace(/\s+/g, " ").trim();
}

async function locatorLooksVisible(locator: Locator): Promise<boolean> {
  // Stagehand v3 proxy aggressively strips locator-level inspection
  // methods. boundingBox / evaluate / isVisible may each throw
  // synchronously with "is not a function" depending on proxy depth —
  // observed live (job @ restart-3004-20260506T010207, then 010205):
  //   first crash:  "locator.boundingBox is not a function"
  //   second crash: "locator.evaluate is not a function"
  // Defensive: typeof-guard each path; if all are stripped, assume the
  // element is visible and let downstream click({timeout, force}) gate
  // the action. Never crash the whole RPA on a visibility check.
  try {
    const loc = locator as unknown as {
      boundingBox?: (opts?: { timeout?: number }) => Promise<{ width: number; height: number } | null>;
      isVisible?: (opts?: { timeout?: number }) => Promise<boolean>;
      evaluate?: <R>(fn: (el: Element) => R) => Promise<R>;
    };
    if (typeof loc.boundingBox === "function") {
      const box = await loc.boundingBox({ timeout: 300 }).catch(() => null);
      if (box) return box.width >= 24 && box.height >= 16;
    }
    if (typeof loc.isVisible === "function") {
      const ok = await loc.isVisible({ timeout: 300 }).catch(() => false);
      if (ok === true) return true;
    }
    if (typeof loc.evaluate === "function") {
      const ok = await loc.evaluate((el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width >= 24 && r.height >= 16;
      }).catch(() => false);
      if (typeof ok === "boolean") return ok;
    }
  } catch {
    // any unexpected synchronous throw → fall through to default
  }
  // All inspection paths stripped — assume visible; click will gate.
  return true;
}

function targetSlotScore(label: string, target: TargetDateTime): number {
  const lower = label.toLowerCase();
  if (!lower) return 0;
  let score = 0;
  const month = target.monthName.toLowerCase();
  const monthShort = month.slice(0, 3);
  if (lower.includes(month) || lower.includes(monthShort)) score += 3;
  const day = String(target.day);
  const dayPadded = day.padStart(2, "0");
  const dayRx = new RegExp(`\\b${day}(st|nd|rd|th)?\\b|\\b${dayPadded}\\b`);
  if (dayRx.test(lower)) score += 3;
  if (target.time && lower.includes(target.time.toLowerCase())) score += 2;
  if (lower.includes(String(target.year))) score += 1;
  return score;
}

async function openCalendarViewWithLocators(page: Page, trace: TraceFn): Promise<boolean> {
  const controls = page.locator('button, a, [role="button"], [role="tab"]');
  const count = Math.min(await controls.count().catch(() => 0), 160);
  for (let i = 0; i < count; i++) {
    const item = controls.nth(i);
    if (!(await locatorLooksVisible(item))) continue;
    const label = await locatorLabel(item);
    const lower = label.toLowerCase();
    if (!lower.includes("calendar") || lower.includes("add to calendar")) continue;
    await safeScrollIntoView(item);
    await item.click({ timeout: 1500, force: true }).catch(() => {});
    trace(`[tm-rpa] Opened calendar view via locator: "${label.slice(0, 80)}"`);
    await page.waitForTimeout(700);
    return true;
  }
  trace("[tm-rpa] Calendar view locator not found; continuing with current view");
  return false;
}

async function clickCalendarSlotWithLocators(page: Page, target: TargetDateTime, trace: TraceFn): Promise<boolean> {
  // HARD wallclock budget: this loop iterated 260 elements at ~600ms each
  // under Stagehand's stripped-locator timeouts → 156s hang per call,
  // pushing the worker step to 600s timeout. Cap the budget at 6s.
  const deadline = Date.now() + 6000;
  const controls = page.locator('a, button, [role="button"], [role="link"]');
  const count = Math.min(await controls.count().catch(() => 0), 80);
  let best: { locator: Locator; label: string; score: number } | null = null;
  const samples: string[] = [];
  for (let i = 0; i < count; i++) {
    if (Date.now() > deadline) {
      trace(`[tm-rpa] Locator slot scan budget exceeded at i=${i}/${count}`);
      break;
    }
    const item = controls.nth(i);
    if (!(await locatorLooksVisible(item))) continue;
    const label = await locatorLabel(item);
    if (!label) continue;
    const lower = label.toLowerCase();
    if (
      samples.length < 8 &&
      (/\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(label) ||
        MONTH_NAMES.some((month) => lower.includes(month) || lower.includes(month.slice(0, 3))))
    ) {
      samples.push(label.slice(0, 100));
    }
    const score = targetSlotScore(label, target);
    if (score >= (target.time ? 7 : 6) && (!best || score > best.score)) {
      best = { locator: item, label, score };
    }
  }
  if (!best) {
    trace(`[tm-rpa] Locator slot scan found no target; samples=${JSON.stringify(samples)}`);
    return false;
  }
  await safeScrollIntoView(best.locator);
  await best.locator.click({ timeout: 2000, force: true });
  trace(`[tm-rpa] Calendar slot clicked via locator: "${best.label.slice(0, 100)}" score=${best.score}`);
  return true;
}

async function clickFirstAvailableSlotWithLocators(page: Page, trace: TraceFn): Promise<boolean> {
  // Same 6s wallclock budget — see clickCalendarSlotWithLocators.
  const deadline = Date.now() + 6000;
  const controls = page.locator('a, button, [role="button"], [role="link"]');
  const count = Math.min(await controls.count().catch(() => 0), 80);
  const samples: string[] = [];
  for (let i = 0; i < count; i++) {
    if (Date.now() > deadline) {
      trace(`[tm-rpa] First-slot locator scan budget exceeded at i=${i}/${count}`);
      break;
    }
    const item = controls.nth(i);
    if (!(await locatorLooksVisible(item))) continue;
    const label = await locatorLabel(item);
    if (!label) continue;
    if (samples.length < 8 && /\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(label)) {
      samples.push(label.slice(0, 100));
    }
    if (!/^\s*\d{1,2}:\d{2}\s*(am|pm)\b/i.test(label)) continue;
    await safeScrollIntoView(item);
    await item.click({ timeout: 2000, force: true });
    trace(`[tm-rpa] Fallback slot clicked via locator: "${label.slice(0, 100)}"`);
    return true;
  }
  trace(`[tm-rpa] Locator fallback found no time slots; samples=${JSON.stringify(samples)}`);
  return false;
}

// startsWith semantics — "Find Tickets >" / "Find Tickets ›" / "Find Tickets❯"
// all match because TM renders the button label as text + chevron icon
// (sometimes a literal ">", sometimes a unicode arrow, sometimes SVG).
// The previous anchored regex /^\s*(find tickets...)\s*$/i missed all
// trailing-character variants — observed live with the screenshot showing
// "Find Tickets >".
export function looksLikeFindTicketsLabel(label: string): boolean {
  const trimmed = label.trim().toLowerCase();
  if (!trimmed) return false;
  return ["find tickets", "buy tickets", "get tickets"].some(p => trimmed.startsWith(p));
}

/**
 * Decide whether a drawer's text content matches the requested target
 * date/time well enough that we can click its Find Tickets control. Pure /
 * deterministic / no I/O — fully unit-testable.
 *
 * Used as a pre-click guard inside `clickFindTicketsWithDomScan` so the v1
 * runtime no longer clicks the FIRST Find-Tickets-shaped button on the page
 * when:
 *   - The user picked a different calendar slot earlier and the drawer is
 *     still showing a stale event.
 *   - The page has multiple Event Information drawers (multi-event listing
 *     pages), and the worker happened to find the wrong one.
 *   - A sponsored / search / header control happens to share the
 *     "Find Tickets" prefix but is not date/time-scoped.
 *
 * Behavior:
 *   - target === null  =>  matches=true, reason="no_target". This preserves
 *     the existing dateless-show fallback (Wicked / Hamilton residencies)
 *     where the calendar has no specific date and the executor accepts the
 *     first available drawer.
 *   - target with month+day matching the drawer text => matches=true.
 *   - target with target.time present and matching the drawer text =>
 *     matches=true even if month/day did not match (some drawers render
 *     time strongly and date in a separate component our text scrape may
 *     miss).
 *   - Otherwise matches=false, reason="no_match".
 */
export function drawerMatchesTarget(
  drawerText: string,
  target: TargetDateTime | null,
): {
  matches: boolean;
  reason: "no_target" | "month_day_and_time" | "month_day" | "time" | "no_match";
} {
  if (!target) return { matches: true, reason: "no_target" };
  const lower = (drawerText ?? "").toLowerCase();
  if (!lower.trim()) return { matches: false, reason: "no_match" };
  const monthLower = target.monthName.toLowerCase();
  const monthShort = monthLower.slice(0, 3);
  const dayStr = String(target.day);
  const dayPadded = dayStr.padStart(2, "0");
  const timeLower = (target.time ?? "").toLowerCase();
  const dayRx = new RegExp(`\\b${dayStr}(st|nd|rd|th)?\\b|\\b${dayPadded}\\b|/${dayStr}/|/${dayPadded}/|-${dayStr}-|-${dayPadded}-`);
  const monthMatch = lower.includes(monthLower) || lower.includes(monthShort);
  const dayMatch = dayRx.test(lower);
  const monthDayMatch = monthMatch && dayMatch;
  const timeMatch = timeLower !== "" && lower.includes(timeLower);
  if (monthDayMatch && timeMatch) return { matches: true, reason: "month_day_and_time" };
  if (monthDayMatch) return { matches: true, reason: "month_day" };
  if (timeMatch) return { matches: true, reason: "time" };
  return { matches: false, reason: "no_match" };
}

/**
 * Pure helper: pick the most relevant Ticketmaster-domain URL from a list of
 * tab URLs. Used by the executor when the active page drifts off a
 * Ticketmaster host (e.g. an ad/sponsor tab opened on click) and we want to
 * surface the canonical TM URL to the user as the handoff URL even though
 * the active `Page` is no longer trustworthy.
 *
 * Order of preference (most actionable first):
 *   1. checkout.ticketmaster.* / payments.ticketmaster.* (closest to
 *      transaction completion)
 *   2. /event/<id> URLs (seat selection in progress)
 *   3. /artist/<id> or *-tickets/ landing (calendar surface)
 *   4. auth.ticketmaster.* (account boundary; user knows what to do)
 *   5. Any other Ticketmaster-domain URL
 *
 * Non-Ticketmaster URLs are skipped. Empty input or all-non-TM input
 * returns null.
 */
export function pickPrimaryTicketmasterUrl(urls: ReadonlyArray<string>): string | null {
  if (!urls || urls.length === 0) return null;
  const tmUrls = urls.filter((u) => isTicketmasterDomainUrl(u));
  if (tmUrls.length === 0) return null;
  const score = (u: string): number => {
    const lower = u.toLowerCase();
    if (/(?:^|\W)(?:checkout|payments)\.ticketmaster\./i.test(lower)) return 5;
    if (/\/event\//i.test(lower)) return 4;
    if (/\/artist\/|-tickets\b/i.test(lower)) return 3;
    if (/auth\.ticketmaster|\/identity\b|\/login\b|\/signin\b/i.test(lower)) return 2;
    return 1;
  };
  return [...tmUrls].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export type TicketmasterProviderListingDecision =
  | { kind: "no_target"; matches: string[]; question: string }
  | { kind: "no_match"; matches: string[]; question: string }
  | { kind: "single_match"; matches: string[]; question: null }
  | { kind: "multiple_matches"; matches: string[]; question: string };

export function ticketmasterProviderListingDecision(
  listingTexts: ReadonlyArray<string>,
  target: TargetDateTime | null,
): TicketmasterProviderListingDecision {
  if (!target) {
    return {
      kind: "no_target",
      matches: [],
      question:
        "Which event date, city, and showtime should I use from this Ticketmaster page?",
    };
  }
  const matches = listingTexts
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0 && providerListingTextMatchesTarget(text, target))
    .slice(0, 8);
  if (matches.length === 1) return { kind: "single_match", matches, question: null };
  const dateLabel = formatTargetDate(target);
  if (matches.length > 1) {
    return {
      kind: "multiple_matches",
      matches,
      question: `Ticketmaster shows multiple matching listings for ${dateLabel}. Which showtime should I use?`,
    };
  }
  return {
    kind: "no_match",
    matches: [],
    question: `I opened Ticketmaster, but I could not find a listing for ${dateLabel}. Which visible event/date should I use?`,
  };
}

function providerListingTextMatchesTarget(text: string, target: TargetDateTime): boolean {
  const lower = text.toLowerCase();
  const monthLower = target.monthName.toLowerCase();
  const monthShort = monthLower.slice(0, 3);
  const dayStr = String(target.day);
  const dayPadded = dayStr.padStart(2, "0");
  const monthNumber = String(target.monthIndex + 1);
  const monthNumberPadded = monthNumber.padStart(2, "0");
  const dayRx = new RegExp(`\\b${dayStr}(st|nd|rd|th)?\\b|\\b${dayPadded}\\b`);
  const monthTextMatch = lower.includes(monthLower) || lower.includes(monthShort);
  const numericDateMatch =
    lower.includes(`${monthNumber}/${dayStr}`) ||
    lower.includes(`${monthNumber}/${dayPadded}`) ||
    lower.includes(`${monthNumberPadded}/${dayStr}`) ||
    lower.includes(`${monthNumberPadded}/${dayPadded}`);
  const monthDayMatch = (monthTextMatch && dayRx.test(lower)) || numericDateMatch;
  if (!monthDayMatch) return false;
  if (!target.time) return true;
  return lower.includes(target.time.toLowerCase());
}

function formatTargetDate(target: TargetDateTime): string {
  return `${target.monthName} ${target.day}, ${target.year}${target.time ? ` at ${target.time}` : ""}`;
}

function isProviderStartTask(task: string): boolean {
  return /provider-start page/i.test(task) ||
    /Start from this exact .+ (artist|performer|collection|search results|listing) page URL/i.test(task);
}

type ProviderListingClickResult =
  | { status: "clicked"; label: string; matchCount: number }
  | { status: "needs_choice"; question: string; matches: string[] }
  | { status: "no_match"; question: string; matches: string[] }
  | { status: "no_target"; question: string; matches: string[] };

async function clickProviderListingFindTickets(
  page: Page,
  target: TargetDateTime | null,
  trace: TraceFn,
): Promise<ProviderListingClickResult> {
  if (!target) {
    const decision = ticketmasterProviderListingDecision([], null);
    return {
      status: "no_target",
      question:
        decision.question ??
        "Which event date, city, and showtime should I use from this Ticketmaster page?",
      matches: [],
    };
  }
  const args = {
    monthLong: target.monthName.toLowerCase(),
    monthShort: target.monthName.slice(0, 3).toLowerCase(),
    monthNumber: String(target.monthIndex + 1),
    monthNumberPadded: String(target.monthIndex + 1).padStart(2, "0"),
    dayStr: String(target.day),
    dayPadded: String(target.day).padStart(2, "0"),
    timeLower: (target.time ?? "").toLowerCase(),
  };
  const source = `
(function() {
  var TARGET = ${JSON.stringify(args)};
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) return false;
    var s = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !(s && (s.visibility === "hidden" || s.display === "none" || Number(s.opacity || "1") === 0));
  }
  function normalizedText(el) {
    return String((el && (el.innerText || el.textContent)) || "").replace(/\\s+/g, " ").trim();
  }
  function looksLikeFindTickets(el) {
    var label = [
      normalizedText(el),
      el.getAttribute && el.getAttribute("aria-label") || "",
      el.getAttribute && el.getAttribute("title") || ""
    ].join(" ").replace(/\\s+/g, " ").trim().toLowerCase();
    if (label.indexOf("find my hotel") === 0) return false;
    return label.indexOf("find tickets") === 0 || label.indexOf("buy tickets") === 0 || label.indexOf("get tickets") === 0;
  }
  function matchesTarget(text) {
    var lower = String(text || "").toLowerCase();
    if (!lower) return false;
    var dayRx = new RegExp("\\\\b" + TARGET.dayStr + "(st|nd|rd|th)?\\\\b|\\\\b" + TARGET.dayPadded + "\\\\b");
    var monthTextMatch = lower.indexOf(TARGET.monthLong) >= 0 || lower.indexOf(TARGET.monthShort) >= 0;
    var numericDateMatch =
      lower.indexOf(TARGET.monthNumber + "/" + TARGET.dayStr) >= 0 ||
      lower.indexOf(TARGET.monthNumber + "/" + TARGET.dayPadded) >= 0 ||
      lower.indexOf(TARGET.monthNumberPadded + "/" + TARGET.dayStr) >= 0 ||
      lower.indexOf(TARGET.monthNumberPadded + "/" + TARGET.dayPadded) >= 0;
    var monthDayMatch = (monthTextMatch && dayRx.test(lower)) || numericDateMatch;
    if (!monthDayMatch) return false;
    if (!TARGET.timeLower) return true;
    return lower.indexOf(TARGET.timeLower) >= 0;
  }
  function rowScopeFor(el) {
    var current = el;
    var best = el;
    for (var hops = 0; current && hops < 8; hops++) {
      var text = normalizedText(current);
      if (text.length > normalizedText(best).length && text.length < 2500) best = current;
      if (matchesTarget(text) && /find tickets|buy tickets|get tickets/i.test(text)) return current;
      current = current.parentElement;
    }
    return best;
  }
  var selector = 'a, button, [role="button"], [role="link"]';
  var nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible).filter(looksLikeFindTickets);
  var matches = [];
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var scope = rowScopeFor(el);
    var text = normalizedText(scope);
    if (!matchesTarget(text)) continue;
    matches.push({ el: el, text: text.slice(0, 180) });
  }
  if (matches.length === 1) {
    matches[0].el.scrollIntoView({ behavior: "auto", block: "center" });
    matches[0].el.click();
    return { status: "clicked", label: matches[0].text, matchCount: 1 };
  }
  if (matches.length > 1) {
    return { status: "needs_choice", matches: matches.slice(0, 8).map(function(m) { return m.text; }) };
  }
  return { status: "no_match", matches: [] };
})()
`;
  const result = await page.evaluate(source).catch((err: Error) => {
    trace(`[tm-rpa] provider listing scan failed: ${err.message?.slice(0, 100)}`);
    return null;
  }) as null | { status?: string; label?: string; matchCount?: number; matches?: string[] };
  if (result?.status === "clicked") {
    trace(`[tm-rpa] Provider listing Find Tickets clicked: "${(result.label ?? "").slice(0, 120)}"`);
    return { status: "clicked", label: result.label ?? "", matchCount: result.matchCount ?? 1 };
  }
  const decision = ticketmasterProviderListingDecision(result?.matches ?? [], target);
  if (result?.status === "needs_choice" || decision.kind === "multiple_matches") {
    trace(`[tm-rpa] Provider listing needs user choice: matches=${(result?.matches ?? []).length}`);
    return {
      status: "needs_choice",
      question: decision.question ?? `Which showtime should I use for ${formatTargetDate(target)}?`,
      matches: result?.matches ?? [],
    };
  }
  trace(`[tm-rpa] Provider listing scan found no matching Find Tickets row for ${formatTargetDate(target)}`);
  return {
    status: "no_match",
    question:
      decision.question ??
      `I opened Ticketmaster, but I could not find a listing for ${formatTargetDate(target)}. Which visible event/date should I use?`,
    matches: [],
  };
}

async function clickFindTicketsWithDomScan(
  page: Page,
  trace: TraceFn,
  target: TargetDateTime | null,
): Promise<boolean> {
  // Pass the target month/day/time into the IIFE so the in-page filter can
  // reject drawers whose currently-shown event does NOT match what the user
  // asked for. The in-page predicate `drawerMatchesTargetInPage` mirrors the
  // pure `drawerMatchesTarget` helper exported above; tests pin the helper
  // and the IIFE keeps in lock-step by inlined regex source.
  const targetArg = target
    ? {
        monthLong: target.monthName.toLowerCase(),
        monthShort: target.monthName.slice(0, 3).toLowerCase(),
        dayStr: String(target.day),
        dayPadded: String(target.day).padStart(2, "0"),
        timeLower: (target.time ?? "").toLowerCase(),
      }
    : null;
  const source = `
(function() {
  var TARGET = ${JSON.stringify(targetArg)};
  var controls = [];
  var seen = new Set();
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) return false;
    var s = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (s && (s.visibility === "hidden" || s.display === "none" || Number(s.opacity || "1") === 0)) return false;
    return true;
  }
  function labelFor(el) {
    return [
      el.innerText || "",
      el.textContent || "",
      el.getAttribute && el.getAttribute("aria-label") || "",
      el.getAttribute && el.getAttribute("title") || ""
    ].join(" ").replace(/\\s+/g, " ").trim();
  }
  function looksLike(label) {
    var t = String(label || "").trim().toLowerCase();
    return t.indexOf("find tickets") === 0 || t.indexOf("buy tickets") === 0 || t.indexOf("get tickets") === 0;
  }
  function hasEventInfoAncestor(el) {
    var current = el;
    var hops = 0;
    while (current && hops < 8) {
      var text = String(current.innerText || current.textContent || "");
      if (/event information/i.test(text)) return true;
      current = current.parentElement;
      hops++;
    }
    return false;
  }
  function drawerScopeText(el) {
    var scope = el.closest && el.closest('aside, [role="dialog"], [aria-modal], section, div') || el;
    return String(scope.innerText || scope.textContent || "");
  }
  function drawerMatchesTargetInPage(text) {
    if (!TARGET) return { matches: true, reason: "no_target" };
    var lower = String(text || "").toLowerCase();
    if (!lower.replace(/\\s+/g, "").length) return { matches: false, reason: "no_match" };
    var dayRx = new RegExp("\\\\b" + TARGET.dayStr + "(st|nd|rd|th)?\\\\b|\\\\b" + TARGET.dayPadded + "\\\\b|/" + TARGET.dayStr + "/|/" + TARGET.dayPadded + "/|-" + TARGET.dayStr + "-|-" + TARGET.dayPadded + "-");
    var monthMatch = lower.indexOf(TARGET.monthLong) >= 0 || lower.indexOf(TARGET.monthShort) >= 0;
    var dayMatch = dayRx.test(lower);
    var monthDayMatch = monthMatch && dayMatch;
    var timeMatch = TARGET.timeLower !== "" && lower.indexOf(TARGET.timeLower) >= 0;
    if (monthDayMatch && timeMatch) return { matches: true, reason: "month_day_and_time" };
    if (monthDayMatch) return { matches: true, reason: "month_day" };
    if (timeMatch) return { matches: true, reason: "time" };
    return { matches: false, reason: "no_match" };
  }
  function add(el) {
    if (!el || seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    var label = labelFor(el);
    if (looksLike(label)) controls.push({ el: el, label: label });
  }
  function scanRoot(root, depth) {
    if (!root || depth > 4) return;
    var nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll('a, button, [role="button"], [role="link"], [aria-label*="Find Tickets" i], [data-testid*="find" i]'));
    } catch {}
    nodes.forEach(add);
    var all = [];
    try { all = Array.from(root.querySelectorAll("*")); } catch {}
    for (var i = 0; i < all.length && i < 2500; i++) {
      var child = all[i];
      if (child && child.shadowRoot) scanRoot(child.shadowRoot, depth + 1);
    }
  }
  var bodyText = String(document.body && (document.body.innerText || document.body.textContent) || "");
  var hasEventInfoPanel = /event information/i.test(bodyText);
  scanRoot(document, 0);
  // Step 1: keep only candidates inside the Event Information drawer
  // (or, fallback heuristic, in the right half of the viewport when the
  // panel exists somewhere on the page).
  controls = controls.filter(function(item) {
    if (!hasEventInfoPanel) return false;
    if (hasEventInfoAncestor(item.el)) return true;
    var r = item.el.getBoundingClientRect && item.el.getBoundingClientRect();
    return !!r && r.left > (window.innerWidth * 0.45);
  });
  // Step 2 (NEW): if a target date/time was supplied, score each candidate's
  // drawer scope text against the target and reject candidates whose drawer
  // does not match. This prevents the runtime from clicking the wrong
  // drawer when the user picked a different calendar slot earlier or the
  // page has multiple Event Information drawers.
  var rejected = 0;
  if (TARGET) {
    var matched = [];
    for (var k = 0; k < controls.length; k++) {
      var c = controls[k];
      var ds = drawerScopeText(c.el);
      var mm = drawerMatchesTargetInPage(ds);
      if (mm.matches) {
        c.matchReason = mm.reason;
        matched.push(c);
      } else {
        rejected++;
      }
    }
    controls = matched;
  }
  if (!controls.length) {
    return { clicked: false, candidates: 0, eventInfo: hasEventInfoPanel, rejected: rejected };
  }
  // Step 3: prefer drawers whose scope text actually contains
  // "event information" over a right-half-of-viewport fallback.
  controls.sort(function(a, b) {
    var aScope = a.el.closest && a.el.closest('aside, [role="dialog"], [aria-modal], section, div') || a.el;
    var bScope = b.el.closest && b.el.closest('aside, [role="dialog"], [aria-modal], section, div') || b.el;
    var ae = /event information/i.test(aScope.innerText || "") ? 1 : 0;
    var be = /event information/i.test(bScope.innerText || "") ? 1 : 0;
    return be - ae;
  });
  var chosen = controls[0];
  chosen.el.scrollIntoView({ behavior: "auto", block: "center" });
  chosen.el.click();
  return {
    clicked: true,
    label: chosen.label.slice(0, 120),
    candidates: controls.length,
    eventInfo: true,
    matchReason: chosen.matchReason || (TARGET ? "month_day_and_time" : "no_target"),
    rejected: rejected
  };
})()
`;
  const result = await page.evaluate(source).catch((err: Error) => {
    trace(`[tm-rpa] Find Tickets DOM scan failed: ${err.message?.slice(0, 80)}`);
    return null;
  });
  const clicked = result as null | { clicked?: boolean; label?: string; candidates?: number; eventInfo?: boolean; matchReason?: string; rejected?: number };
  if (clicked?.clicked) {
    trace(`[tm-rpa] Clicked Find Tickets via main-page DOM scan: "${(clicked.label ?? "").slice(0, 80)}" candidates=${clicked.candidates ?? 0} matchReason=${clicked.matchReason ?? "?"} rejected=${clicked.rejected ?? 0}`);
    return true;
  }
  if (clicked?.eventInfo) {
    if ((clicked.rejected ?? 0) > 0) {
      trace(`[tm-rpa] Event-info drawer visible but no Find Tickets candidate matched the target date/time (rejected=${clicked.rejected}); leaving page open for user retry`);
    } else {
      trace("[tm-rpa] Event-info drawer visible but Find Tickets not matched in main-page DOM scan");
    }
  }
  return false;
}

async function clickFindTicketsWithLocators(page: Page, trace: TraceFn): Promise<boolean> {
  const deadline = Date.now() + 3000;
  // Strategy A: Playwright :has-text() — substring-based, no regex. The
  // most reliable path when the button text has trailing chevrons/arrows.
  const hasTextSelectors = [
    'button:has-text("Find Tickets")',
    'a:has-text("Find Tickets")',
    '[role="button"]:has-text("Find Tickets")',
    '[role="link"]:has-text("Find Tickets")',
    'button:has-text("Buy Tickets")',
    'a:has-text("Buy Tickets")',
    'button:has-text("Get Tickets")',
  ];
  for (const sel of hasTextSelectors) {
    if (Date.now() > deadline) break;
    try {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      const visible = await locatorLooksVisible(loc);
      if (!visible) continue;
      await safeScrollIntoView(loc);
      await loc.click({ timeout: 2000, force: true });
      trace(`[tm-rpa] Clicked Find Tickets via :has-text("${sel}")`);
      return true;
    } catch (err) {
      trace(`[tm-rpa] Find Tickets :has-text strategy error sel="${sel}" — ${(err as Error).message?.slice(0, 60)}`);
    }
  }

  // Strategy B: scan all clickables, match via startsWith.
  const controls = page.locator('a, button, [role="button"], [role="link"]');
  const count = Math.min(await controls.count().catch(() => 0), 60);
  for (let i = 0; i < count; i++) {
    if (Date.now() > deadline) {
      trace(`[tm-rpa] Find Tickets locator scan budget exceeded at i=${i}/${count}`);
      break;
    }
    const item = controls.nth(i);
    if (!(await locatorLooksVisible(item))) continue;
    const label = await locatorLabel(item);
    if (!looksLikeFindTicketsLabel(label)) continue;
    await safeScrollIntoView(item);
    await item.click({ timeout: 2000, force: true });
    trace(`[tm-rpa] Clicked Find Tickets via locator scan: "${label.slice(0, 80)}"`);
    return true;
  }
  return false;
}

function parseMonthYearText(text: string): { monthIndex: number; year: number } | null {
  const lower = text.toLowerCase();
  const entries = Array.from(MONTH_ALIASES.entries()).sort((a, b) => b[0].length - a[0].length);
  const monthEntry = entries.find(([label]) => new RegExp(`\\b${label}\\.?\\b`, "i").test(lower));
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (!monthEntry || !yearMatch) return null;
  return { monthIndex: monthEntry[1], year: parseInt(yearMatch[1], 10) };
}

async function readCurrentCalendarMonthWithLocators(page: Page, trace: TraceFn): Promise<{ monthIndex: number; year: number } | null> {
  const controls = page.locator('button, a, [role="button"], [role="tab"], [aria-selected], [aria-current]');
  const count = Math.min(await controls.count().catch(() => 0), 220);
  let fallback: { monthIndex: number; year: number; label: string } | null = null;
  for (let i = 0; i < count; i++) {
    const item = controls.nth(i);
    const label = await locatorLabel(item);
    if (!label) continue;
    const parsed = parseMonthYearText(label);
    if (!parsed) continue;
    const selected = /selected|current|active/i.test(label);
    const hit = { ...parsed, label };
    if (selected) {
      trace(`[tm-rpa] Calendar month read via locator: "${label.slice(0, 80)}"`);
      return hit;
    }
    fallback ??= hit;
  }
  if (fallback) {
    trace(`[tm-rpa] Calendar month read via locator fallback: "${fallback.label.slice(0, 80)}"`);
    return { monthIndex: fallback.monthIndex, year: fallback.year };
  }
  trace("[tm-rpa] Calendar month locator fallback found no month/year labels");
  return null;
}

async function clickMonthNavWithLocators(page: Page, wantNext: boolean, trace: TraceFn): Promise<boolean> {
  const controls = page.locator('button, a, [role="button"]');
  const count = Math.min(await controls.count().catch(() => 0), 180);
  const labels = wantNext ? ["next month", "next"] : ["previous month", "previous", "prev month", "prev"];
  for (let i = 0; i < count; i++) {
    const item = controls.nth(i);
    if (!(await locatorLooksVisible(item))) continue;
    const label = (await locatorLabel(item)).toLowerCase();
    if (!labels.some((needle) => label === needle || label.includes(needle))) continue;
    await safeScrollIntoView(item);
    await item.click({ timeout: 1500, force: true });
    trace(`[tm-rpa] Month nav clicked via locator: "${label.slice(0, 80)}"`);
    return true;
  }
  return false;
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
    trace("[tm-rpa] Calendar month tab not found via evaluate; trying locator fallback");
    return await readCurrentCalendarMonthWithLocators(page, trace);
  }
  const parsed = parseMonthYearText(text);
  if (!parsed) {
    trace(`[tm-rpa] Could not parse current month from tab text: "${text.slice(0, 80)}"`);
    return await readCurrentCalendarMonthWithLocators(page, trace);
  }
  return parsed;
}

/**
 * Click the target month TAB directly (e.g. "June 2026") if visible.
 *
 * TM month strip is "Mar / Apr / **May** / Jun / Jul" (current selected).
 * Each tab has aria-label like "June 2026" or "June 2026, 33 Events" and
 * the active one is annotated "May 2026 selected, 31 Events".
 *
 * This is the CORRECT navigation primitive — `aria-label="next items"` is
 * the carousel scroll arrow (scrolls the tab strip horizontally without
 * changing the selected month). Observed live (job 16790107): clicking
 * "next items" 12 times still left "May 2026 selected" → infinite loop.
 *
 * Returns true if a target tab was found AND clicked.
 */
async function clickTargetMonthTab(
  page: Page,
  target: TargetDateTime,
  trace: TraceFn,
): Promise<boolean> {
  const monthName = target.monthName;
  const year = target.year;
  // Strategy A: aria-label exact-prefix match via Playwright locator.
  // `[aria-label^="June 2026"]` cannot match "next items" / chevrons.
  const ariaSelectors = [
    `button[aria-label^="${monthName} ${year}"]`,
    `[role="tab"][aria-label^="${monthName} ${year}"]`,
    `[role="button"][aria-label^="${monthName} ${year}"]`,
    `a[aria-label^="${monthName} ${year}"]`,
  ];
  for (const sel of ariaSelectors) {
    try {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      const visible = await locatorLooksVisible(loc);
      if (!visible) continue;
      await safeScrollIntoView(loc);
      await loc.click({ timeout: 1500, force: true });
      trace(`[tm-rpa] Month tab clicked via aria-label selector "${sel}"`);
      return true;
    } catch (err) {
      trace(`[tm-rpa] Month tab aria-label sel error sel="${sel}" — ${(err as Error).message?.slice(0, 60)}`);
    }
  }
  // Strategy B: page.evaluate scan for any element whose aria-label
  // STARTS WITH the month+year string AND is NOT the currently-selected
  // tab (avoid clicking the active tab — it's a no-op).
  const clickedTab = await page.evaluate((tab: { month: string; year: number }) => {
    const isVisible = (el: Element): boolean => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const prefix = `${tab.month} ${tab.year}`.toLowerCase();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="button"], a'))
      .filter(isVisible);
    const hit = nodes.find(el => {
      const aria = (el.getAttribute("aria-label") ?? "").toLowerCase().trim();
      // Exclude carousel scrollers — they have aria-label like
      // "next items" / "previous items" with NO month/year mention.
      if (/^(next|previous)\s+items?$/.test(aria)) return false;
      // Avoid the already-selected tab (clicking it is a no-op).
      if (aria.includes("selected")) return false;
      return aria.startsWith(prefix);
    });
    if (!hit) return false;
    hit.scrollIntoView({ behavior: "auto", block: "center" });
    hit.click();
    return true;
  }, { month: monthName, year }).catch(() => false);
  if (clickedTab) {
    trace(`[tm-rpa] Month tab clicked via evaluate aria-label prefix: "${monthName} ${year}"`);
    return true;
  }
  return false;
}

/**
 * Advance / rewind the calendar until the active month matches `target`.
 *
 * Strategy:
 *   1. Try clicking the target month TAB directly ("June 2026") — instant.
 *   2. If the target tab isn't currently in the visible strip, click the
 *      `aria-label="next items"` / `previous items` carousel scrollers to
 *      reveal more tabs, then retry.
 *
 * Caps at 12 hops so a bad DOM match can't infinite-loop.
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

    // Strategy 1: click the target month tab directly. Cheapest + most
    // reliable when the tab is visible in the strip.
    const direct = await clickTargetMonthTab(page, target, trace);
    if (direct) {
      await page.waitForTimeout(900);
      continue;
    }

    // Strategy 2: target tab is offscreen — scroll the carousel.
    // CRITICAL: only match strict aria-label, not substring "next" — the
    // previous match-anything-with-"next" caught "next items" (carousel)
    // ALSO when the actual "Next Month" tab existed; either way the
    // tab-direct click above runs FIRST, so this is now safe.
    const wantNext = diff > 0;
    const labels = wantNext
      ? ["next items", "next month", "next"]
      : ["previous items", "previous month", "prev month", "previous", "prev"];
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
      const locatorClicked = await clickMonthNavWithLocators(page, wantNext, trace);
      if (!locatorClicked) {
        trace(`[tm-rpa] Month nav: ${wantNext ? "next" : "previous"} button not found (diff=${diff})`);
        return false;
      }
    }
    trace(`[tm-rpa] Month nav: clicked ${wantNext ? "next" : "previous"} (current=${current.year}-${String(current.monthIndex + 1).padStart(2, "0")}, diff=${diff})`);
    await page.waitForTimeout(900);
  }
  trace("[tm-rpa] Month nav: exceeded 12 hops");
  return false;
}

/**
 * String-based page.evaluate that bypasses tsx function serialization.
 *
 * tsx (the worker's TS runtime) injects helper variables into transpiled
 * function bodies in some configurations — when those functions are then
 * serialized via Function.prototype.toString and shipped to Stagehand's
 * page.evaluate, the helpers reference globals that don't exist in the
 * page context, throwing "StagehandEvalError: Uncaught" — observed live
 * for cookie dismiss / clickCalendarSlot / clickFirstAvailableSlot.
 *
 * Passing the source as a STRING bypasses the function-to-string path
 * entirely; the page evaluates raw JS without tsx's helper injection.
 *
 * Also: evaluate-side el.click() seems to compound the StagehandEvalError
 * (the OpenTable provider's comment in stagehand-executor.ts:4720 documents
 * this). So we ONLY tag the winner with a data-attr inside evaluate, and
 * click via Playwright locator afterwards — separating concerns.
 */
async function evaluateAndTagBestSlot(
  page: Page,
  target: TargetDateTime,
  pickName: string,
): Promise<{ tagged: boolean; label: string; candidates: number; score: number }> {
  const args = {
    monthName: target.monthName,
    monthShort: target.monthName.slice(0, 3),
    day: target.day,
    year: target.year,
    time: target.time ?? "",
    pickName,
    minScore: target.time ? 7 : 6,
  };
  // String-based source — no tsx transpilation, no function serialization.
  // Each var is read from the JSON-injected `args` object.
  const source = `
(function() {
  var args = ${JSON.stringify(args)};
  var monthLower = args.monthName.toLowerCase();
  var monthShort = args.monthShort.toLowerCase();
  var dayStr = String(args.day);
  var dayPadded = dayStr.length === 1 ? "0" + dayStr : dayStr;
  var timeLower = (args.time || "").toLowerCase();
  var nodes = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"]'));
  var best = null;
  var candidates = 0;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (el.offsetWidth < 30 || el.offsetHeight < 20) continue;
    candidates++;
    var text = (el.textContent || "").toLowerCase().replace(/\\s+/g, " ").trim();
    var aria = (el.getAttribute("aria-label") || "").toLowerCase();
    var combined = text + " " + aria;
    if (!combined.trim()) continue;
    var score = 0;
    if (combined.indexOf(monthLower) >= 0 || combined.indexOf(monthShort) >= 0) score += 3;
    var dayRx = new RegExp("\\\\b" + dayStr + "(st|nd|rd|th)?\\\\b|\\\\b" + dayPadded + "\\\\b");
    if (dayRx.test(combined)) score += 3;
    if (timeLower && combined.indexOf(timeLower) >= 0) score += 2;
    if (combined.indexOf(String(args.year)) >= 0) score += 1;
    if (score >= args.minScore && (!best || score > best.score)) {
      best = { el: el, score: score, label: text.slice(0, 80) };
    }
  }
  if (!best) return { tagged: false, label: "", candidates: candidates, score: 0 };
  // Clear any prior tag (re-runs).
  var prior = document.querySelectorAll('[data-onegent-tm-pick="' + args.pickName + '"]');
  for (var j = 0; j < prior.length; j++) prior[j].removeAttribute("data-onegent-tm-pick");
  best.el.setAttribute("data-onegent-tm-pick", args.pickName);
  return { tagged: true, label: best.label, candidates: candidates, score: best.score };
})()
`;
  const r = await page.evaluate(source).catch(() => null);
  if (!r || typeof r !== "object") {
    return { tagged: false, label: "", candidates: 0, score: 0 };
  }
  const obj = r as { tagged?: boolean; label?: string; candidates?: number; score?: number };
  return {
    tagged: obj.tagged === true,
    label: obj.label ?? "",
    candidates: obj.candidates ?? 0,
    score: obj.score ?? 0,
  };
}

/**
 * Click the calendar/event slot that matches the target date (and time if
 * provided). Ticketmaster attraction pages list events as <a> or <button>
 * elements; we match by day number + month name in the visible text.
 */
async function clickCalendarSlot(page: Page, target: TargetDateTime, trace: TraceFn): Promise<boolean> {
  // Strategy 1: string-based evaluate scan + tag, then locator click.
  // Bypasses both StagehandEvalError AND slow 260-locator iteration.
  const tag = await evaluateAndTagBestSlot(page, target, "calendar-slot");
  trace(`[tm-rpa] Calendar slot scan: tagged=${tag.tagged} candidates=${tag.candidates} score=${tag.score} label="${tag.label.slice(0, 80)}"`);
  if (tag.tagged) {
    try {
      const loc = page.locator('[data-onegent-tm-pick="calendar-slot"]').first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        await safeScrollIntoView(loc);
        await loc.click({ timeout: 2500, force: true });
        trace(`[tm-rpa] Calendar slot clicked via tag locator: "${tag.label.slice(0, 80)}" score=${tag.score}`);
        return true;
      }
    } catch (err) {
      trace(`[tm-rpa] Calendar slot tag locator click failed: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  // Strategy 2: legacy function-based evaluate (kept for graceful degradation;
  // may still hit StagehandEvalError but won't crash thanks to .catch).
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
  if (await clickCalendarSlotWithLocators(page, target, trace)) {
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
  if (await clickFirstAvailableSlotWithLocators(page, trace)) {
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
async function clickFindTickets(
  page: Page,
  trace: TraceFn,
  target: TargetDateTime | null,
): Promise<boolean> {
  // Wait up to 16s for the button to render in the sidebar (TM renders
  // the panel asynchronously — 8s was not enough on slower hosts).
  const deadline = Date.now() + 16000;
  let loop = 0;
  while (Date.now() < deadline) {
    loop++;
    if (await clickFindTicketsWithDomScan(page, trace, target)) {
      return true;
    }
    // Inline secondary scan — kept as a defensive backup to the canonical
    // `clickFindTicketsWithDomScan` IIFE above. Applies the same drawer
    // date/time guard so the wrong-drawer click cannot leak through this
    // backup path either.
    const inlineTargetArg = target
      ? {
          monthLong: target.monthName.toLowerCase(),
          monthShort: target.monthName.slice(0, 3).toLowerCase(),
          dayStr: String(target.day),
          dayPadded: String(target.day).padStart(2, "0"),
          timeLower: (target.time ?? "").toLowerCase(),
        }
      : null;
    const inlineSource = `
(function() {
  var TARGET = ${JSON.stringify(inlineTargetArg)};
  function isVisible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function drawerScopeText(el) {
    var scope = el.closest && el.closest('aside, [role="dialog"], [aria-modal], section, div') || el;
    return String(scope.innerText || scope.textContent || "");
  }
  function drawerMatchesTargetInPage(text) {
    if (!TARGET) return true;
    var lower = String(text || "").toLowerCase();
    if (!lower.replace(/\\s+/g, "").length) return false;
    var dayRx = new RegExp("\\\\b" + TARGET.dayStr + "(st|nd|rd|th)?\\\\b|\\\\b" + TARGET.dayPadded + "\\\\b|/" + TARGET.dayStr + "/|/" + TARGET.dayPadded + "/|-" + TARGET.dayStr + "-|-" + TARGET.dayPadded + "-");
    var monthMatch = lower.indexOf(TARGET.monthLong) >= 0 || lower.indexOf(TARGET.monthShort) >= 0;
    var dayMatch = dayRx.test(lower);
    var timeMatch = TARGET.timeLower !== "" && lower.indexOf(TARGET.timeLower) >= 0;
    return (monthMatch && dayMatch) || timeMatch;
  }
  var hasEventInfoPanel = /event information/i.test(document.body && document.body.innerText || "");
  var selector = 'a, button, [role="button"], [role="link"]';
  var nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  var candidate = nodes.find(function(el) {
    if (!hasEventInfoPanel) return false;
    var r = el.getBoundingClientRect();
    if (r.left <= window.innerWidth * 0.45) return false;
    var t = (el.textContent || "").trim().toLowerCase();
    if (t.indexOf("find tickets") !== 0 && t.indexOf("buy tickets") !== 0 && t.indexOf("get tickets") !== 0) return false;
    if (TARGET && !drawerMatchesTargetInPage(drawerScopeText(el))) return false;
    return true;
  });
  if (candidate) {
    candidate.scrollIntoView({ behavior: "auto", block: "center" });
    candidate.click();
    return (candidate.textContent || "").trim();
  }
  return null;
})()
`;
    const clicked = await page.evaluate(inlineSource).catch(() => null);

    if (clicked) {
      trace(`[tm-rpa] Clicked Find Tickets: "${clicked}"`);
      return true;
    }
    if ((loop === 1 || loop % 5 === 0) && await clickFindTicketsWithLocators(page, trace)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  trace("[tm-rpa] Find Tickets button not found within 16s");
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

export function isTicketmasterTicketOptionsPage(url: string): boolean {
  // Anchor on the registrable Ticketmaster host set rather than a substring
  // regex. The previous /ticketmaster\./i test matched any URL with the
  // literal "ticketmaster." anywhere in the string, so an impersonation
  // host like "ticketmaster.com.evil.example/event/foo" was wrongly
  // accepted as a TM event page and could drive subsequent polling against
  // the wrong tab. Same hardening shape as `isTicketmasterDomainUrl` →
  // `pickPrimaryTicketmasterUrl` already enforce.
  if (!isTicketmasterDomainUrl(url)) return false;
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return pathname.includes("/event/");
}

async function hasTicketmasterSeatSelectionSurface(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return !!document.querySelector('canvas, [data-testid*="seat" i], iframe[src*="seat" i], [class*="seat-map" i]');
  }).catch(() => false);
}

type ReserveAttempt = "evaluate" | "locator-click" | "locator-evaluate";

/**
 * Multi-strategy click for the Reserve Tickets button. Each strategy is
 * traced once with kind + outcome; subsequent attempts only fire if the
 * previous returns false. Order is cheapest-first (DOM evaluate) → richest
 * (Playwright locator with full event chain).
 */
async function clickReserveTickets(page: Page, trace: TraceFn): Promise<boolean> {
  const strategies: Array<{ kind: ReserveAttempt; fn: () => Promise<boolean> }> = [
    {
      kind: "evaluate",
      fn: () => page.evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))
          .filter(isVisible);
        const btn = btns.find(el => {
          const t = (el.textContent ?? "").trim().toLowerCase();
          return t.startsWith("reserve tickets") ||
            t.startsWith("continue to checkout") ||
            t === "reserve" || t.startsWith("reserve ");
        });
        if (!btn) return false;
        btn.scrollIntoView({ behavior: "auto", block: "center" });
        btn.click();
        return true;
      }).catch(() => false),
    },
    {
      kind: "locator-click",
      fn: async () => {
        const loc = page.locator('button:has-text("Reserve Tickets"), [role="button"]:has-text("Reserve Tickets")').first();
        const count = await loc.count().catch(() => 0);
        if (count === 0) return false;
        const visible = await locatorLooksVisible(loc);
        if (!visible) return false;
        await safeScrollIntoView(loc);
        await loc.click({ timeout: 2000, force: true }).catch(() => {});
        return true;
      },
    },
    {
      kind: "locator-evaluate",
      fn: async () => {
        const loc = page.locator('button:has-text("Reserve Tickets"), [role="button"]:has-text("Reserve Tickets")').first();
        const count = await loc.count().catch(() => 0);
        if (count === 0) return false;
        const ok = await loc.evaluate((el) => {
          if ((el as HTMLButtonElement).disabled) return false;
          (el as HTMLElement).scrollIntoView({ behavior: "auto", block: "center" });
          (el as HTMLElement).click();
          return true;
        }).catch(() => false);
        return ok === true;
      },
    },
  ];
  for (const s of strategies) {
    const ok = await s.fn();
    trace(`[tm-rpa] Reserve click strategy=${s.kind} → ${ok ? "OK" : "miss"}`);
    if (ok) return true;
  }
  return false;
}

/**
 * Poll the "Reserve Tickets" button. Ticketmaster disables it until seats
 * are selected. We give the user up to 10min to pick seats — long enough for
 * anyone, short enough that abandoned sessions don't hang forever.
 *
 * Returns one of:
 *   "clicked"     — button became enabled and we clicked it
 *   "account"     — page transitioned to sign-in / create-account boundary
 *                   while waiting (user hit Reserve manually OR TM forces auth)
 *   "timeout"     — neither happened within timeoutMs
 */
async function pollReserveTickets(
  page: Page,
  trace: TraceFn,
  timeoutMs = 8 * 60 * 1000,
): Promise<"clicked" | "account" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const snap = await readTicketmasterStageSnapshot(page);
    const stage = classifyTicketmasterStage(snap);

    // Account stage gets priority — abandon polling immediately.
    if (stage === "account") {
      trace(`[tm-rpa] Reserve poll: account boundary reached (url=${snap.url.slice(0, 100)}) — stopping`);
      return "account";
    }
    if (snap.hasReserveButton && snap.reserveEnabled) {
      trace(`[tm-rpa] Reserve enabled (url=${snap.url.slice(0, 100)} yourTickets=${snap.hasYourTicketsPanel} subtotal=${snap.hasSubtotal} seatSel=${snap.hasSeatSelection}) — clicking`);
      const ok = await clickReserveTickets(page, trace);
      if (ok) return "clicked";
      // Click failed (rare); keep polling.
    }
    if (Date.now() - lastLog > 20000) {
      trace(
        `[tm-rpa] Reserve poll: stage=${stage} ` +
        `url=${snap.url.slice(0, 80)} ` +
        `yourTickets=${snap.hasYourTicketsPanel} subtotal=${snap.hasSubtotal} ` +
        `reserve=${snap.hasReserveButton ? (snap.reserveEnabled ? "enabled" : "disabled") : "absent"} ` +
        `seatSelected=${snap.hasSeatSelection}`
      );
      lastLog = Date.now();
    }
    await page.waitForTimeout(2000);
  }
  trace("[tm-rpa] Reserve Tickets poll timed out (8 min)");
  return "timeout";
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

  // Initial stage assessment — if we landed on the account/sign-in page,
  // immediately hand off to user. Do NOT block 10 minutes.
  const startSnap = await readTicketmasterStageSnapshot(page);
  const startStage = classifyTicketmasterStage(startSnap);
  trace(`[tm-rpa] Initial stage: ${startStage} (yourTickets=${startSnap.hasYourTicketsPanel} reserve=${startSnap.hasReserveButton}/${startSnap.reserveEnabled} seatMap=${startSnap.hasSeatMap})`);
  if (startStage === "account") {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      activePage: page,
      needs_login: true,
      handoff_ready: true,
      summary: "Ticketmaster needs you to sign in to continue. Open the live browser to complete sign-in — we won't enter account details for you.",
    };
  }

  const target = parseTargetDateTime(task);
  const providerStartTask = isProviderStartTask(task);
  if (target) {
    trace(`[tm-rpa] Target: ${target.monthName} ${target.day}, ${target.year}${target.time ? ` @ ${target.time}` : ""}`);
  } else {
    trace("[tm-rpa] No date found in task — will fall back to first available showtime (typical for resident shows like Wicked/Hamilton)");
  }
  if (providerStartTask && !target) {
    const decision = ticketmasterProviderListingDecision([], null);
    trace("[tm-rpa] Provider-start task has no target date/time; pausing for user event choice");
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      activePage: page,
      needs_user_choice: true,
      handoff_ready: true,
      summary:
        decision.question ??
        "Which event date, city, and showtime should I use from this Ticketmaster page?",
    };
  }

  // Layer 1A: click calendar slot if we're on attraction/artist page (no /event/ yet).
  const urlBeforeCalendar = getUrl();
  const onEventAlready = urlBeforeCalendar.includes("/event/");
  if (!onEventAlready) {
    // Give the calendar a moment to render.
    await page.waitForTimeout(1500);
    let slotClicked = false;
    let providerListingClicked = false;
    if (target) {
      const providerListing = await clickProviderListingFindTickets(page, target, trace).catch((err: Error) => {
        trace(`[tm-rpa] clickProviderListingFindTickets threw (continuing): ${err.message?.slice(0, 80)}`);
        return null;
      });
      if (providerListing?.status === "clicked") {
        slotClicked = true;
        providerListingClicked = true;
      } else if (providerStartTask && providerListing?.status === "needs_choice") {
        return {
          reached_checkout: false,
          currentUrl: getUrl(),
          activePage: page,
          needs_user_choice: true,
          handoff_ready: true,
          summary: providerListing.question,
        };
      }
      // Locator-based helpers may throw "X is not a function" under
      // Stagehand v3 proxy stripping. Wrap each so a single helper crash
      // can't kill the whole RPA — primary page.evaluate paths take over.
      if (!slotClicked) {
        await openCalendarViewWithLocators(page, trace).catch((err: Error) => {
          trace(`[tm-rpa] openCalendarView via-locators threw (continuing): ${err.message?.slice(0, 80)}`);
        });
        await navigateToTargetMonth(page, target, trace).catch((err: Error) => {
          trace(`[tm-rpa] navigateToTargetMonth threw (continuing): ${err.message?.slice(0, 80)}`);
        });
        await page.waitForTimeout(500);
        slotClicked = await clickCalendarSlot(page, target, trace).catch((err: Error) => {
          trace(`[tm-rpa] clickCalendarSlot threw (continuing): ${err.message?.slice(0, 80)}`);
          return false;
        });
      }
      if (!slotClicked) {
        const decision = ticketmasterProviderListingDecision([], target);
        trace("[tm-rpa] Target date not matched — pausing for user event choice");
        return {
          reached_checkout: false,
          currentUrl: getUrl(),
          activePage: page,
          needs_user_choice: true,
          handoff_ready: true,
          summary:
            decision.question ??
            `I opened Ticketmaster, but I could not find a listing for ${formatTargetDate(target)}. Which visible event/date should I use?`,
        };
      }
    } else {
      slotClicked = await clickFirstAvailableSlot(page, trace).catch((err: Error) => {
        trace(`[tm-rpa] clickFirstAvailableSlot threw (continuing): ${err.message?.slice(0, 80)}`);
        return false;
      });
    }

    if (slotClicked) {
      // Sidebar "Find Tickets" should appear ~1–2s after slot click.
      await page.waitForTimeout(1200);
      if (!providerListingClicked) {
        const findClicked = await clickFindTickets(page, trace, target);
        if (!findClicked) {
          trace("[tm-rpa] Find Tickets click failed after calendar slot — user may need to advance manually");
        }
      }
      // Wait for navigation to /event/ page.
      await waitForEventPage(page, trace, 20000);
    }
  }

  // Auth gate mid-flow (clicking Find Tickets can trigger sign-in).
  // Treat as a handoff boundary, not a 10-min blocker.
  {
    const midSnap = await readTicketmasterStageSnapshot(page);
    if (classifyTicketmasterStage(midSnap) === "account") {
      trace("[tm-rpa] Auth boundary mid-flow (post Find-Tickets) — handing off");
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        activePage: page,
        needs_login: true,
        handoff_ready: true,
        summary: "Ticketmaster prompted for sign-in after the calendar selection. Open the live browser to sign in — we won't enter account details for you.",
      };
    }
  }

  // Layer 1B: keep watching while the user chooses a ticket option. Once the
  // Reserve/Continue button becomes enabled, click it and continue to the next
  // page. If no selection happens within the bounded wait, return a clean
  // reviewable state instead of timing out the worker step.
  const ticketOptionsReady =
    isTicketmasterTicketOptionsPage(getUrl()) ||
    await hasTicketmasterSeatSelectionSurface(page);
  if (ticketOptionsReady) {
    trace(`[tm-rpa] Ticket options page ready; waiting for user ticket selection: ${getUrl().slice(0, 140)}`);
  } else {
    trace(`[tm-rpa] Ticket options surface not confirmed yet; watching for Reserve/Continue: ${getUrl().slice(0, 140)}`);
  }

  const pollResult = await pollReserveTickets(page, trace);
  if (pollResult === "account") {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      activePage: page,
      needs_login: true,
      handoff_ready: true,
      summary: "Ticketmaster moved to the sign-in / create-account step. Open the live browser to sign in — we won't enter account details for you.",
    };
  }
  if (pollResult === "timeout") {
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      activePage: page,
      handoff_ready: true,
      summary: ticketOptionsReady
        ? "Ticketmaster is waiting for a ticket option. Choose an option in the browser to continue."
        : "Ticketmaster opened, but the ticket options were not selected automatically. Review the browser page to continue.",
    };
  }

  // After Reserve Tickets, Ticketmaster may push us through a final auth step.
  // Same boundary policy: hand off, do NOT block 10 minutes.
  await page.waitForTimeout(1500);
  {
    const postReserveSnap = await readTicketmasterStageSnapshot(page);
    if (classifyTicketmasterStage(postReserveSnap) === "account") {
      trace("[tm-rpa] Post-reserve auth boundary — handing off");
      return {
        reached_checkout: false,
        currentUrl: getUrl(),
        activePage: page,
        needs_login: true,
        handoff_ready: true,
        summary: "Ticketmaster needs you to sign in or create an account before payment. Open the live browser — we won't enter account details for you.",
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
