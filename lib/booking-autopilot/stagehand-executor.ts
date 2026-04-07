/**
 * stagehand-executor.ts
 *
 * Universal AI-driven browser executor.
 * Uses Stagehand + Claude vision to navigate any booking website and fill forms.
 * Replaces the hardcoded opentable.ts / booking-com.ts / kayak-flights.ts scripts.
 *
 * Production: runs on Browserbase (cloud browser, bot evasion, no Vercel timeout).
 * Development: runs on local Playwright (no API key required).
 */

import { Stagehand } from "@browserbasehq/stagehand";
import type { Frame, Locator, Page } from "playwright";
import type { BrowserTaskInput, BrowserTaskResult } from "./types";
import { writeAgentLog } from "../db";
import { browserSessionStore } from "../browser-session-store";
import fs from "fs";
import path from "path";

/** URL patterns that indicate we've reached a payment/checkout page. */
const PAYMENT_URL_PATTERNS = [
  "/checkout",
  "/payment",
  "/billing",
  "/reserve/confirm",
  "/book/confirm",
  "/finalize",
  "/pay",
  "/purchase",
  "secure.booking.com/book",   // Booking.com checkout page (book.html)
  "secure.booking.com/s/",     // Booking.com secure booking flow
];

/** Keywords in page content that suggest a payment gate. */
const PAYMENT_KEYWORDS = [
  "credit card",
  "credit or debit card",
  "card number",
  "cvv",
  "expiry",
  "expiration",
  "payment method",
  "card details",
  "billing information",
  "pay now",
  "complete purchase",
  "complete booking",
  "confirm and pay",
];

/** URLs that are usually tracking, captcha, or other non-booking side frames. */
const NON_BOOKING_SCOPE_URL_PATTERNS = [
  /recaptcha/i,
  /google-analytics/i,
  /googletagmanager/i,
  /doubleclick/i,
  /applepay/i,
  /cdn-apple/i,
  /weglot/i,
  /accessibe/i,
  /acsbapp/i,
  /performance\.squarespace/i,
];

/** URLs that strongly suggest a real booking widget / checkout surface. */
const BOOKING_SCOPE_URL_PATTERNS = [
  /namastay/i,
  /booking/i,
  /checkout/i,
  /reservation/i,
  /reserve/i,
  /guest/i,
  /payment/i,
  /book/i,
  /engine/i,
  /stay/i,
];

function isPaymentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PAYMENT_URL_PATTERNS.some((p) => lower.includes(p));
}

type InteractionScope = Page | Frame;
type FieldSpec = { patterns: string[]; value: string };
type RequestedStayDates = { checkin?: string; checkout?: string };
type FieldCategory = { key: string; patterns: string[] };
type EffectiveProfile = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
};
type AgentExecutionResult = {
  message?: string;
  output?: string;
};
type BookingStage =
  | "blocked"
  | "listing"
  | "date_selection"
  | "room_selection"
  | "intermediate_gate"
  | "checkout_form"
  | "payment_gate"
  | "unknown";
type BookingStageAssessment = {
  stage: BookingStage;
  reason: string;
  currentUrl: string;
  pageText: string;
  hitPaymentUrl: boolean;
  hitPaymentGate: boolean;
  visibleCheckoutFields: boolean;
  stalledAtDateSelection: boolean;
  stalledAtRoomSelection: boolean;
  stalledAtIntermediateBookNow: boolean;
  listingSignals: boolean;
  bookingProgressSignals: boolean;
  blocked: boolean;
};

const COMMON_DISALLOWED_ADVANCE_BUTTONS = [
  /next slide/i,
  /previous slide/i,
  /add more rooms/i,
  /promo code/i,
  /close icon/i,
  /^close$/i,
  /manage cookies/i,
  /accept all/i,
  /decline all/i,
  /directory/i,
];
// Prefix-match to tolerate trailing icons/whitespace on button labels.
const DATE_SELECTION_ADVANCE_BUTTONS = [/^next\b/i, /^continue\b/i, /^check\s+availability/i, /^show\s+rooms/i];
const ROOM_SELECTION_ADVANCE_BUTTONS = [
  /^select\s+room/i,
  /^proceed\s+to\s+payment/i,
  /^select$/i,
  /^continue\b/i,
  /^reserve$/i,
  /^i['']ll\s+reserve/i,
  /^reserve\s+now/i,
  /^next\b/i,
];
// Use prefix-match (not strict ^…$) to handle buttons that have trailing icons,
// arrows, or whitespace appended to the label, e.g. "Book Now →" or "Book Now ".
const INTERMEDIATE_GATE_ADVANCE_BUTTONS = [/^book\s+now/i, /^reserve\s+now/i, /^reserve$/i];

const CHECKOUT_FIELD_CATEGORIES: FieldCategory[] = [
  { key: "full_name", patterns: ["full name"] },
  { key: "first_name", patterns: ["first name", "given name", "firstname"] },
  { key: "last_name", patterns: ["last name", "family name", "surname", "lastname"] },
  { key: "email", patterns: ["email", "e-mail"] },
  { key: "phone", patterns: ["phone", "mobile", "telephone"] },
  { key: "street", patterns: ["street address", "address line 1", "address 1", "billing address"] },
  { key: "city", patterns: ["city"] },
  { key: "state", patterns: ["state", "province"] },
  { key: "zip", patterns: ["zip", "postal code", "postcode"] },
  { key: "country", patterns: ["country"] },
  { key: "cardholder", patterns: ["name on card", "cardholder", "card holder"] },
  { key: "card_number", patterns: ["card number", "credit card number"] },
  { key: "card_expiry", patterns: ["expir", "expiry", "expiration", "mm/yy", "mm / yy"] },
];

function getRawPage(stagehandPage: unknown): Page {
  return (((stagehandPage as { page?: Page }).page ?? stagehandPage) as Page);
}

function getScopeUrl(scope: unknown): string {
  if (!scope || typeof scope !== "object") return "";

  const candidate = scope as {
    url?: (() => string) | string;
  };

  try {
    if (typeof candidate.url === "function") {
      return candidate.url();
    }
    if (typeof candidate.url === "string") {
      return candidate.url;
    }
  } catch {
    // Ignore and fall through.
  }

  return "";
}

function isBookingComUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("booking.com") || lower.includes("secure.booking.com");
}

function isBookingComSearchResultsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes("booking.com/searchresults");
}

function isNoiseScopeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return NON_BOOKING_SCOPE_URL_PATTERNS.some((pattern) => pattern.test(lower));
}

function isLikelyBookingScopeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BOOKING_SCOPE_URL_PATTERNS.some((pattern) => pattern.test(lower));
}

function getInteractionScopes(rawPage: Page): InteractionScope[] {
  const childFrames = rawPage.frames().filter((frame) => frame !== rawPage.mainFrame());
  const usableFrames = childFrames.filter((frame) => !isNoiseScopeUrl(getScopeUrl(frame)));
  const bookingFrames = usableFrames.filter((frame) => isLikelyBookingScopeUrl(getScopeUrl(frame)));
  const mainUrl = getScopeUrl(rawPage);
  const mainScope = isNoiseScopeUrl(mainUrl) ? [] : [rawPage];

  if (bookingFrames.length > 0) {
    return [...bookingFrames, ...(isLikelyBookingScopeUrl(mainUrl) ? mainScope : [])];
  }

  if (isLikelyBookingScopeUrl(mainUrl)) {
    return [...mainScope, ...usableFrames];
  }

  return [...usableFrames, ...mainScope];
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLooseText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function extractRequestedStayDates(task: string): RequestedStayDates {
  // Match both "check-in: YYYY-MM-DD" and "checking in YYYY-MM-DD" patterns.
  const checkin = task.match(/check(?:ing)?-?\s*in(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  const checkout = task.match(/check(?:ing)?-?\s*out(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  return { checkin, checkout };
}

function extractTargetHotelName(task: string): string | undefined {
  const patterns = [
    /find\s+(.+?)\s+hotel\s+in\s+.+?\s+and\s+book/i,
    /book a room at\s+(.+?)(?:\.|preferred|check-?in|check in|$)/i,
    /hotel\s*:\s*(.+?)(?:\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = task.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  return undefined;
}

function extractTargetHotelNameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const ss = parsed.searchParams.get("ss")?.trim();
    if (ss) return ss;
  } catch {
    // Ignore invalid URLs.
  }
  return undefined;
}

function extractTaskField(task: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = task.match(new RegExp(`(?:^|\\n)\\s*-?\\s*${escapedLabel}\\s*:\\s*(.+)`, "im"));
  return match?.[1]?.trim() || undefined;
}

function splitFullName(fullName?: string): { first_name?: string; last_name?: string } {
  if (!fullName) return {};
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.at(-1),
  };
}

function buildEffectiveProfile(
  profile: BrowserTaskInput["profile"],
  task: string
): EffectiveProfile {
  const taskFullName = extractTaskField(task, "Full name");
  const taskCardholderName = extractTaskField(task, "Cardholder name");
  const splitName = splitFullName(taskFullName);

  const merged: EffectiveProfile = {
    full_name: taskFullName || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || undefined,
    first_name: profile.first_name || splitName.first_name,
    last_name: profile.last_name || splitName.last_name,
    email: profile.email || extractTaskField(task, "Email"),
    phone: profile.phone || extractTaskField(task, "Phone"),
    address_line1: profile.address_line1 || extractTaskField(task, "Street"),
    city: profile.city || extractTaskField(task, "City"),
    state: profile.state || extractTaskField(task, "State"),
    zip: profile.zip || extractTaskField(task, "ZIP"),
    country: profile.country || extractTaskField(task, "Country"),
    card_name: profile.card_name || taskCardholderName || taskFullName,
    card_number: profile.card_number || extractTaskField(task, "Card number"),
    card_expiry: profile.card_expiry || extractTaskField(task, "Expiry date"),
  };

  if (!merged.full_name) {
    merged.full_name = [merged.first_name, merged.last_name].filter(Boolean).join(" ") || undefined;
  }

  // Normalize US phone: strip leading country code "1" from 11-digit numbers.
  // e.g. "12235331053" → "2235331053" so the agent doesn't double-enter the +1
  // prefix that many US phone fields already show.
  if (merged.phone) {
    const digits = merged.phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      merged.phone = digits.slice(1);
    }
  }

  return merged;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function waitForPageSignals(
  rawPage: Page,
  options: {
    fromUrl?: string;
    untilUrlIncludes?: string[];
    untilUrlExcludes?: string[];
    untilTextIncludes?: string[];
    untilTextExcludes?: string[];
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  const {
    fromUrl,
    untilUrlIncludes = [],
    untilUrlExcludes = [],
    untilTextIncludes = [],
    untilTextExcludes = [],
    timeoutMs = 6000,
  } = options;

  return waitForEvaluateCondition(
    rawPage,
    ({ fromUrl, untilUrlIncludes, untilUrlExcludes, untilTextIncludes, untilTextExcludes }) => {
      const href = window.location.href.toLowerCase();
      const text = (document.body?.innerText ?? "").toLowerCase();

      const urlChanged = !!fromUrl && href !== fromUrl.toLowerCase();
      const urlIncludesOk =
        untilUrlIncludes.length === 0 || untilUrlIncludes.some((pattern) => href.includes(pattern));
      const urlExcludesOk =
        untilUrlExcludes.length === 0 || untilUrlExcludes.every((pattern) => !href.includes(pattern));
      const textIncludesOk =
        untilTextIncludes.length === 0 || untilTextIncludes.some((pattern) => text.includes(pattern));
      const textExcludesOk =
        untilTextExcludes.length === 0 || untilTextExcludes.every((pattern) => !text.includes(pattern));

      return urlChanged || (urlIncludesOk && urlExcludesOk && textIncludesOk && textExcludesOk);
    },
    {
      fromUrl,
      untilUrlIncludes: untilUrlIncludes.map((value) => value.toLowerCase()),
      untilUrlExcludes: untilUrlExcludes.map((value) => value.toLowerCase()),
      untilTextIncludes: untilTextIncludes.map((value) => value.toLowerCase()),
      untilTextExcludes: untilTextExcludes.map((value) => value.toLowerCase()),
    },
    timeoutMs
  );
}

async function waitForVisibleActionText(
  rawPage: Page,
  texts: string[],
  timeoutMs = 4000
): Promise<boolean> {
  const normalizedTexts = texts.map((value) => normalizeLooseText(value));
  return waitForEvaluateCondition(
    rawPage,
    (patterns) => {
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      return Array.from(document.querySelectorAll("button, a, [role='button']")).some((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.textContent ?? "");
        return patterns.some((pattern) => text.includes(pattern));
      });
    },
    normalizedTexts,
    timeoutMs
  );
}

async function waitForEvaluateCondition<TArg>(
  rawPage: Page,
  evaluator: (arg: TArg) => boolean,
  arg: TArg,
  timeoutMs = 6000,
  intervalMs = 200
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = await rawPage.evaluate(evaluator, arg).catch(() => false);
    if (matched) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function safePressEscape(rawPage: Page): Promise<void> {
  try {
    const candidate = rawPage as Page & {
      keyboard?: { press?: (key: string) => Promise<unknown> };
    };
    if (candidate.keyboard?.press) {
      await candidate.keyboard.press("Escape");
      return;
    }
  } catch {
    // Fall through to DOM-dispatch fallback.
  }

  await rawPage.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, cancelable: true }));
  }).catch(() => {});
}

async function safeMouseClick(rawPage: Page, x: number, y: number): Promise<void> {
  try {
    const candidate = rawPage as Page & {
      mouse?: { click?: (x: number, y: number, options?: { delay?: number }) => Promise<unknown> };
    };
    if (candidate.mouse?.click) {
      await candidate.mouse.click(x, y, { delay: 80 });
      return;
    }
  } catch {
    // Fall through to DOM-dispatch fallback.
  }

  await rawPage.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!element) return;
      const options = { bubbles: true, cancelable: true, clientX: x, clientY: y };
      element.dispatchEvent(new MouseEvent("pointerdown", options));
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", options));
      element.dispatchEvent(new MouseEvent("click", options));
      element.click?.();
    },
    { x, y }
  ).catch(() => {});
}

async function revealBookingComRoomSelection(
  rawPage: Page,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const beforeUrl = rawPage.url();

  await safePressEscape(rawPage);

  const clickedTopNav = await rawPage.evaluate(() => {
    const normalize = (value: string) =>
      value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const topCandidates = Array.from(
      document.querySelectorAll("button, a, [role='button'], [role='tab']")
    ).filter((element) => {
      if (!isVisible(element)) return false;
      const text = normalize(element.textContent ?? "");
      const rect = (element as HTMLElement).getBoundingClientRect();
      const nearTop = rect.top < window.innerHeight * 0.45;
      return nearTop && (
        text === "prices" ||
        text === "reserve" ||
        text === "see availability" ||
        text === "view prices"
      );
    }) as HTMLElement[];

    const preferred =
      topCandidates.find((element) => normalize(element.textContent ?? "") === "prices") ??
      topCandidates.find((element) => normalize(element.textContent ?? "") === "reserve") ??
      topCandidates[0];

    if (!preferred) return "";
    preferred.click();
    return normalize(preferred.textContent ?? "");
  }).catch(() => "");

  if (clickedTopNav) {
    traceLog(`Booking.com room selection: clicked top "${clickedTopNav}" control to reveal pricing/availability.`);
  }

  await rawPage.evaluate(() => {
    const selectors = [
      "#hp_availability_tempcontainer",
      "[data-testid='availability-cta-btn']",
      ".hprt-table",
      "[class*='roomType']",
      "[class*='room-list']",
      "[data-testid*='rooms']",
    ];
    for (const selector of selectors) {
      const section = document.querySelector(selector) as HTMLElement | null;
      if (section) {
        section.scrollIntoView({ behavior: "instant", block: "start" });
        return;
      }
    }

    const allElements = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, section, span, p"));
    const roomHeading = allElements.find((element) => {
      const text = (element.textContent ?? "").toLowerCase();
      return (
        text.includes("select a room type and the number of rooms you want to reserve") ||
        text.includes("select rooms") ||
        text.includes("room type")
      );
    }) as HTMLElement | undefined;
    roomHeading?.scrollIntoView({ behavior: "instant", block: "start" });
  }).catch(() => {});

  await Promise.allSettled([
    rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
    waitForPageSignals(rawPage, {
      fromUrl: beforeUrl,
      untilTextIncludes: [
        "select a room type and the number of rooms you want to reserve",
        "select rooms",
        "room type",
        "today's price",
        "your options",
        "i'll reserve",
        "i will reserve",
      ],
      timeoutMs: 7000,
    }),
  ]);
}

async function setBookingComRoomQuantity(rawPage: Page): Promise<{
  ok: boolean;
  summary: string;
}> {
  return rawPage.evaluate(() => {
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const normalize = (value: string) =>
      value.toLowerCase().replace(/\s+/g, " ").trim();

    const availabilityRoot =
      document.querySelector("#hp_availability_tempcontainer") ||
      document.querySelector(".hprt-table") ||
      document.querySelector("[data-testid*='rooms']") ||
      document.body;

    const allSelects = Array.from(availabilityRoot.querySelectorAll("select"))
      .filter((select) => isVisible(select)) as HTMLSelectElement[];

    for (const select of allSelects) {
      const values = Array.from(select.options).map((option) => option.value);
      if (!values.includes("0") || !values.includes("1")) continue;
      if (select.value && select.value !== "0") {
        return { ok: true, summary: `room quantity already set to ${select.value}` };
      }
    }

    const roomSelects = allSelects
      .map((select, index) => {
        const scope = select.closest("tr, [class*='room'], [class*='hprt'], [data-testid*='room'], div");
        const text = normalize(scope?.textContent ?? "");
        const priceMatch = text.match(/\$\s*([\d,]+)/);
        const price = priceMatch ? Number.parseFloat(priceMatch[1].replace(/,/g, "")) : Number.POSITIVE_INFINITY;
        return { select, index, price, text };
      })
      .filter(({ select }) => {
        const values = Array.from(select.options).map((option) => option.value);
        return values.includes("0") && values.includes("1") && (!select.value || select.value === "0");
      })
      .sort((a, b) => a.price - b.price);

    for (const candidate of roomSelects) {
      candidate.select.scrollIntoView({ block: "center", behavior: "instant" });
      candidate.select.value = "1";
      candidate.select.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.select.dispatchEvent(new Event("change", { bubbles: true }));
      const applied = candidate.select.value === "1";
      if (applied) {
        return {
          ok: true,
          summary: `set room quantity dropdown ${candidate.index} to 1`,
        };
      }
    }

    const quantityButtons = Array.from(
      availabilityRoot.querySelectorAll("button, [role='button'], a")
    ).filter((element) => {
      if (!isVisible(element)) return false;
      const text = normalize(element.textContent ?? "");
      return text === "1" || text.includes("select rooms") || text.includes("add room");
    }) as HTMLElement[];

    for (const button of quantityButtons) {
      button.scrollIntoView({ block: "center", behavior: "instant" });
      button.click();
    }

    return {
      ok: false,
      summary: `no room quantity dropdown found (visible selects: ${allSelects.length})`,
    };
  }).catch(() => ({ ok: false, summary: "DOM room quantity strategy failed" }));
}

async function clickBookingComListingTarget(
  rawPage: Page,
  targetHotelName: string,
  traceLog: (msg: string) => void = () => {}
): Promise<boolean> {
  const normalizedTarget = normalizeLooseText(targetHotelName);
  if (!normalizedTarget) return false;

  const ignoredTokens = new Set([
    "hotel",
    "hotels",
    "the",
    "by",
    "and",
    "a",
    "an",
  ]);
  const targetTokens = normalizedTarget
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ignoredTokens.has(token));

  await safePressEscape(rawPage);
  await rawPage.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
  }).catch(() => {});
  await rawPage.waitForTimeout(100).catch(() => {});

  const clickPlan = await rawPage.evaluate(
    ({ normalizedTarget, targetTokens }) => {
      const normalize = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const cleanTitle = (value: string) =>
        normalize(
          value
            .replace(/opens in new window/gi, " ")
            .replace(/\(\s*hotel\s*\)/gi, " ")
            .replace(/\bfeatured\b/gi, " ")
        );

      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const scoreTitleText = (text: string) => {
        const normalized = cleanTitle(text);
        if (!normalized) return 0;
        if (normalized === normalizedTarget) return 5000;
        if (normalized.startsWith(`${normalizedTarget} `)) return 4200;
        if (normalized.endsWith(` ${normalizedTarget}`)) return 400;

        const normalizedWords = normalized.split(" ").filter(Boolean);
        const matchedTokens = targetTokens.filter((token) => normalizedWords.includes(token)).length;
        if (matchedTokens < targetTokens.length) return 0;

        const extraTokens = normalizedWords.filter((token) => !targetTokens.includes(token));
        const hasMeaningfulExtras = extraTokens.some((token) =>
          ![
            "hotel",
            "hotels",
            "new",
            "window",
            "open",
            "opens",
            "in",
            "featured",
          ].includes(token)
        );

        if (hasMeaningfulExtras) return 0;
        return 1500 - extraTokens.length * 25;
      };

      const getNearestHref = (element: Element | null) => {
        if (!element) return "";
        const directAnchor =
          element instanceof HTMLAnchorElement
            ? element
            : (element.closest("a[href]") as HTMLAnchorElement | null);
        return directAnchor?.href ?? "";
      };

      const buttonCandidates = Array.from(
        document.querySelectorAll("button, a, [role='button']")
      )
        .map((element) => {
          if (!isVisible(element)) return null;
          const actionText = normalize(element.textContent ?? "");
          const isAvailabilityAction =
            actionText.includes("see availability") ||
            actionText.includes("view deal") ||
            actionText.includes("select your room");
          if (!isAvailabilityAction) return null;

          let container: Element | null = element;
          let bestScore = 0;
          let bestTitle = "";
          let bestHref = "";
          for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
            const titleNode =
              container.querySelector("a[data-testid*='title-link'], a[href*='/hotel/'], h1, h2, h3") ??
              container.querySelector("a, h1, h2, h3");
            const titleText = (titleNode?.textContent ?? container.textContent ?? "").trim();
            const score = scoreTitleText(titleText);
            if (score > bestScore) {
              bestScore = score;
              bestTitle = titleText.trim().slice(0, 180);
              bestHref = getNearestHref(titleNode ?? container);
            }
          }

          if (bestScore < 1500) return null;
          return {
            kind: "availability" as const,
            score: bestScore + 100,
            text: (element.textContent ?? "").trim(),
            title: bestTitle,
            href: bestHref,
          };
        })
        .filter((value): value is { kind: "availability"; score: number; text: string; title: string; href: string } => Boolean(value))
        .sort((a, b) => b.score - a.score);

      if (buttonCandidates.length > 0) {
        const winner = buttonCandidates[0];
        const elements = Array.from(
          document.querySelectorAll("button, a, [role='button']")
        ).filter((element) => {
          if (!isVisible(element)) return false;
          const actionText = normalize(element.textContent ?? "");
          const isAvailabilityAction =
            actionText.includes("see availability") ||
            actionText.includes("view deal") ||
            actionText.includes("select your room");
          if (!isAvailabilityAction) return false;

          let container: Element | null = element;
          let bestScore = 0;
          for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
            const titleNode =
              container.querySelector("a[data-testid*='title-link'], a[href*='/hotel/'], h1, h2, h3") ??
              container.querySelector("a, h1, h2, h3");
            const score = scoreTitleText(titleNode?.textContent ?? container.textContent ?? "");
            if (score > bestScore) bestScore = score;
          }
          return bestScore === winner.score - 100;
        });

        const element = elements[0] as HTMLElement | undefined;
        if (element) {
          const rect = element.getBoundingClientRect();
          return {
            kind: "availability" as const,
            text: winner.text,
            title: winner.title,
            href: winner.href,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }

      const titleCandidates = Array.from(
        document.querySelectorAll("a, button, [role='button'], h1, h2, h3")
      )
        .map((element) => {
          if (!isVisible(element)) return null;
          const text = (element.textContent ?? "").trim();
          const score = scoreTitleText(text);
          if (score <= 0) return null;
          return {
            element: element as HTMLElement,
            score,
            text,
          };
        })
        .filter((value): value is { element: HTMLElement; score: number; text: string } => Boolean(value))
        .sort((a, b) => b.score - a.score);

      if (titleCandidates.length === 0) return null;

      const winner = titleCandidates[0];
      if (winner.score < 1500) return null;
      const rect = winner.element.getBoundingClientRect();
      return {
        kind: "title" as const,
        text: winner.text.slice(0, 180),
        title: winner.text.slice(0, 180),
        href: getNearestHref(winner.element),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },
    { normalizedTarget, targetTokens }
  ).catch(() => null);

  if (!clickPlan) {
    traceLog(`Booking.com listing: could not match a listing card for "${targetHotelName}".`);
    return false;
  }

  const beforeUrl = rawPage.url();
  if (clickPlan.href) {
    await rawPage.goto(clickPlan.href, { waitUntil: "domcontentloaded", timeoutMs: 30_000 }).catch(async () => {
      await safeMouseClick(rawPage, clickPlan.x, clickPlan.y);
    });
  } else {
    await safeMouseClick(rawPage, clickPlan.x, clickPlan.y);
  }
  traceLog(
    clickPlan.kind === "availability"
      ? `Booking.com listing: opened matched hotel "${clickPlan.title || targetHotelName}" via "${clickPlan.text || "See availability"}".`
      : `Booking.com listing: opened matched hotel title "${clickPlan.title || targetHotelName}".`
  );
  await Promise.allSettled([
    rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
    waitForPageSignals(rawPage, {
      fromUrl: beforeUrl,
      untilUrlExcludes: ["searchresults"],
      untilTextIncludes: [
        "select a room type and the number of rooms you want to reserve",
        "room type",
        "reserve",
        "we price match",
      ],
      timeoutMs: 7000,
    }),
  ]);
  return true;
}

function extractErrorDetails(err: unknown): {
  message: string;
  statusCode?: number;
  serialized?: string;
} {
  const asRecord =
    err && typeof err === "object" ? (err as Record<string, unknown>) : undefined;

  const statusCandidates = [
    asRecord?.status,
    asRecord?.statusCode,
    asRecord?.code,
    asRecord?.response && typeof asRecord.response === "object"
      ? (asRecord.response as Record<string, unknown>).status
      : undefined,
  ];
  const statusCode = statusCandidates
    .map((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    })
    .find((value): value is number => value !== undefined);

  const nestedResponse =
    asRecord?.response && typeof asRecord.response === "object"
      ? (asRecord.response as Record<string, unknown>)
      : undefined;
  const nestedError =
    asRecord?.error && typeof asRecord.error === "object"
      ? (asRecord.error as Record<string, unknown>)
      : undefined;

  const messageCandidates = [
    err instanceof Error ? err.message : undefined,
    typeof asRecord?.message === "string" ? asRecord.message : undefined,
    typeof nestedError?.message === "string" ? nestedError.message : undefined,
    typeof nestedResponse?.statusText === "string" ? nestedResponse.statusText : undefined,
  ].filter(Boolean) as string[];

  let message = messageCandidates[0] || (typeof err === "string" ? err : safeJsonStringify(err));

  if ((message === "Unknown error" || message === "Unknown error: 402" || message === "[object Object]") && statusCode) {
    message = `HTTP ${statusCode}`;
  }

  if (
    statusCode === 402 ||
    /\b402\b/.test(message) ||
    /payment required|insufficient credits|quota|billing/i.test(message)
  ) {
    message = "HTTP 402 from browser/model provider (likely billing, credits, or quota exhausted)";
  }

  return {
    message,
    statusCode,
    serialized: safeJsonStringify(err),
  };
}

function buildDateNeedles(isoDate?: string): string[] {
  if (!isoDate) return [];
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthName = monthNames[monthIndex];
  if (!monthName) return [];

  return [
    `${monthName} ${dayNumber}, ${year}`,
    `${dayNumber} ${monthName} ${year}`,
    `${monthName} ${dayNumber}`,
    `${dayNumber} ${monthName}`,
  ];
}

function hasRequestedStaySelected(
  pageText: string,
  requestedDates: RequestedStayDates
): boolean {
  if (!requestedDates.checkin || !requestedDates.checkout) return false;
  const checkinMatches = buildDateNeedles(requestedDates.checkin).some((needle) => pageText.includes(needle));
  const checkoutMatches = buildDateNeedles(requestedDates.checkout).some((needle) => pageText.includes(needle));
  return checkinMatches && checkoutMatches;
}

async function readCombinedText(rawPage: Page): Promise<string> {
  const pageUrl = rawPage.url().toLowerCase();
  const isBookingComPage =
    pageUrl.includes("booking.com") ||
    pageUrl.includes("secure.booking.com");
  const texts = await Promise.all(
    getInteractionScopes(rawPage).map(async (scope) => {
      try {
        return await scope.evaluate((bookingCom) => {
          const text = (document.body?.innerText ?? "").toLowerCase();
          if (!bookingCom) return text.slice(0, 12000);
          if (text.length <= 32000) return text;
          const head = text.slice(0, 18000);
          const tail = text.slice(-14000);
          return `${head}\n${tail}`;
        }, isBookingComPage) as string;
      } catch {
        return "";
      }
    })
  );

  let combined = texts.filter(Boolean).join("\n");

  // CDP-based fallback: page.accessibility.snapshot() works cross-origin (same mechanism as
  // Stagehand's ariaTree). Namastay and other embedded booking widgets live in cross-origin
  // iframes — scope.evaluate() returns "" for them even though the main page may have plenty
  // of other text (hotel homepage content etc.), so we can't use combined.length as the guard.
  // Instead, trigger the fallback whenever booking-stage keywords are absent from DOM text —
  // that's the signal that we're missing cross-origin iframe content.
  const bookingKeywordsPresent =
    combined.includes("review and pay") ||
    combined.includes("book now") ||
    combined.includes("reserve now") ||
    combined.includes("card number") ||
    combined.includes("credit card") ||
    combined.includes("expiry") ||
    combined.includes("guarantee policy") ||
    combined.includes("cancellation policy") ||
    combined.includes("check-in") ||
    combined.includes("checkout");

  if (!bookingKeywordsPresent) {
    if (false) try {
      const snapshot = await (rawPage as unknown as {
        accessibility: { snapshot(): Promise<unknown> }
      }).accessibility.snapshot();
      if (snapshot) {
        combined += "\n" + JSON.stringify(snapshot).toLowerCase().slice(0, 30000);
      }
    } catch { /* ignore */ }
  }

  return combined;
}

async function hasValueInScopes(rawPage: Page, expected: string): Promise<boolean> {
  if (!expected) return false;

  const normalizedExpected = normalizeText(expected);
  const digitExpected = normalizeDigits(expected);

  for (const scope of getInteractionScopes(rawPage)) {
    try {
      const matched = await scope.evaluate(
        ({ normalizedExpected, digitExpected }) => {
          const normalizeText = (value: string) =>
            value.toLowerCase().replace(/\s+/g, " ").trim();
          const normalizeDigits = (value: string) => value.replace(/\D+/g, "");
          const isVisible = (element: Element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };

          return Array.from(
            document.querySelectorAll("input, textarea, select")
          ).some((element) => {
            if (!isVisible(element)) return false;
            const value = (element as HTMLInputElement).value ?? "";
            const normalizedValue = normalizeText(value);
            const digitValue = normalizeDigits(value);

            if (normalizedExpected && normalizedValue.includes(normalizedExpected)) {
              return true;
            }

            return digitExpected.length >= 4 && digitValue.includes(digitExpected);
          });
        },
        { normalizedExpected, digitExpected }
      );

      if (matched) return true;
    } catch {
      // Ignore cross-origin/frame access issues and keep scanning.
    }
  }

  return false;
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible({ timeout: 800 }).catch(() => false);
}

async function getLocatorElementHandle(locator: Locator) {
  const candidate = locator as Locator & {
    elementHandle?: () => Promise<{
      evaluate: <T>(pageFunction: (element: Element) => T) => Promise<T>;
      dispose?: () => Promise<void>;
    } | null>;
  };

  if (typeof candidate.elementHandle !== "function") return null;
  return candidate.elementHandle().catch(() => null);
}

async function evaluateLocatorElement<T>(
  locator: Locator,
  pageFunction: (element: Element) => T
): Promise<T> {
  const candidate = locator as Locator & {
    evaluate?: <R>(pageFunction: (element: Element) => R) => Promise<R>;
  };

  if (typeof candidate.evaluate === "function") {
    return candidate.evaluate(pageFunction);
  }

  const handle = await getLocatorElementHandle(locator);
  if (!handle) {
    throw new Error("Locator does not support element evaluation");
  }

  try {
    return await handle.evaluate(pageFunction);
  } finally {
    await handle.dispose?.().catch(() => {});
  }
}

async function clickLocatorDom(locator: Locator): Promise<void> {
  const handle = await getLocatorElementHandle(locator);
  if (!handle) {
    throw new Error("Locator does not support DOM click fallback");
  }

  try {
    await handle.evaluate((element) => {
      (element as HTMLElement).click();
    });
  } finally {
    await handle.dispose?.().catch(() => {});
  }
}

async function isLocatorEnabled(locator: Locator): Promise<boolean> {
  return evaluateLocatorElement(locator, (element) => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return false;
    if ("disabled" in control && control.disabled) return false;
    return true;
  }).catch(() => false);
}

async function isEditable(locator: Locator): Promise<boolean> {
  if (!(await isVisible(locator))) return false;

  return evaluateLocatorElement(locator, (element) => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return false;
    if ("disabled" in control && control.disabled) return false;
    if ("readOnly" in control && control.readOnly) return false;
    if (element instanceof HTMLInputElement) {
      return element.type !== "hidden";
    }
    return true;
  }).catch(() => false);
}

async function fillLocator(locator: Locator, value: string): Promise<boolean> {
  try {
    const tagName = await evaluateLocatorElement(locator, (el) => el.tagName.toLowerCase());
    if (tagName === "select") {
      const select = locator as Locator;
      await select.selectOption({ label: value }).catch(async () => {
        await select.selectOption({ value }).catch(async () => {
          await locator.fill(value);
        });
      });
    } else {
      await locator.fill(value);
    }

    return true;
  } catch {
    return false;
  }
}

async function getVisibleEditableFields(scope: InteractionScope): Promise<Locator[]> {
  const fields = scope.locator([
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="url"]',
    'input[type="password"]',
    'input[type="date"]',
    'input[type="month"]',
    "textarea",
    "select",
  ].join(", "));
  const count = Math.min(await fields.count().catch(() => 0), 100);
  const visibleFields: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = fields.nth(index);
    if (await isEditable(candidate)) {
      visibleFields.push(candidate);
    }
  }

  return visibleFields;
}

async function getLocatorText(locator: Locator): Promise<string> {
  return evaluateLocatorElement(locator, (element) => {
    const htmlElement = element as HTMLElement;
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const labels =
      "labels" in control && control.labels
        ? Array.from(control.labels).map((label) => label.textContent ?? "")
        : [];

    const ariaLabel = htmlElement.getAttribute("aria-label") ?? "";
    const placeholder = "placeholder" in control ? control.placeholder ?? "" : "";
    const name = htmlElement.getAttribute("name") ?? "";
    const id = htmlElement.getAttribute("id") ?? "";
    const autocomplete = htmlElement.getAttribute("autocomplete") ?? "";
    const title = htmlElement.getAttribute("title") ?? "";
    const value = "value" in control ? control.value ?? "" : "";
    const textContent = htmlElement.textContent ?? "";
    const containerText = htmlElement.closest("label, fieldset")?.textContent ?? "";

    return [labels.join(" "), ariaLabel, placeholder, name, id, autocomplete, title, value, textContent, containerText]
      .filter(Boolean)
      .join(" ");
  }).catch(() => "");
}

async function findVisibleField(
  rawPage: Page,
  patterns: string[]
): Promise<Locator | null> {
  const scopes = getInteractionScopes(rawPage);

  for (const scope of scopes) {
    const candidates = await getVisibleEditableFields(scope);
    for (const candidate of candidates) {
      const candidateText = normalizeText(await getLocatorText(candidate));
      for (const pattern of patterns) {
        if (candidateText.includes(normalizeText(pattern))) {
          return candidate;
        }
      }
    }
  }

  return null;
}

async function getVisibleFieldCategoryKeys(rawPage: Page): Promise<Set<string>> {
  const matches = new Set<string>();
  const scopes = getInteractionScopes(rawPage);

  for (const scope of scopes) {
    const candidates = await getVisibleEditableFields(scope);
    for (const candidate of candidates) {
      const candidateText = normalizeText(await getLocatorText(candidate));
      for (const category of CHECKOUT_FIELD_CATEGORIES) {
        if (category.patterns.some((pattern) => candidateText.includes(normalizeText(pattern)))) {
          matches.add(category.key);
        }
      }
    }
  }

  return matches;
}

/**
 * Booking.com Chinese guest-details form filler.
 * Uses label text to locate each field, then force-clears and fills correct values.
 * Always runs regardless of pre-filled account data (which is often wrong).
 */
async function fillBookingComGuestForm(rawPage: Page, p: EffectiveProfile, traceLog: (msg: string) => void = () => {}): Promise<void> {
  // Safety guard: only run on Booking.com checkout pages, never on hotel detail/search pages.
  // The checkout flow lives at secure.booking.com or booking.com/book.
  const pageUrl = rawPage.url();
  const isCheckoutPage = pageUrl.includes("secure.booking.com") || pageUrl.includes("booking.com/book");
  if (!isCheckoutPage) {
    traceLog(`fillBookingComGuestForm: SKIPPED — not on checkout page (${pageUrl.slice(0, 80)})`);
    return;
  }

  // Helper: fill a single input reliably.
  // Uses fill() which clears existing value and types new one, triggering React events.
  async function fillInput(loc: Locator, value: string): Promise<void> {
    await loc.fill(value);
    await loc.blur().catch(() => {});
  }

  // Helper: try a list of CSS selectors, fill the first visible non-select input found.
  async function fillBySelector(selectors: string[], value: string, label: string): Promise<boolean> {
    for (const sel of selectors) {
      try {
        const loc = rawPage.locator(sel).first();
        if (!await loc.isVisible({ timeout: 800 }).catch(() => false)) continue;
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "select") continue;
        // Skip Booking.com's top search bar (name="ss") — never type guest data there
        const nameAttr = await loc.getAttribute("name").catch(() => "");
        if (nameAttr === "ss") continue;
        await fillInput(loc, value);
        traceLog(`Booking.com: filled ${label} via selector "${sel}" = "${value}"`);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  // Helper: try getByLabel (Playwright aria lookup), then label's for= attribute.
  async function fillByLabelText(labelTexts: string[], value: string, label: string): Promise<boolean> {
    for (const text of labelTexts) {
      // Strategy A: Playwright getByLabel
      try {
        const loc = rawPage.getByLabel(text, { exact: false }).first();
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
          const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
          if (tag === "select") continue;
          // Skip Booking.com's top search bar
          const nameAttr = await loc.getAttribute("name").catch(() => "");
          if (nameAttr === "ss") continue;
          await fillInput(loc, value);
          traceLog(`Booking.com: filled ${label} via getByLabel("${text}") = "${value}"`);
          return true;
        }
      } catch { /* try next */ }
      // Strategy B: find <label> by text, look up input by for= attribute
      try {
        const labelEl = rawPage.locator("label").filter({ hasText: text }).first();
        if (!await labelEl.isVisible({ timeout: 600 }).catch(() => false)) continue;
        const forId = await labelEl.getAttribute("for").catch(() => null);
        if (!forId) continue;
        const inp = rawPage.locator(`#${CSS.escape(forId)}`);
        if (!await inp.isVisible({ timeout: 600 }).catch(() => false)) continue;
        await fillInput(inp, value);
        traceLog(`Booking.com: filled ${label} via label[for="${forId}"] = "${value}"`);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  async function fillPhoneFieldInPhoneSection(digitsOnly: string): Promise<boolean> {
    const inspectMarkedPhoneInput = async () => {
      return rawPage.evaluate((digits) => {
        const input = document.querySelector("input[data-codex-phone-target='1']") as HTMLInputElement | null;
        if (!input) {
          return {
            present: false,
            normalizedValue: "",
            verified: false,
            ariaInvalid: false,
            hasErrorText: false,
            visibleErrorText: "",
          };
        }

        const normalizeDigitsLocal = (value: string) => value.replace(/\D/g, "");
        const normalizeText = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
        const isVisible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            !element.hidden &&
            (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)
          );
        };

        const describedByIds = (input.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .map((part) => part.trim())
          .filter(Boolean);
        const describedByText = describedByIds
          .map((id) => document.getElementById(id))
          .filter((element): element is HTMLElement => isVisible(element))
          .map((element) => normalizeText(element.innerText || element.textContent || ""))
          .join(" ");

        const containers = [
          input.closest("[data-testid]"),
          input.closest("fieldset"),
          input.closest("section"),
          input.closest("form"),
          input.parentElement,
          input.parentElement?.parentElement ?? null,
        ].filter((element, index, array): element is HTMLElement => !!element && array.indexOf(element) === index && isVisible(element));

        const localText = containers
          .map((element) => normalizeText(element.innerText || element.textContent || ""))
          .join(" ");

        const errorPattern =
          /enter your phone number|please enter your phone number|invalid phone|valid phone|phone number is required|mobile number is required|please enter a valid|required field/;

        const normalizedValue = normalizeDigitsLocal(input.value || "");
        const verified = normalizedValue.endsWith(digits) || normalizedValue === digits;
        const ariaInvalid = input.getAttribute("aria-invalid") === "true";
        const combinedErrorText = `${describedByText} ${localText}`.trim();
        const hasErrorText = errorPattern.test(combinedErrorText);

        return {
          present: true,
          normalizedValue,
          verified,
          ariaInvalid,
          hasErrorText,
          visibleErrorText: combinedErrorText,
        };
      }, digitsOnly).catch(() => ({
        present: false,
        normalizedValue: "",
        verified: false,
        ariaInvalid: false,
        hasErrorText: false,
        visibleErrorText: "",
      }));
    };

    const waitForMarkedPhoneValidationClear = async (timeoutMs = 1800) => {
      const deadline = Date.now() + timeoutMs;
      let lastState = await inspectMarkedPhoneInput();
      while (Date.now() < deadline) {
        if (lastState.present && lastState.verified && !lastState.ariaInvalid && !lastState.hasErrorText) {
          return lastState;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
        lastState = await inspectMarkedPhoneInput();
      }
      return lastState;
    };

    const marked = await rawPage.evaluate(() => {
      const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
      const matchesPhoneLabel = (value: string) => {
        const text = normalize(value);
        return (
          text.includes("phone number") ||
          text.includes("mobile number") ||
          text.includes("telephone") ||
          text.includes("电话号码") ||
          text.includes("手機號碼") ||
          text.includes("手机号码")
        );
      };
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !element.hidden &&
          (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)
        );
      };
      document
        .querySelectorAll("input[data-codex-phone-target='1']")
        .forEach((element) => element.removeAttribute("data-codex-phone-target"));

      const anchors = Array.from(
        document.querySelectorAll("label, legend, span, p, div, h3, h4")
      ).filter((element) => matchesPhoneLabel(element.textContent ?? ""));

      for (const anchor of anchors) {
        let container: Element | null = anchor;
        for (let depth = 0; depth < 5 && container; depth += 1, container = container.parentElement) {
          if (!isVisible(container)) continue;

          const inputs = Array.from(container.querySelectorAll("input"))
            .filter((input) => input instanceof HTMLInputElement && isVisible(input))
            .filter((input) => !(input as HTMLInputElement).disabled && !(input as HTMLInputElement).readOnly)
            .filter((input) => (input as HTMLInputElement).type !== "hidden")
            .filter((input) => (input as HTMLInputElement).name !== "ss") as HTMLInputElement[];

          const directPhoneCandidates = inputs.filter((input) => {
            if (!(input instanceof HTMLInputElement) || !isVisible(input)) return false;
            const meta = normalize([
              input.type,
              input.name,
              input.id,
              input.placeholder,
              input.autocomplete,
              input.getAttribute("aria-label") ?? "",
            ].join(" "));

            return (
              input.type === "tel" ||
              meta.includes("phone") ||
              meta.includes("mobile") ||
              meta.includes("telephone") ||
              meta.includes("tel")
            );
          });

          const selects = Array.from(container.querySelectorAll("select"))
            .filter((select) => isVisible(select)) as HTMLSelectElement[];
          const rightmostSelect = selects.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return br.left - ar.left;
          })[0];

          const target =
            (rightmostSelect
              ? directPhoneCandidates
                  .filter((input) => input.getBoundingClientRect().left >= rightmostSelect.getBoundingClientRect().right - 8)
                  .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    return br.left - ar.left;
                  })[0]
              : undefined) ||
            directPhoneCandidates.sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return br.left - ar.left;
            })[0] ||
            inputs.sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return br.left - ar.left;
            })[0];

          if (target) {
            target.setAttribute("data-codex-phone-target", "1");
            return true;
          }
        }
      }

      return false;
    }).catch(() => false);

    if (!marked) {
      traceLog("Booking.com: phone-section DOM strategy could not mark the right-side phone input.");
      return false;
    }

    const phoneInput = rawPage.locator("input[data-codex-phone-target='1']").first();
    if (!await phoneInput.isVisible({ timeout: 800 }).catch(() => false)) {
      traceLog("Booking.com: marked phone input is not visible.");
      return false;
    }

    try {
      await phoneInput.fill(digitsOnly);
      await phoneInput.blur().catch(() => {});
    } catch {
      // Fall through to DOM setter fallback below.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    let phoneState = await waitForMarkedPhoneValidationClear();
    if (phoneState.present && phoneState.verified && !phoneState.ariaInvalid && !phoneState.hasErrorText) {
      traceLog("Booking.com: filled Phone number via marked input fill().");
      return true;
    }

    const filled = await rawPage.evaluate((digits) => {
      const input = document.querySelector("input[data-codex-phone-target='1']") as HTMLInputElement | null;
      if (!input) return "";
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      input.focus();
      if (nativeSetter) {
        nativeSetter.call(input, "");
      } else {
        input.value = "";
      }
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward", data: null }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (nativeSetter) {
        nativeSetter.call(input, digits);
      } else {
        input.value = digits;
      }
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: digits }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return input.value;
    }, digitsOnly).catch(() => "");

    await new Promise((resolve) => setTimeout(resolve, 150));
    phoneState = await waitForMarkedPhoneValidationClear();

    if (phoneState.present && phoneState.verified && !phoneState.ariaInvalid && !phoneState.hasErrorText) {
      traceLog("Booking.com: filled Phone number via marked-input DOM fallback.");
      return true;
    }

    const typedSequentially = await rawPage.evaluate((digits) => {
      const input = document.querySelector("input[data-codex-phone-target='1']") as HTMLInputElement | null;
      if (!input) return "";
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const setValue = (value: string) => {
        if (nativeSetter) {
          nativeSetter.call(input, value);
        } else {
          input.value = value;
        }
      };

      input.focus();
      setValue("");
      input.dispatchEvent(new Event("input", { bubbles: true }));

      let current = "";
      for (const digit of digits) {
        current += digit;
        input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: digit }));
        setValue(current);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }

      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return input.value;
    }, digitsOnly).catch(() => "");

    await new Promise((resolve) => setTimeout(resolve, 150));
    phoneState = await waitForMarkedPhoneValidationClear(2200);

    if (phoneState.present && phoneState.verified && !phoneState.ariaInvalid && !phoneState.hasErrorText) {
      traceLog("Booking.com: filled Phone number via marked-input sequential typing fallback.");
      return true;
    }

    traceLog(
      `Booking.com: marked phone input still looks invalid after fill attempts (raw="${filled}", sequential="${typedSequentially}", normalized="${phoneState.normalizedValue}", ariaInvalid=${phoneState.ariaInvalid}, error="${phoneState.visibleErrorText.slice(0, 180)}").`
    );
    return false;
  }

  // ── Determine given name / family name from profile ────────────────────────
  // Profile may store names in Chinese convention (first_name="Guo", last_name="Ziwei").
  // Use full_name ("Ziwei Guo") as the source of truth — last word = family name.
  let givenName  = p.first_name ?? "";
  let familyName = p.last_name  ?? "";
  if (p.full_name && p.full_name.trim().includes(" ")) {
    const parts = p.full_name.trim().split(/\s+/);
    givenName  = parts.slice(0, parts.length - 1).join(" "); // "Ziwei"
    familyName = parts[parts.length - 1];                    // "Guo"
    traceLog(`Booking.com: name split "${p.full_name}" → given="${givenName}" family="${familyName}"`);
  }

  // ── First name ─────────────────────────────────────────────────────────────
  if (givenName) {
    const ok =
      await fillBySelector(['input[autocomplete="given-name"]', 'input[name*="first" i]', 'input[id*="first" i]'], givenName, "First name") ||
      await fillByLabelText(["First name", "Given name", "名", "名 (拼音/英语)"], givenName, "First name");
    if (!ok) traceLog("Booking.com: could not find First name field");
  }

  await new Promise(r => setTimeout(r, 200));

  // ── Last name ──────────────────────────────────────────────────────────────
  if (familyName) {
    const ok =
      await fillBySelector(['input[autocomplete="family-name"]', 'input[name*="last" i]', 'input[id*="last" i]'], familyName, "Last name") ||
      await fillByLabelText(["Last name", "Family name", "Surname", "姓", "姓 (拼音/英语)"], familyName, "Last name");
    if (!ok) traceLog("Booking.com: could not find Last name field");
  }

  await new Promise(r => setTimeout(r, 200));

  // ── Email ──────────────────────────────────────────────────────────────────
  if (p.email) {
    const ok =
      await fillBySelector(['input[autocomplete="email"]', 'input[type="email"]', 'input[name*="email" i]'], p.email, "Email") ||
      await fillByLabelText(["Email address", "Email", "E-mail", "电子邮箱地址"], p.email, "Email");
    if (!ok) traceLog("Booking.com: could not find Email field");
  }

  await new Promise(r => setTimeout(r, 300));

  // ── Country dropdown — set to United States ────────────────────────────────
  // Find the country <select> specifically (not the phone code select).
  try {
    const countrySelectors = [
      'select[autocomplete="country"]',
      'select[name*="country" i]',
      'select[id*="country" i]',
    ];
    let countrySet = false;
    for (const sel of countrySelectors) {
      try {
        const el = rawPage.locator(sel).first();
        if (!await el.isVisible({ timeout: 600 }).catch(() => false)) continue;
        const set = await el.evaluate((s: HTMLSelectElement) => {
          const opt = Array.from(s.options).find(o =>
            o.text.toLowerCase().includes("united states") || o.value.toLowerCase() === "us"
          );
          if (!opt) return false;
          s.value = opt.value;
          s.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        });
        if (set) { countrySet = true; traceLog(`Booking.com: set Country via "${sel}"`); break; }
      } catch { /* next */ }
    }
    if (!countrySet) {
      // Fallback: find by label text
      for (const labelText of ["Country/Region", "Country", "国家/地区"]) {
        try {
          const sel = rawPage.getByLabel(labelText, { exact: false }).first();
          const tag = await sel.evaluate((e) => e.tagName.toLowerCase()).catch(() => "");
          if (tag !== "select") continue;
          if (!await sel.isVisible({ timeout: 600 }).catch(() => false)) continue;
          await sel.selectOption({ label: "United States" }).catch(() =>
            sel.selectOption({ value: "us" })
          ).catch(() => {});
          traceLog(`Booking.com: set Country/Region via getByLabel("${labelText}")`);
          countrySet = true;
          break;
        } catch { /* next */ }
      }
    }
    if (!countrySet) traceLog("Booking.com: could not find Country dropdown");
  } catch { /* non-fatal */ }

  await new Promise(r => setTimeout(r, 300));

  // ── Phone number ───────────────────────────────────────────────────────────
  if (p.phone) {
    const digitsOnly = p.phone.replace(/\D/g, "").replace(/^1/, ""); // strip leading +1

    // Set country code to US first
    try {
      // Find the phone section's <select> — it's near the "Phone number" label
      // but distinct from the Country/Region select (which we already set above).
      // Use a broad selector, then narrow to the one inside the phone widget.
      const phoneLabel = rawPage.locator("label").filter({ hasText: /Phone number|手机号码|电话号码/i }).first();
      if (await phoneLabel.isVisible({ timeout: 800 }).catch(() => false)) {
        // Walk up to the phone section container and find select inside it
        const phoneSection = phoneLabel.locator("xpath=ancestor::div[position()<=3]").last();
        const codeSelect = phoneSection.locator("select").first();
        const shouldMutatePhonePrefix = false;
        if (shouldMutatePhonePrefix && await codeSelect.isVisible({ timeout: 800 }).catch(() => false)) {
          await codeSelect.selectOption({ value: "us" }).catch(() =>
            codeSelect.selectOption({ label: "United States" })
          ).catch(() => {});
          traceLog("Booking.com: set phone country code to US +1");
        }
      }
    } catch { /* non-fatal */ }

    await new Promise(r => setTimeout(r, 300));

    // Fill the tel input — input[type="tel"] is the most direct selector
    const ok =
      await fillPhoneFieldInPhoneSection(digitsOnly) ||
      await fillBySelector(['input[type="tel"]', 'input[autocomplete="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]'], digitsOnly, "Phone") ||
      await fillByLabelText(["Phone number", "Mobile number", "电话号码", "手机号码"], digitsOnly, "Phone");
    if (!ok) traceLog("Booking.com: could not find Phone number input");
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Decline travel protection ("No thanks") ───────────────────────────────
  await new Promise(r => setTimeout(r, 400));
  try {
    const noThanksBtn = rawPage.locator("button, label, span, div").filter({
      hasText: /^No thanks$|^No, thanks$|^不需要$|^不，谢谢$/i,
    }).first();
    if (await noThanksBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await noThanksBtn.scrollIntoViewIfNeeded().catch(() => {});
      await noThanksBtn.click({ force: true });
      traceLog("Booking.com: declined travel protection ('No thanks').");
      await new Promise(r => setTimeout(r, 400));
    }
  } catch { /* non-fatal */ }

  // ── Click "Next: Final details" / "下一步" to advance to payment page ────────
  // After filling all guest fields, the credit card form is on the NEXT page.
  // Click the advance button so the agent doesn't continue typing on this page.
  await new Promise(r => setTimeout(r, 200));
  try {
    const beforeUrl = rawPage.url();
    await safePressEscape(rawPage);
    await rawPage.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 100));

    // Booking.com Step 2 advance button is at the BOTTOM of the page.
    // Try multiple strategies in order of specificity.
    let nextClicked = false;
    const nextButtonPattern = /next.*final\s*details|next.*detail|continue|下一步|继续|完成/i;

    const nextCta = await rawPage.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource, "i");
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const candidates = Array.from(
        document.querySelectorAll("button, a, [role='button'], [data-testid*='next'], [data-testid*='submit']")
      ).filter((element) => {
        if (!isVisible(element)) return false;
        const text = (element.textContent ?? "").trim();
        if (!pattern.test(text)) return false;
        const rect = (element as HTMLElement).getBoundingClientRect();
        return rect.left >= window.innerWidth * 0.45 && rect.bottom >= window.innerHeight * 0.55;
      }).sort((a, b) => {
        const ar = (a as HTMLElement).getBoundingClientRect();
        const br = (b as HTMLElement).getBoundingClientRect();
        return (br.left + br.top) - (ar.left + ar.top);
      }) as HTMLElement[];

      const candidate = candidates[0];
      if (!candidate) return null;
      const rect = candidate.getBoundingClientRect();
      candidate.scrollIntoView({ block: "center", behavior: "instant" });
      candidate.click();
      const form = candidate.closest("form") as HTMLFormElement | null;
      form?.requestSubmit?.();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: (candidate.textContent ?? "").trim(),
      };
    }, nextButtonPattern.source).catch(() => null as { x: number; y: number; text: string } | null);

    if (nextCta) {
      traceLog(`Booking.com guest form: clicked "${nextCta.text}" (strategy 0 direct element click/requestSubmit) to advance to payment page.`);
      nextClicked = true;
    }

    // Strategy 1: find by exact Booking.com button text patterns
    if (!nextClicked) {
    const nextBtnCandidates = [
      rawPage.locator("button").filter({ hasText: /Next.*Final\s*details/i }).first(),
      rawPage.locator("button").filter({ hasText: /Next.*detail/i }).first(),
      rawPage.locator("button").filter({ hasText: /下一步/i }).first(),
      rawPage.locator("button").filter({ hasText: /完成预订步骤/i }).first(),
    ];
    for (const btn of nextBtnCandidates) {
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await new Promise(r => setTimeout(r, 120));
        await btn.click({ force: true });
        traceLog("Booking.com guest form: clicked 'Next: Final details' (strategy 1) to advance to payment page.");
        nextClicked = true;
        break;
      }
    }
    }

    // Strategy 2: Booking.com's CTA is often a sticky lower-right button.
    if (!nextClicked) {
      const box = await rawPage.evaluate((patternSource) => {
        const pattern = new RegExp(patternSource, "i");
        const buttons = Array.from(document.querySelectorAll("button"));
        const candidate = buttons
          .filter((button) => {
            if (!(button instanceof HTMLElement)) return false;
            const text = (button.textContent ?? "").trim();
            if (!pattern.test(text)) return false;
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left >= window.innerWidth * 0.55 && rect.bottom >= window.innerHeight * 0.6;
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (br.left + br.top) - (ar.left + ar.top);
          })[0] as HTMLElement | undefined;

        if (!candidate) return null;
        const rect = candidate.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, nextButtonPattern.source).catch(() => null as { x: number; y: number } | null);

      if (box) {
        await safeMouseClick(rawPage, box.x, box.y);
        traceLog("Booking.com guest form: mouse-clicked lower-right 'Next: Final details' CTA (strategy 2).");
        nextClicked = true;
      }
    }

    // Strategy 3: scroll to bottom, then find any submit/next button in the form footer
    if (!nextClicked) {
      await rawPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await new Promise(r => setTimeout(r, 150));
      // Look for a button near the bottom that is a primary/submit-type action
      const jsClicked = await rawPage.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button[type='submit'], button[data-testid*='next'], button[data-testid*='submit']"));
        const btn = btns.find(b => {
          const t = (b.textContent ?? "").toLowerCase();
          return t.includes("next") || t.includes("final") || t.includes("detail") || t.includes("下一步");
        }) as HTMLButtonElement | undefined;
        if (btn) { btn.scrollIntoView({ block: "center" }); btn.click(); return true; }
        return false;
      }).catch(() => false);
      if (jsClicked) {
        traceLog("Booking.com guest form: JS-clicked 'Next: Final details' (strategy 3).");
        nextClicked = true;
      }
    }

    if (nextClicked) {
      await Promise.allSettled([
        rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
        waitForPageSignals(rawPage, {
          fromUrl: beforeUrl,
          untilTextIncludes: [
            "your payment details",
            "complete booking",
            "when do you want to pay",
            "pay now",
            "pay at the property",
          ],
          untilTextExcludes: [
            "enter your details",
            "your arrival time",
            "cribs and extra beds",
          ],
          timeoutMs: 8000,
        }),
      ]);
      const stillOnDetailsPage = await rawPage.evaluate(() => {
        const text = (document.body?.innerText ?? "").toLowerCase();
        return (
          text.includes("enter your details") ||
          text.includes("phone number") ||
          text.includes("your arrival time") ||
          text.includes("cribs and extra beds")
        );
      }).catch(() => false);
      if (stillOnDetailsPage) {
        traceLog("Booking.com guest form: next button was clicked, but the page still looks like the details step.");
        const retriedSubmit = await rawPage.evaluate((patternSource) => {
          const pattern = new RegExp(patternSource, "i");
          const buttons = Array.from(document.querySelectorAll("button, a, [role='button']")) as HTMLElement[];
          const target = buttons.find((button) => pattern.test((button.textContent ?? "").trim()));
          if (!target) return false;
          target.click();
          const form = target.closest("form") as HTMLFormElement | null;
          form?.requestSubmit?.();
          return true;
        }, nextButtonPattern.source).catch(() => false);
        if (retriedSubmit) {
          traceLog("Booking.com guest form: retried final-details submission via DOM click/requestSubmit after first click did not advance.");
          await Promise.allSettled([
            rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
            waitForPageSignals(rawPage, {
              fromUrl: beforeUrl,
              untilTextIncludes: [
                "your payment details",
                "complete booking",
                "when do you want to pay",
                "pay now",
                "pay at the property",
              ],
              untilTextExcludes: [
                "enter your details",
                "your arrival time",
                "cribs and extra beds",
              ],
              timeoutMs: 8000,
            }),
          ]);
        }
      }
    } else {
      traceLog("Booking.com guest form: 'Next: Final details' button not found — recovery loop will handle navigation.");
    }
  } catch (error) {
    traceLog(`Booking.com guest form: failed while trying to advance to final details: ${error}`);
  }
}

async function fillFieldsInScopes(rawPage: Page, specs: FieldSpec[]): Promise<boolean> {
  let filledAny = false;

  for (const { patterns, value } of specs) {
    const locator = await findVisibleField(rawPage, patterns);
    if (!locator) continue;

    const filled = await fillLocator(locator, value);
    if (!filled) continue;

    filledAny = true;
    await locator.blur().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return filledAny;
}

async function clickAgreementCheckboxes(rawPage: Page): Promise<number> {
  const scopes = getInteractionScopes(rawPage);
  const patterns = ["privacy policy", "terms", "cancellation policy", "i agree"];
  let checkedCount = 0;

  for (const scope of scopes) {
    try {
      const checkboxes = scope.locator('input[type="checkbox"], [role="checkbox"]');
      const count = Math.min(await checkboxes.count().catch(() => 0), 20);

      for (let index = 0; index < count; index += 1) {
        const checkbox = checkboxes.nth(index);
        if (!(await isVisible(checkbox))) continue;
        const checkedState = await evaluateLocatorElement(checkbox, (element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          const ariaChecked = element.getAttribute("aria-checked");
          return ariaChecked === "true";
        }).catch(() => false);
        if (checkedState) continue;

        const text = normalizeText(
          await evaluateLocatorElement(checkbox, (element) => {
            const htmlElement = element as HTMLElement;
            const ownText =
              htmlElement.innerText ||
              htmlElement.textContent ||
              htmlElement.getAttribute("aria-label") ||
              "";
            const containerText =
              htmlElement.closest("label, div, section, form")?.textContent ?? "";
            return `${ownText} ${containerText}`;
          }).catch(async () => await getLocatorText(checkbox))
        );
        if (!patterns.some((pattern) => text.includes(pattern))) continue;

        const wasChecked = checkedState;
        await checkbox.check({ force: true }).catch(async () => {
          await checkbox.click({ force: true });
        });
        const isCheckedNow = await evaluateLocatorElement(checkbox, (element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          const ariaChecked = element.getAttribute("aria-checked");
          return ariaChecked === "true";
        }).catch(() => false);
        if (!wasChecked && isCheckedNow) checkedCount += 1;
      }
    } catch {
      // Ignore and continue checking other consent boxes.
    }

    try {
      const checkedInDom = await scope.evaluate(() => {
        const matchesConsentText = (value: string) =>
          /privacy policy|terms|cancellation policy|i agree/i.test(value);
        const isChecked = (element: Element) => {
          if (element instanceof HTMLInputElement && element.type === "checkbox") {
            return element.checked;
          }
          return element.getAttribute("aria-checked") === "true";
        };
        let clicked = 0;

        const asElementArray = <T extends Element>(list: NodeListOf<T> | HTMLCollectionOf<T>) =>
          Array.from(list) as T[];

        const labels = asElementArray(document.querySelectorAll("label"));
        for (const label of labels) {
          const text = label.textContent ?? "";
          if (!matchesConsentText(text)) continue;

          const htmlFor = label.getAttribute("for");
          let checkbox: HTMLInputElement | null = null;

          if (htmlFor) {
            checkbox = document.getElementById(htmlFor) as HTMLInputElement | null;
          }

          checkbox ||= label.querySelector('input[type="checkbox"]');

          if (checkbox && !checkbox.checked) {
            (label as HTMLElement).click();
            if (!checkbox.checked) checkbox.click();
            if (checkbox.checked) clicked += 1;
          }
        }

        const checkboxes = asElementArray(
          document.querySelectorAll<Element>('input[type="checkbox"], [role="checkbox"]')
        );

        for (const checkbox of checkboxes) {
          if (isChecked(checkbox)) continue;
          const parentText = checkbox.closest("label, div, section, form")?.textContent ?? "";
          if (matchesConsentText(parentText)) {
            const label = checkbox.closest("label");
            if (label instanceof HTMLElement) label.click();
            if (checkbox instanceof HTMLElement) checkbox.click();
            if (isChecked(checkbox)) clicked += 1;
          }
        }

        return clicked;
      });
      checkedCount += checkedInDom;
    } catch {
      // Ignore DOM fallback issues and continue.
    }
  }

  // ── Cross-origin iframe fallback ─────────────────────────────────────────
  // evaluate() / evaluateLocatorElement() both fail in cross-origin iframes
  // (browser same-origin policy blocks JS injection).  CDP-based APIs like
  // isChecked() and check() work fine across origins, so for booking-scoped
  // frames that produced no checked boxes above, check every visible unchecked
  // checkbox directly — we're confident they are consent checkboxes because
  // looksLikeIntermediateBookNowGate already confirmed the page context.
  if (checkedCount === 0) {
    for (const scope of getInteractionScopes(rawPage)) {
      const scopeUrl = getScopeUrl(scope);
      if (!isLikelyBookingScopeUrl(scopeUrl)) continue;
      try {
        const checkboxes = scope.locator('input[type="checkbox"]');
        const count = Math.min(await checkboxes.count().catch(() => 0), 10);
        for (let index = 0; index < count; index += 1) {
          const checkbox = checkboxes.nth(index);
          if (!(await checkbox.isVisible({ timeout: 600 }).catch(() => false))) continue;
          if (await checkbox.isChecked({ timeout: 600 }).catch(() => false)) continue;
          await checkbox.check({ force: true }).catch(async () => {
            await checkbox.click({ force: true }).catch(() => {});
          });
          const nowChecked = await checkbox.isChecked({ timeout: 600 }).catch(() => false);
          if (nowChecked) checkedCount += 1;
        }
      } catch {
        // Ignore per-frame errors — best-effort only.
      }
    }
  }

  return checkedCount;
}

async function clickAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  dryRun = false
): Promise<string | null> {
  return clickAllowedAdvanceButton(rawPage, buttonNames, {
    dryRun,
    excludeText: [],
    skipEnabledCheck: true,
  });
}

async function clickAllowedAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[],
  options?: {
    dryRun?: boolean;
    excludeText?: RegExp[];
    skipEnabledCheck?: boolean;
  }
): Promise<string | null> {
  const scopes = getInteractionScopes(rawPage);
  const dryRun = options?.dryRun ?? false;
  const excludeText = options?.excludeText ?? COMMON_DISALLOWED_ADVANCE_BUTTONS;
  const skipEnabledCheck = options?.skipEnabledCheck ?? false;

  for (const scope of scopes) {
    try {
      const buttons = scope.locator('button, [role="button"], input[type="submit"], a');
      const count = Math.min(await buttons.count().catch(() => 0), 40);

      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        if (!(await isVisible(button))) continue;
        if (!skipEnabledCheck && !(await isLocatorEnabled(button))) continue;

        const primaryText = normalizeText(
          await evaluateLocatorElement(button, (element) => {
            const htmlElement = element as HTMLElement;
            if (element instanceof HTMLInputElement) {
              return element.value ?? "";
            }
            return (
              htmlElement.innerText ||
              htmlElement.textContent ||
              htmlElement.getAttribute("aria-label") ||
              htmlElement.getAttribute("title") ||
              ""
            );
          }).catch(() => "")
        );
        const fullText = normalizeText(await getLocatorText(button));
        if (excludeText.some((pattern) => pattern.test(primaryText) || pattern.test(fullText))) {
          continue;
        }
        if (!buttonNames.some((buttonName) => buttonName.test(primaryText) || buttonName.test(fullText))) {
          continue;
        }

        if (!dryRun) {
          await button.click({ force: true }).catch(async () => {
            await clickLocatorDom(button);
          });
        }
        return primaryText || fullText || "<unnamed button>";
      }
    } catch {
      // Try the next scope.
    }
  }

  return null;
}

function looksLikeIntermediateBookNowGate(pageText: string): boolean {
  const gateSignals = [
    "review and pay",
    "continue with",
    "guarantee policy",
    "cancellation policy",
    "credit or debit card",
    "privacy policy",
    "i agree",
  ];
  const matchingSignalCount = gateSignals.filter((signal) => pageText.includes(signal)).length;
  const hasIntermediateSubmitButton =
    pageText.includes("book now") ||
    pageText.includes("reserve now") ||
    pageText.includes("request to book");

  return hasIntermediateSubmitButton && matchingSignalCount >= 2;
}

function looksLikeDateSelectionGate(
  pageText: string,
  requestedDates: RequestedStayDates,
  currentUrl = ""
): boolean {
  // Booking.com's Step 2 (Your Details) and Step 3 (payment) pages are never
  // date selection gates, even though they display booking dates in the sidebar.
  if (currentUrl.includes("secure.booking.com") || currentUrl.includes("booking.com/book")) {
    return false;
  }

  const hasDatePickerSignals = containsAny(pageText, [
    "check in",
    "check out",
    "guests",
  ]);

  const hasAdvanceButton = containsAny(pageText, [
    "\nnext\n",
    "button: next",
    " next ",
  ]);

  const hasSelectedDates = hasRequestedStaySelected(pageText, requestedDates);

  const hasDeeperCheckoutSignals = containsAny(pageText, [
    "proceed to payment",
    "review and pay",
    "guest details",
    "card number",
    "credit card",
    // Booking.com Step 2 specific signals:
    "next: final details",
    "your price summary",
    "your booking details",
  ]);

  return hasDatePickerSignals && hasAdvanceButton && hasSelectedDates && !hasDeeperCheckoutSignals;
}

function looksLikeRoomSelectionGate(pageText: string): boolean {
  const hasRoomSignals = containsAny(pageText, [
    "standard cabin",
    "room details",
    "rack",
    "usd169",
    "usd338",
    "proceed to payment",
    "select room",
    // Booking.com English room list signals (straight and curly apostrophe variants)
    "i'll reserve",
    "i\u2019ll reserve",
    "i will reserve",
    "select rooms",
    "number of guests",
    "today's price",
    "your options",
    "availability",
    "per night",
    // Booking.com Chinese room list signals
    "空房情况",
    "客房类型",
    "选择客房",
    "现在就预订",
    "每晚",
  ]);

  const hasDeeperCheckoutSignals = containsAny(pageText, [
    "review and pay",
    "guest details",
    "card number",
    "credit card",
    "cvv",
    // Chinese checkout signals
    "输入个人信息",
    "完成预订",
    "信用卡",
    "持卡人",
  ]);

  return hasRoomSignals && !hasDeeperCheckoutSignals;
}

function looksLikeBookingComGuestDetailsStep(pageText: string, currentUrl: string): boolean {
  const isBookingComCheckoutUrl =
    currentUrl.includes("secure.booking.com/book") ||
    currentUrl.includes("booking.com/book");
  if (!isBookingComCheckoutUrl) return false;

  const hasGuestStepSignals = containsAny(pageText, [
    "enter your details",
    "your details",
    "first name",
    "last name",
    "email address",
    "country/region",
    "phone number",
    "next: final details",
    "who are you booking for",
    "your arrival time",
    "add your estimated arrival time",
    "cribs and extra beds",
    "what are my booking conditions",
  ]);

  const hasFinalPaymentSignals = containsAny(pageText, [
    "card number",
    "credit or debit card",
    "payment method",
    "expiry date",
    "security code",
    "cvv",
    "finish booking",
    "complete booking",
  ]);

  return hasGuestStepSignals && !hasFinalPaymentSignals;
}

async function isBookingComGuestDetailsDomState(rawPage: Page, currentUrl: string): Promise<boolean> {
  const isBookingComCheckoutUrl =
    currentUrl.includes("secure.booking.com/book") ||
    currentUrl.includes("booking.com/book");
  if (!isBookingComCheckoutUrl) return false;

  return rawPage.evaluate(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    const hasBottomDetailsSignals =
      text.includes("your arrival time") ||
      text.includes("add your estimated arrival time") ||
      text.includes("cribs and extra beds") ||
      text.includes("what are my booking conditions");
    const hasNextFinalDetailsCta = Array.from(
      document.querySelectorAll("button, a, [role='button']")
    ).some((element) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const buttonText = (html.textContent ?? "").toLowerCase();
      return buttonText.includes("next: final details") || buttonText.includes("next final details");
    });

    return hasBottomDetailsSignals || hasNextFinalDetailsCta;
  }).catch(() => false);
}

async function isBookingComFinalPaymentDomState(rawPage: Page, currentUrl: string): Promise<boolean> {
  const isBookingComCheckoutUrl =
    currentUrl.includes("secure.booking.com/book") ||
    currentUrl.includes("booking.com/book");
  if (!isBookingComCheckoutUrl) return false;

  return rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.hidden &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const bodyText = normalize(document.body?.innerText ?? "");
    const paymentTextSignals = [
      "your payment details",
      "when do you want to pay",
      "pay online",
      "pay now",
      "pay at the property",
      "complete booking",
      "your payment details",
      "do you have a promo code",
      "payment will be handled by the property",
      "how do you want to reserve",
      "credit or debit card",
      "payment details",
    ];
    const hasPaymentTextSignals = paymentTextSignals.some((signal) => bodyText.includes(signal));

    const visiblePaymentControls = Array.from(
      document.querySelectorAll("button, a, [role='button'], label, h2, h3, h4, p, span, div")
    )
      .filter((element) => isVisible(element))
      .map((element) => normalize((element.textContent ?? "").slice(0, 200)));

    const hasVisiblePaymentControls = visiblePaymentControls.some((text) =>
      text.includes("your payment details") ||
      text.includes("when do you want to pay") ||
      text.includes("pay now") ||
      text.includes("pay at the property") ||
      text.includes("complete booking") ||
      text.includes("credit or debit card") ||
      text.includes("payment will be handled by the property")
    );

    const cardLikeInputs = Array.from(document.querySelectorAll("input, iframe"))
      .filter((element) => isVisible(element))
      .some((element) => {
        const html = element as HTMLElement;
        const meta = normalize([
          html.getAttribute("name") ?? "",
          html.getAttribute("id") ?? "",
          html.getAttribute("placeholder") ?? "",
          html.getAttribute("aria-label") ?? "",
          html.getAttribute("title") ?? "",
          html.getAttribute("autocomplete") ?? "",
          html.getAttribute("data-testid") ?? "",
        ].join(" "));
        return (
          meta.includes("card") ||
          meta.includes("cc-") ||
          meta.includes("expiry") ||
          meta.includes("expir") ||
          meta.includes("security code") ||
          meta.includes("cvv") ||
          meta.includes("payment")
        );
      });

    return (hasPaymentTextSignals && hasVisiblePaymentControls) || cardLikeInputs;
  }).catch(() => false);
}

async function markBookingComPaymentFields(
  rawPage: Page
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  return rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && !element.hidden && rect.width > 0 && rect.height > 0;
    };
    const markerAttr = "data-codex-booking-payment-field";
    for (const marked of Array.from(document.querySelectorAll(`[${markerAttr}]`))) {
      marked.removeAttribute(markerAttr);
    }

    const scoreMeta = (text: string, patterns: string[]) => {
      let score = 0;
      for (const pattern of patterns) {
        if (text.includes(pattern)) score += pattern.length >= 10 ? 6 : 3;
      }
      return score;
    };

    const bestMatches = {
      cardholder: { score: -1, element: null as HTMLElement | null },
      cardNumber: { score: -1, element: null as HTMLElement | null },
      cardExpiry: { score: -1, element: null as HTMLElement | null },
    };

    const controls = Array.from(document.querySelectorAll("input, textarea, select"));
    for (const control of controls) {
      if (!isVisible(control)) continue;
      const html = control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const labels =
        "labels" in html && html.labels
          ? Array.from(html.labels).map((label) => label.textContent ?? "")
          : [];
      const text = normalize([
        labels.join(" "),
        control.getAttribute("aria-label") ?? "",
        control.getAttribute("placeholder") ?? "",
        control.getAttribute("name") ?? "",
        control.getAttribute("id") ?? "",
        control.getAttribute("autocomplete") ?? "",
        control.getAttribute("title") ?? "",
        control.parentElement?.textContent ?? "",
        control.closest("label, fieldset, section, form, div")?.textContent ?? "",
      ].join(" "));

      const cardholderScore = scoreMeta(text, [
        "cardholder's name",
        "cardholder name",
        "name on card",
        "cardholder",
        "card holder",
      ]);
      if (cardholderScore > bestMatches.cardholder.score) {
        bestMatches.cardholder = { score: cardholderScore, element: control as HTMLElement };
      }

      const cardNumberScore = scoreMeta(text, [
        "card number",
        "credit card number",
        "cc-number",
        "cc number",
      ]);
      if (cardNumberScore > bestMatches.cardNumber.score) {
        bestMatches.cardNumber = { score: cardNumberScore, element: control as HTMLElement };
      }

      const expiryScore = scoreMeta(text, [
        "expiration date",
        "expiry date",
        "expiration",
        "expiry",
        "mm/yy",
        "mm / yy",
      ]);
      if (expiryScore > bestMatches.cardExpiry.score) {
        bestMatches.cardExpiry = { score: expiryScore, element: control as HTMLElement };
      }
    }

    const result = { cardholder: false, cardNumber: false, cardExpiry: false };
    if (bestMatches.cardholder.score > 0 && bestMatches.cardholder.element) {
      bestMatches.cardholder.element.setAttribute(markerAttr, "cardholder");
      result.cardholder = true;
    }
    if (bestMatches.cardNumber.score > 0 && bestMatches.cardNumber.element) {
      bestMatches.cardNumber.element.setAttribute(markerAttr, "card-number");
      result.cardNumber = true;
    }
    if (bestMatches.cardExpiry.score > 0 && bestMatches.cardExpiry.element) {
      bestMatches.cardExpiry.element.setAttribute(markerAttr, "card-expiry");
      result.cardExpiry = true;
    }

    return result;
  }).catch(() => ({ cardholder: false, cardNumber: false, cardExpiry: false }));
}

async function getBookingComPaymentFieldVisibility(
  rawPage: Page,
  currentUrl: string
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  const isBookingComCheckoutUrl =
    currentUrl.includes("secure.booking.com/book") ||
    currentUrl.includes("booking.com/book");
  if (!isBookingComCheckoutUrl) {
    return { cardholder: false, cardNumber: false, cardExpiry: false };
  }

  return markBookingComPaymentFields(rawPage);
}

async function verifyBookingComPaymentFieldValues(
  rawPage: Page,
  currentUrl: string,
  p: EffectiveProfile
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  const isBookingComCheckoutUrl =
    currentUrl.includes("secure.booking.com/book") ||
    currentUrl.includes("booking.com/book");
  if (!isBookingComCheckoutUrl) {
    return { cardholder: false, cardNumber: false, cardExpiry: false };
  }

  await markBookingComPaymentFields(rawPage);

  return rawPage.evaluate((expected) => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizeDigitsLocal = (value: string) => value.replace(/\D/g, "");
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && !element.hidden && rect.width > 0 && rect.height > 0;
    };

    const result = { cardholder: false, cardNumber: false, cardExpiry: false };
    const controls = Array.from(document.querySelectorAll("input, textarea, select"));
    for (const control of controls) {
      if (!isVisible(control)) continue;
      const html = control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const labels =
        "labels" in html && html.labels
          ? Array.from(html.labels).map((label) => label.textContent ?? "")
          : [];
      const meta = normalize([
        labels.join(" "),
        control.getAttribute("aria-label") ?? "",
        control.getAttribute("placeholder") ?? "",
        control.getAttribute("name") ?? "",
        control.getAttribute("id") ?? "",
        control.getAttribute("autocomplete") ?? "",
        control.getAttribute("title") ?? "",
        control.closest("label, fieldset, form, section, div")?.textContent ?? "",
      ].join(" "));
      const rawValue = "value" in html ? String(html.value ?? "") : "";
      const normalizedValue = normalize(rawValue);
      const digitValue = normalizeDigitsLocal(rawValue);

      if (
        expected.cardholder &&
        (
          meta.includes("cardholder's name") ||
          meta.includes("cardholder name") ||
          meta.includes("name on card") ||
          meta.includes("cardholder")
        ) &&
        normalizedValue.includes(normalize(expected.cardholder))
      ) {
        result.cardholder = true;
      }

      if (
        expected.cardNumber &&
        (meta.includes("card number") || meta.includes("credit card number") || meta.includes("cc-number"))
      ) {
        const expectedDigits = normalizeDigitsLocal(expected.cardNumber);
        if (
          digitValue === expectedDigits ||
          (expectedDigits.length >= 4 && digitValue.endsWith(expectedDigits.slice(-4)))
        ) {
          result.cardNumber = true;
        }
      }

      if (
        expected.cardExpiry &&
        (
          meta.includes("expiration date") ||
          meta.includes("expiry date") ||
          meta.includes("expiry") ||
          meta.includes("expiration") ||
          meta.includes("mm/yy") ||
          meta.includes("mm / yy")
        )
      ) {
        const compactValue = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
        const compactExpected = expected.cardExpiry.replace(/\s+/g, "").replace(/-/g, "/");
        if (compactValue.includes(compactExpected)) {
          result.cardExpiry = true;
        }
      }
    }

    return result;
  }, {
    cardholder: p.card_name || p.full_name || "",
    cardNumber: p.card_number ?? "",
    cardExpiry: p.card_expiry ?? "",
  }).catch(() => ({ cardholder: false, cardNumber: false, cardExpiry: false }));
}

// Legacy helper kept temporarily for comparison while Booking.com payment filling is stabilized.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fillBookingComPaymentForm(
  rawPage: Page,
  p: EffectiveProfile,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const pageUrl = rawPage.url();
  const isCheckoutPage = pageUrl.includes("secure.booking.com") || pageUrl.includes("booking.com/book");
  if (!isCheckoutPage) {
    traceLog(`fillBookingComPaymentForm: SKIPPED — not on checkout page (${pageUrl.slice(0, 80)})`);
    return;
  }

  const fillPaymentField = async (
    patterns: string[],
    value: string,
    label: string,
    kind: "text" | "digits" | "expiry"
  ): Promise<boolean> => {
    if (!value) return false;
    const locator = await findVisibleField(rawPage, patterns);
    if (!locator) {
      traceLog(`Booking.com payment: could not find ${label} field`);
      return false;
    }

    const normalizedDigits = normalizeDigits(value);
    const normalizedExpiry = value.replace(/\s+/g, "").replace(/-/g, "/");

    const verify = async () => {
      const rawValue = await locator.inputValue().catch(() => "");
      const normalizedTextValue = normalizeText(rawValue);
      const normalizedDigitValue = normalizeDigits(rawValue);
      if (kind === "digits") {
        if (normalizedDigitValue === normalizedDigits) return true;
        if (normalizedDigits.length >= 4 && normalizedDigitValue.endsWith(normalizedDigits.slice(-4))) return true;
        return false;
      }
      if (kind === "expiry") {
        const compact = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
        return compact.includes(normalizedExpiry);
      }
      return normalizedTextValue.includes(normalizeText(value));
    };

    const fillWithValue = async (fieldValue: string) => {
      await locator.fill(fieldValue).catch(async () => {
        await fillLocator(locator, fieldValue);
      });
    };

    await fillWithValue(value);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await verify()) {
      traceLog(`Booking.com payment: filled ${label} via locator.fill().`);
      return true;
    }

    await evaluateLocatorElement(locator, (element, fieldValue) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      input.focus();
      if (nativeSetter) {
        nativeSetter.call(input, "");
        nativeSetter.call(input, fieldValue);
      } else {
        input.value = fieldValue;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    }, value).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await verify()) {
      traceLog(`Booking.com payment: filled ${label} via DOM fallback.`);
      return true;
    }

    traceLog(`Booking.com payment: failed to verify ${label} after fill.`);
    return false;
  };

  const cardholderValue = p.card_name || p.full_name || "";
  await fillPaymentField(
    ["cardholder's name", "cardholder name", "name on card", "cardholder", "card holder"],
    cardholderValue,
    "Cardholder name",
    "text"
  );

  if (p.card_number) {
    await fillPaymentField(
      ["card number", "credit card number", "cc-number"],
      normalizeDigits(p.card_number),
      "Card number",
      "digits"
    );
  }

  if (p.card_expiry) {
    const normalizedExpiry = p.card_expiry.replace(/\s+/g, "").replace(/-/g, "/");
    await fillPaymentField(
      ["expiration date", "expiry date", "expiry", "expiration", "mm/yy", "mm / yy"],
      normalizedExpiry,
      "Expiration date",
      "expiry"
    );
  }
}

async function fillBookingComPaymentFormV2(
  rawPage: Page,
  p: EffectiveProfile,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const pageUrl = rawPage.url();
  const isCheckoutPage = pageUrl.includes("secure.booking.com") || pageUrl.includes("booking.com/book");
  if (!isCheckoutPage) {
    traceLog(`fillBookingComPaymentFormV2: skipped - not on checkout page (${pageUrl.slice(0, 80)})`);
    return;
  }

  await Promise.allSettled([
    rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
    waitForEvaluateCondition(
      rawPage,
      () => {
        const text = (document.body?.innerText ?? "").toLowerCase();
        return (
          text.includes("your payment details") ||
          text.includes("cardholder's name") ||
          text.includes("card number") ||
          text.includes("expiration date") ||
          text.includes("mm/yy")
        );
      },
      undefined,
      8000
    ),
  ]);

  const discovered = await markBookingComPaymentFields(rawPage);
  traceLog(
    `Booking.com payment: field discovery cardholder=${discovered.cardholder} cardNumber=${discovered.cardNumber} cardExpiry=${discovered.cardExpiry}.`
  );

  const fillPaymentField = async (
    markerKey: "cardholder" | "card-number" | "card-expiry",
    patterns: string[],
    value: string,
    label: string,
    kind: "text" | "digits" | "expiry"
  ): Promise<boolean> => {
    if (!value) return false;

    let locator = rawPage.locator(`[data-codex-booking-payment-field="${markerKey}"]`).first();
    let locatorVisible = await locator.isVisible({ timeout: 800 }).catch(() => false);
    if (!locatorVisible) {
      const found = await findVisibleField(rawPage, patterns);
      if (found) {
        locator = found;
        locatorVisible = true;
      }
    }
    if (!locatorVisible) {
      traceLog(`Booking.com payment: could not find ${label} field`);
      return false;
    }

    const normalizedDigits = normalizeDigits(value);
    const normalizedExpiry = value.replace(/\s+/g, "").replace(/-/g, "/");

    const verify = async () => {
      const rawValue = await locator.inputValue().catch(() => "");
      const normalizedTextValue = normalizeText(rawValue);
      const normalizedDigitValue = normalizeDigits(rawValue);
      if (kind === "digits") {
        if (normalizedDigitValue === normalizedDigits) return true;
        if (normalizedDigits.length >= 4 && normalizedDigitValue.endsWith(normalizedDigits.slice(-4))) return true;
        return false;
      }
      if (kind === "expiry") {
        const compact = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
        return compact.includes(normalizedExpiry);
      }
      return normalizedTextValue.includes(normalizeText(value));
    };

    await locator.fill(value).catch(async () => {
      await fillLocator(locator, value);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await verify()) {
      traceLog(`Booking.com payment: filled ${label} via locator.fill().`);
      return true;
    }

    await evaluateLocatorElement(locator, (element, fieldValue) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      input.focus();
      if (nativeSetter) {
        nativeSetter.call(input, "");
        nativeSetter.call(input, fieldValue);
      } else {
        input.value = fieldValue;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    }, value).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await verify()) {
      traceLog(`Booking.com payment: filled ${label} via DOM fallback.`);
      return true;
    }

    if (kind !== "text") {
      await locator.click({ force: true }).catch(() => {});
      await locator.pressSequentially(value, { delay: kind === "digits" ? 40 : 55 }).catch(() => {});
      await locator.blur().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await verify()) {
        traceLog(`Booking.com payment: filled ${label} via sequential typing fallback.`);
        return true;
      }
    }

    traceLog(`Booking.com payment: failed to verify ${label} after fill.`);
    return false;
  };

  const cardholderValue = p.card_name || p.full_name || "";
  await fillPaymentField(
    "cardholder",
    ["cardholder's name", "cardholder name", "name on card", "cardholder", "card holder"],
    cardholderValue,
    "Cardholder name",
    "text"
  );

  if (p.card_number) {
    await fillPaymentField(
      "card-number",
      ["card number", "credit card number", "cc-number", "cc number"],
      normalizeDigits(p.card_number),
      "Card number",
      "digits"
    );
  }

  if (p.card_expiry) {
    const normalizedExpiry = p.card_expiry.replace(/\s+/g, "").replace(/-/g, "/");
    await fillPaymentField(
      "card-expiry",
      ["expiration date", "expiry date", "expiry", "expiration", "mm/yy", "mm / yy"],
      normalizedExpiry,
      "Expiration date",
      "expiry"
    );
  }
}

function looksLikeBookingComHotelDetailPage(pageText: string, currentUrl: string): boolean {
  const isBookingComHotelUrl =
    currentUrl.includes("booking.com/hotel/") &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");
  if (!isBookingComHotelUrl) return false;

  const hasRoomSelectionSignals = containsAny(pageText, [
    "select a room type and the number of rooms you want to reserve",
    "select rooms",
    "room type",
    "today's price",
    "your options",
    "i'll reserve",
    "i will reserve",
    "sleeps:",
  ]);

  const hasDetailTabs = containsAny(pageText, [
    "overview",
    "prices",
    "amenities",
    "house rules",
    "important and legal info",
    "guest reviews",
  ]);

  const hasHotelDetailSignals = containsAny(pageText, [
    "we price match",
    "show on map",
    "travel proud",
    "sustainability certification",
    "hotel chain/brand",
    "property highlights",
    "save the property",
    "change search",
    "availability",
    "reserve",
  ]);

  const hasRealCheckoutSignals = containsAny(pageText, [
    "enter your details",
    "your details",
    "phone number",
    "next: final details",
    "your payment details",
    "complete booking",
    "pay now",
    "card number",
    "credit or debit card",
  ]);

  if (!hasRealCheckoutSignals && !hasRoomSelectionSignals) {
    return true;
  }

  return (hasDetailTabs || hasHotelDetailSignals) && !hasRoomSelectionSignals && !hasRealCheckoutSignals;
}

async function hasVisibleCheckoutFields(rawPage: Page): Promise<boolean> {
  const categoryKeys = await getVisibleFieldCategoryKeys(rawPage);
  const hasGuestIdentity =
    categoryKeys.has("full_name") ||
    (categoryKeys.has("first_name") && categoryKeys.has("last_name")) ||
    categoryKeys.has("email") ||
    categoryKeys.has("phone");
  const hasPaymentFields =
    categoryKeys.has("card_number") ||
    categoryKeys.has("card_expiry") ||
    categoryKeys.has("cardholder");

  return categoryKeys.size >= 2 && (hasGuestIdentity || hasPaymentFields);
}

async function hasVisibleAdvanceButton(
  rawPage: Page,
  buttonNames: RegExp[]
): Promise<boolean> {
  return !!(await clickAdvanceButton(rawPage, buttonNames, true));
}

async function looksLikeIntermediateBookNowGateState(
  rawPage: Page,
  pageText: string
): Promise<boolean> {
  const hasGateSignals = looksLikeIntermediateBookNowGate(pageText);
  if (!hasGateSignals) return false;

  // hasVisibleAdvanceButton uses locator.count() which returns 0 for cross-origin iframes.
  // Fall back to checking pageText (which already includes CDP accessibility snapshot).
  const hasBookNowButton =
    (await hasVisibleAdvanceButton(rawPage, [/^book now$/i, /^reserve now$/i])) ||
    containsAny(pageText, ["book now", "reserve now"]);
  if (!hasBookNowButton) return false;

  const hasCheckoutFields = await hasVisibleCheckoutFields(rawPage);
  if (!hasCheckoutFields) return true;

  const stillLooksLikeConsentGate = containsAny(pageText, [
    "continue with",
    "privacy policy",
    "i agree",
    "guarantee policy",
    "cancellation policy",
  ]);
  const hasDeepCheckoutSignals = containsAny(pageText, [
    "security code",
    "cvv",
    "name on card",
    "cardholder",
    "billing address",
    "address line 1",
  ]);

  return stillLooksLikeConsentGate && !hasDeepCheckoutSignals;
}

/**
 * Modal classification used by dismissBlockingModals().
 * "error"   — booking error that needs Ok + possible retry (room not found, code invalid…)
 * "ad"      — promotional/newsletter overlay that should be closed
 * "blocker" — any other visible dialog blocking the flow
 */
type ModalKind = "error" | "ad" | "blocker";

const MODAL_ERROR_PHRASES = [
  "invalid", "coupon", "promo", "couldn't find", "could not find",
  "not found", "not available", "unavailable", "no availability",
  "no longer available", "sold out", "error", "failed", "sorry",
  "something went wrong", "we're sorry",
];
const MODAL_AD_PHRASES = [
  "subscribe", "newsletter", "sign up", "sign-up", "exclusive offer",
  "special offer", "discount", "% off", "deal", "promotion",
  "get the app", "download the app",
];
/** Button labels that close/dismiss a modal without advancing the booking. */
const MODAL_CLOSE_LABELS = /^(ok|okay|close|dismiss|got it|no thanks|no,? thanks|skip|maybe later|×|✕|x)$/i;
/** Button labels that confirm an error acknowledgement — effectively same as close. */
const MODAL_CONFIRM_LABELS = /^(ok|okay|got it|continue|accept|confirm)$/i;

function classifyModal(text: string): ModalKind | null {
  const t = text.toLowerCase();
  if (MODAL_AD_PHRASES.some((p) => t.includes(p))) return "ad";
  if (MODAL_ERROR_PHRASES.some((p) => t.includes(p))) return "error";
  return null;
}

/**
 * Dismiss any blocking modals/popups that are interrupting the booking flow.
 *
 * Strategy:
 *  - Scan all frames (main page + iframes, which Namastay uses for its widget)
 *  - Find visible buttons with close/ok/dismiss labels
 *  - Determine if the button sits inside a visible dialog/modal overlay
 *  - Classify the modal content and always dismiss it (ads, errors, generic blockers)
 *
 * Returns a description of what was dismissed (empty string = nothing found).
 */
async function dismissBlockingModals(rawPage: Page): Promise<string> {
  const dismissed: string[] = [];
  for (const scope of getInteractionScopes(rawPage)) {
    try {
      const buttons = scope.locator('button, [role="button"], a[href="#"]');
      const count = Math.min(await buttons.count().catch(() => 0), 40);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible({ timeout: 400 }).catch(() => false))) continue;

        const btnText = normalizeText(
          await evaluateLocatorElement(btn, (el) =>
            (el as HTMLElement).innerText || (el as HTMLElement).textContent || ""
          ).catch(async () => await getLocatorText(btn))
        );

        const isCloseLabel = MODAL_CLOSE_LABELS.test(btnText) || MODAL_CONFIRM_LABELS.test(btnText);
        if (!isCloseLabel) continue;

        // Walk up the DOM to find the containing dialog/modal
        const { inDialog, dialogText } = await evaluateLocatorElement(btn, (el) => {
          // Check for semantic dialog
          const dialog = el.closest("dialog, [role='dialog']") as HTMLElement | null;
          if (dialog) {
            const style = window.getComputedStyle(dialog);
            if (style.display !== "none" && style.visibility !== "hidden") {
              return { inDialog: true, dialogText: dialog.textContent ?? "" };
            }
          }
          // Namastay and similar widgets use plain divs styled as modals.
          // Heuristic: button's nearest scrollable/positioned ancestor with z-index > 10
          let el2: HTMLElement | null = el.parentElement;
          while (el2 && el2 !== document.body) {
            const s = window.getComputedStyle(el2);
            const z = parseInt(s.zIndex, 10);
            if (!isNaN(z) && z > 10 && s.position !== "static") {
              return { inDialog: true, dialogText: el2.textContent ?? "" };
            }
            el2 = el2.parentElement;
          }
          return { inDialog: false, dialogText: "" };
        }).catch(() => ({ inDialog: false, dialogText: "" }));

        if (!inDialog) continue;

        const kind: ModalKind = classifyModal(dialogText) ?? "blocker";
        await btn.click({ force: true }).catch(() => {});
        dismissed.push(`${kind}: "${dialogText.trim().slice(0, 60)}"`);
      }
    } catch { /* continue to next frame */ }
  }
  return dismissed.join("; ");
}

/** @deprecated use dismissBlockingModals */
async function dismissCouponErrorPopups(rawPage: Page): Promise<boolean> {
  const result = await dismissBlockingModals(rawPage);
  return result.length > 0;
}

async function assessBookingStage(params: {
  rawPage: Page;
  stagehand: Stagehand;
  startUrl: string;
  requestedDates: RequestedStayDates;
  agentMessage?: string;
}): Promise<BookingStageAssessment> {
  const { rawPage, stagehand, startUrl, requestedDates, agentMessage = "" } = params;
  // Dismiss any coupon/promo-code error popups before reading page state —
  // they block the booking flow without changing the underlying stage.
  await dismissCouponErrorPopups(rawPage).catch(() => {});
  const currentUrl = await resolveCurrentUrl(rawPage, stagehand, startUrl);
  const pageText = await readCombinedText(rawPage);
  const visibleCheckoutFields = await hasVisibleCheckoutFields(rawPage);
  const stalledAtIntermediateBookNow = await looksLikeIntermediateBookNowGateState(rawPage, pageText);
  const stalledAtDateSelection = looksLikeDateSelectionGate(pageText, requestedDates, currentUrl);
  const stalledAtRoomSelection = looksLikeRoomSelectionGate(pageText);
  const bookingComFinalPaymentState = await isBookingComFinalPaymentDomState(rawPage, currentUrl);
  const bookingComGuestDetailsStep =
    !bookingComFinalPaymentState &&
    (
      looksLikeBookingComGuestDetailsStep(pageText, currentUrl) ||
      await isBookingComGuestDetailsDomState(rawPage, currentUrl)
    );
  const bookingComSearchResults = isBookingComSearchResultsUrl(currentUrl);
  const bookingComHotelDetailPage = looksLikeBookingComHotelDetailPage(pageText, currentUrl);
  const bookingComHotelDetailUrl =
    currentUrl.includes("booking.com/hotel/") &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");
  const bookingComNonCheckoutUrl =
    isBookingComUrl(currentUrl) &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");
  const hitPaymentUrl = isPaymentUrl(currentUrl);

  const listingSignals =
    pageText.includes("select dates to continue") ||
    pageText.includes("select check-in and check-out") ||
    pageText.includes("enter your dates") ||
    pageText.includes("add dates for prices") ||
    pageText.includes("select dates to see pricing") ||
    pageText.includes("select dates for prices") ||
    pageText.includes("check availability") ||
    pageText.includes("see availability") ||
    pageText.includes("search results") ||
    pageText.includes("browse the results for") ||
    pageText.includes("properties found") ||
    pageText.includes("property found") ||
    pageText.includes("smart filters") ||
    pageText.includes("filter by") ||
    (pageText.includes("book now") && pageText.includes("select dates")) ||
    (pageText.includes("avg / night") && pageText.includes("check availability"));

  const bookingProgressSignals =
    pageText.includes("your reservation") ||
    pageText.includes("review your booking") ||
    pageText.includes("review and pay") ||
    pageText.includes("confirm and pay") ||
    pageText.includes("request to book") ||
    pageText.includes("guest details") ||
    pageText.includes("guest information") ||
    pageText.includes("card number") ||
    pageText.includes("credit card") ||
    // Chinese Booking.com checkout signals
    pageText.includes("输入个人信息") ||
    pageText.includes("完成预订") ||
    pageText.includes("信用卡") ||
    pageText.includes("持卡人") ||
    pageText.includes("电子邮箱地址") ||
    hitPaymentUrl;

  const blocked =
    agentMessage.includes("challenge page") ||
    agentMessage.includes("something went wrong") ||
    agentMessage.includes("access denied") ||
    agentMessage.includes("bot detection") ||
    agentMessage.includes("cloudflare") ||
    agentMessage.includes("prevented further navigation") ||
    agentMessage.includes("couldn't proceed") ||
    agentMessage.includes("site can't be reached") ||
    agentMessage.includes("err_tunnel") ||
    agentMessage.includes("err_connection") ||
    agentMessage.includes("dns_probe") ||
    pageText.includes("something went wrong") ||
    pageText.includes("access denied") ||
    pageText.includes("enable javascript") ||
    pageText.includes("this site can't be reached") ||
    pageText.includes("err_tunnel_connection_failed") ||
    pageText.includes("err_connection_refused") ||
    pageText.includes("dns_probe_finished_nxdomain") ||
    (pageText.includes("reference no") && pageText.includes("went wrong"));

  const paymentLikeSignals =
    hitPaymentUrl ||
    pageText.includes("cvv") ||
    pageText.includes("security code") ||
    pageText.includes("pay now") ||
    pageText.includes("confirm payment") ||
    pageText.includes("complete purchase") ||
    pageText.includes("complete booking") ||
    pageText.includes("payment card") ||
    containsAny(pageText, PAYMENT_KEYWORDS) ||
    visibleCheckoutFields;
  const hitPaymentGate =
    !bookingComSearchResults &&
    !bookingComHotelDetailPage &&
    !bookingComNonCheckoutUrl &&
    paymentLikeSignals;

  // ── Agent-message fallback for cross-origin JS widgets (e.g. Namastay) ──────
  // When the booking widget injects its content via JS into a cross-origin
  // context, all DOM queries return empty / zero, so DOM-based detection
  // fails.  The AI agent however uses computer vision (screenshots) and
  // accurately describes the page in its result message.  Use those signals
  // as a reliable secondary source.
  const agentSaysBookNowGate =
    !stalledAtIntermediateBookNow &&
    !blocked &&
    (agentMessage.includes("book now") || agentMessage.includes("reserve now")) &&
    // exclude cases where the agent already filled card fields (real payment gate)
    !agentMessage.includes("cvv") &&
    !agentMessage.includes("security code") &&
    !agentMessage.includes("name on card") &&
    !agentMessage.includes("card number was") &&
    // require at least one policy/gate signal
    (agentMessage.includes("cancellation") ||
     agentMessage.includes("guarantee") ||
     agentMessage.includes("privacy") ||
     agentMessage.includes("policy") ||
     agentMessage.includes("agree") ||
     agentMessage.includes("stopped") ||
     agentMessage.includes("booking detail") ||
     agentMessage.includes("review"));

  const effectiveStalledAtIntermediateBookNow = stalledAtIntermediateBookNow || agentSaysBookNowGate;

  let stage: BookingStage = "unknown";
  let reason = "No stage matched current page signals.";

  if (blocked) {
    stage = "blocked";
    reason = "Blocking or anti-bot signals are visible.";
  } else if (bookingComSearchResults && listingSignals) {
    stage = "listing";
    reason = "Booking.com search results are visible and booking has not started yet.";
  } else if (bookingComHotelDetailUrl && !bookingComGuestDetailsStep && !visibleCheckoutFields) {
    stage = "room_selection";
    reason = "Booking.com hotel detail URL is active and checkout has not started yet.";
  } else if (bookingComHotelDetailPage) {
    stage = "room_selection";
    reason = "Booking.com hotel detail page is visible; pricing/room selection still needs to be opened.";
  } else if (bookingComFinalPaymentState) {
    stage = "payment_gate";
    reason = "Booking.com final payment details are visible after the guest-details step.";
  } else if (bookingComGuestDetailsStep) {
    stage = "checkout_form";
    reason = "Booking.com guest-details step is visible before the final details/payment page.";
  } else if (hitPaymentUrl && !visibleCheckoutFields) {
    // URL-based payment detection is reliable when there are no editable guest
    // form fields visible. If form fields ARE visible, we're on Step 2 (Your Details)
    // of Booking.com's flow — not yet at the final payment step.
    stage = "payment_gate";
    reason = "URL matches a payment/checkout pattern and no editable form fields found.";
  } else if (effectiveStalledAtIntermediateBookNow && !visibleCheckoutFields) {
    // Only classify as intermediate_gate when checkout fields are NOT yet visible.
    // If the form fields are already present (First Name / Email / etc.), the agent
    // already clicked "Book Now" and we are on the real guest form — don't regress.
    stage = "intermediate_gate";
    reason = stalledAtIntermediateBookNow
      ? "Review-and-pay gate is visible before real checkout fields."
      : "Agent message indicates an intermediate Book Now gate (DOM unreadable — cross-origin widget).";
  } else if (stalledAtDateSelection) {
    stage = "date_selection";
    reason = "Requested dates are selected, but the widget is still at the date picker step.";
  } else if (stalledAtRoomSelection) {
    stage = "room_selection";
    reason = "Room/rate selection content is visible and checkout has not been reached.";
  } else if (hitPaymentGate) {
    stage = "payment_gate";
    reason = "Payment-like signals or checkout fields are visible.";
  } else if (listingSignals && !bookingProgressSignals) {
    stage = "listing";
    reason = "The page still looks like a listing/search flow without booking progress.";
  }

  return {
    stage,
    reason,
    currentUrl,
    pageText,
    hitPaymentUrl,
    hitPaymentGate,
    visibleCheckoutFields,
    stalledAtDateSelection,
    stalledAtRoomSelection,
    stalledAtIntermediateBookNow: effectiveStalledAtIntermediateBookNow,
    listingSignals,
    bookingProgressSignals,
    blocked,
  };
}

async function resolveCurrentUrl(
  rawPage: Page,
  stagehand: Stagehand,
  startUrl: string
): Promise<string> {
  let currentUrl = getScopeUrl(rawPage);

  try {
    const candidateUrls = new Set<string>([
      currentUrl,
      ...rawPage.frames().map((frame) => getScopeUrl(frame)),
    ]);

    for (const page of stagehand.context.pages()) {
      candidateUrls.add(getScopeUrl(page));
      const rawChildPage = getRawPage(page);
      for (const frame of rawChildPage.frames()) {
        candidateUrls.add(getScopeUrl(frame));
      }
    }

    for (const url of candidateUrls) {
      if (!url || url === "about:blank") continue;
      if (isPaymentUrl(url)) return url;
      if (url !== startUrl && url.startsWith("http")) currentUrl = url;
    }
  } catch {
    // Ignore best-effort URL resolution failures.
  }

  return currentUrl;
}

/**
 * Run a booking task on any website using AI vision.
 *
 * The agent navigates the site, fills all known fields (name / email / phone /
 * dates / party size), and stops before entering payment information.
 * Returns a screenshot and the handoff URL so the user can complete payment.
 */
export async function runBrowserTask(
  input: BrowserTaskInput
): Promise<BrowserTaskResult> {
  const debugTrace: string[] = [];
  const trace = (message: string) => {
    debugTrace.push(message);
    // Print to terminal in dev so you can follow execution without opening the DB.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[stagehand] ${message}`);
    }
  };

  const useCloud =
    !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);

  // Vercel serverless has no Chromium — local mode will crash with a confusing
  // error. Fail fast with an actionable message instead.
  // To re-enable cloud browser: set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
  // in Vercel environment variables (Settings → Environment Variables).
  // Future option: set WORKER_URL to a Railway/Render worker that runs Playwright.
  const onVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  if (onVercel && !useCloud) {
    return {
      status: "error" as const,
      error: "Browser automation requires a cloud browser on Vercel. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in your Vercel environment variables, or deploy the worker service to Railway.",
      sessionUrl: undefined,
      handoffUrl: input.startUrl,
      summary: "Browser automation unavailable on Vercel without Browserbase credentials.",
    };
  }

  // Resolve model name — Stagehand v3 uses "provider/model" format
  const modelName = input.agentModel?.model ?? "openai/gpt-4o-mini";

  // Resolve API key from user-supplied config or env fallback
  const modelApiKey = input.agentModel?.apiKey
    ?? (modelName.startsWith("google/") || modelName.includes("gemini")
        ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY)
        : modelName.startsWith("anthropic/") || modelName.includes("claude")
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY);

  // Stagehand reads credentials from env vars (providerEnvVarMap), NOT from the
  // model config object. Inject the resolved key into the correct env var so
  // both constructor-level (act/observe) and agent-level calls can find it.
  if (modelApiKey) {
    if (modelName.startsWith("google/") || modelName.includes("gemini")) {
      process.env.GEMINI_API_KEY = modelApiKey;
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = modelApiKey;
    } else if (modelName.startsWith("anthropic/") || modelName.includes("claude")) {
      process.env.ANTHROPIC_API_KEY = modelApiKey;
    } else {
      process.env.OPENAI_API_KEY = modelApiKey;
    }
  }

  const stagehand = new Stagehand({
    env: useCloud ? "BROWSERBASE" : "LOCAL",
    ...(useCloud && {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      // Residential proxies bypass OTA bot-detection (booking.com, Expedia).
      // Requires Browserbase plan that includes proxies — disable if on free plan.
      ...(process.env.BROWSERBASE_USE_PROXIES === "true" && {
        browserbaseSessionCreateParams: { proxies: true },
      }),
    }),
    model: modelName,  // just the string — Stagehand reads key from env vars above
    verbose: 0,
    disablePino: true,
    // Dev: set PLAYWRIGHT_HEADLESS=false to watch the browser window.
    // slowMo is not in Stagehand v3 localBrowserLaunchOptions — use PLAYWRIGHT_SLOW_MO
    // via the Playwright env var PWDEBUG or by patching context after init() instead.
    ...(!useCloud && {
      localBrowserLaunchOptions: {
        headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      },
    }),
  });

  trace(`Executor starting — model: ${modelName}, browser: ${useCloud ? "Browserbase" : "local"}, proxies: ${process.env.BROWSERBASE_USE_PROXIES === "true"}`);

  // In local mode, keep the browser open when we reach paused_payment so the
  // user can see the pre-filled payment form and enter CVV themselves.
  // Auto-close after 10 minutes.
  let keepBrowserOpen = false;

  try {
    await stagehand.init();
    // v3 API: get active page from context (resolvePage is private)
    const page = stagehand.context.activePage() ?? await stagehand.context.newPage();

    // ── Inject saved session cookies (e.g. Booking.com login) ────────────────
    // Cookies are saved once via: node scripts/save-booking-cookies.mjs
    // They persist your logged-in session so the agent starts already authenticated.
    if (input.startUrl.includes("booking.com")) {
      try {
        const cookiesPath = path.join(process.cwd(), ".booking-cookies.json");
        if (fs.existsSync(cookiesPath)) {
          const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf-8"));
          // Use stagehand.context.addCookies() directly — V3Context exposes this natively
          // and avoids the getRawPage → .context() indirection that may not work in v3.
          await stagehand.context.addCookies(cookies);
          // Override language to English — saved cookies may have Chinese preference.
          await stagehand.context.addCookies([
            { name: "bk_lang",      value: "en-us", domain: ".booking.com", path: "/" },
            { name: "lang",         value: "en-us", domain: ".booking.com", path: "/" },
            { name: "selectedLang", value: "en-us", domain: ".booking.com", path: "/" },
          ]);
          trace(`Injected ${cookies.length} Booking.com session cookies from .booking-cookies.json`);
        } else {
          trace("No .booking-cookies.json found — run: node scripts/save-booking-cookies.mjs");
        }
      } catch (err) {
        trace(`Cookie injection failed: ${err} — proceeding without saved session.`);
      }
    }

    // Navigate to the starting URL
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });

    // Dev: inject a red cursor dot so you can watch the agent interact visually.
    // Inject on the BrowserContext (not the page) so it persists across all tabs/navigations.
    if (process.env.NODE_ENV !== "production" && !useCloud) {
      // stagehand.context is a V3Context wrapper; the underlying Playwright BrowserContext
      // may be exposed as .browserContext or .context — try both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const browserCtx = (stagehand.context as any).browserContext ?? (stagehand.context as any).context ?? null;
      const addInitTarget = browserCtx ?? getRawPage(page);
      await addInitTarget.addInitScript(() => {
        function installCursor() {
          if (document.getElementById("__pw_cursor__")) return;
          const dot = document.createElement("div");
          dot.id = "__pw_cursor__";
          Object.assign(dot.style, {
            position: "fixed", top: "0", left: "0", width: "12px", height: "12px",
            borderRadius: "50%", background: "red", opacity: "0.75",
            pointerEvents: "none", zIndex: "999999", transition: "transform 0.05s",
            transform: "translate(-50%,-50%)",
          });
          (document.body || document.documentElement).appendChild(dot);
          document.addEventListener("mousemove", (e) => {
            dot.style.left = e.clientX + "px";
            dot.style.top  = e.clientY + "px";
          });
        }
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", installCursor);
        } else {
          installCursor();
        }
      });

      // Also inject Booking.com search-bar disabler on every page load.
      // This prevents the agent from typing form values into the top search bar.
      await addInitTarget.addInitScript(() => {
        function lockSearchBar(el: HTMLInputElement) {
          const lockedEl = el as HTMLInputElement & { __sb_locked__?: boolean };
          if (lockedEl.__sb_locked__) return;
          lockedEl.__sb_locked__ = true;
          el.value = "";
          el.setAttribute("readonly", "true");
          el.setAttribute("tabindex", "-1");
          el.style.pointerEvents = "none";
          el.style.opacity = "0.6";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          // Prevent focus and typing via event capture
          el.addEventListener("focus",     (e) => { e.stopPropagation(); (e.target as HTMLElement).blur(); }, true);
            el.addEventListener("mousedown",  (e) => { e.preventDefault(); e.stopPropagation(); }, true);
            el.addEventListener("keydown",    (e) => { e.preventDefault(); e.stopPropagation(); }, true);
            el.addEventListener("beforeinput",(e) => { e.preventDefault(); e.stopPropagation(); }, true);
          }
          function disableBookingSearchBar() {
            if (!location.hostname.includes("booking.com")) return;
            // Only lock on hotel/search pages — NOT on guest-form / checkout pages
            if (location.pathname.includes("/book") || location.pathname.includes("/checkout")) return;
            const searchBarSelectors = [
              "input[name='ss']", "input[placeholder*='目的地']",
              "input[placeholder*='Destination']", "input[placeholder*='destination']",
              "#ss", ".sb-searchbox__input",
            ];
            searchBarSelectors.forEach(sel => {
              document.querySelectorAll<HTMLInputElement>(sel).forEach(lockSearchBar);
            });
          }
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", disableBookingSearchBar);
          } else {
            disableBookingSearchBar();
          }
          const obs = new MutationObserver(disableBookingSearchBar);
          const observeTarget = document.body || document.documentElement;
          if (observeTarget) obs.observe(observeTarget, { childList: true, subtree: true });
        });
    }

    // ── Booking.com: close any open autocomplete dropdown ───────────────────────
    if (isBookingComUrl(page.url())) {
      try { await safePressEscape(getRawPage(page)); } catch { /* ignore */ }
    }

    // ── Booking.com: disable top search bar + scroll to room list ────────────
    // The agent REPEATEDLY types form data (phone, card, names) into the top
    // destination search bar. We neutralise it by:
    //   1. Making the input readonly + blurring it (agent can't type into it)
    //   2. Scrolling the page so the search bar is out of the visible viewport
    //   3. Pressing Escape to close any open autocomplete
    if (isBookingComUrl(page.url())) {
      try {
        await new Promise((r) => setTimeout(r, 1500)); // let page settle
        await getRawPage(page).evaluate(() => {
          // Disable / make readonly every input inside the top search bar widget
          const searchBarSelectors = [
            "input[name='ss']",
            "input[placeholder*='目的地']",
            "input[placeholder*='Destination']",
            "input[placeholder*='destination']",
            "[data-testid='searchbox-tabs-container'] input",
            ".sb-searchbox input",
            "#ss",
          ];
            for (const sel of searchBarSelectors) {
              document.querySelectorAll<HTMLInputElement>(sel).forEach(el => {
                el.value = "";
                el.setAttribute("readonly", "true");
                el.setAttribute("tabindex", "-1");
                el.style.pointerEvents = "none";
                el.blur();
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              });
            }

          // Also scroll to the room availability section
          const roomSection =
            document.querySelector("#hp_availability_tempcontainer") ||
            document.querySelector("[data-testid='availability-cta-btn']") ||
            document.querySelector(".hprt-table") ||
            document.querySelector("[class*='roomType']") ||
            document.querySelector("[class*='room-list']");
          if (roomSection) {
            roomSection.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            window.scrollBy(0, 700);
          }
        });
        await safePressEscape(getRawPage(page));
        trace("Booking.com: disabled top search bar inputs and scrolled to room list.");
      } catch { /* ignore — non-fatal */ }
    }

    // ── Early check: site unreachable (network error before agent runs) ─────
    {
      let earlyText = "";
      try {
        earlyText = (await page.evaluate(() =>
          (document.body?.innerText ?? "").toLowerCase().slice(0, 1000)
        ) as string);
      } catch { /* ignore */ }
      const unreachable =
        earlyText.includes("this site can't be reached") ||
        earlyText.includes("err_tunnel_connection_failed") ||
        earlyText.includes("err_connection_refused") ||
        earlyText.includes("err_name_not_resolved") ||
        earlyText.includes("dns_probe_finished_nxdomain");
      // Bot-detection / error pages on hotel brand sites and OTAs
      const botBlocked =
        earlyText.includes("something went wrong") ||
        earlyText.includes("access denied") ||
        earlyText.includes("reference no.") ||
        earlyText.includes("please enable cookies") ||
        earlyText.includes("checking your browser") ||
        earlyText.includes("show us your human side") ||   // Expedia CAPTCHA
        earlyText.includes("bot or not") ||                // Expedia CAPTCHA title
        earlyText.includes("we can't tell if you're a human") ||  // Expedia CAPTCHA
        earlyText.includes("please type the numbers you hear");    // Expedia audio CAPTCHA
      if (unreachable || botBlocked) {
        const reason = botBlocked ? "Bot detection / error page" : "Network unreachable";
        trace(`${reason} detected on landing page — stopping early.`);
        const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
        const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;
        await stagehand.close();
        return {
          status: "captcha",
          screenshotBase64,
          handoffUrl: input.fallbackUrl ?? input.startUrl,
          sessionUrl,
          summary: botBlocked
            ? "This hotel's website blocked the automated browser. Please book directly via the link."
            : "The hotel's website could not be reached by the automated browser (network error). Open the link to book directly in your own browser.",
          error: `${reason} on landing page.`,
          debugTrace,
        };
      }
    }

    // ── Early check: booking.com search failed — redirect to fallback ────────
    {
      const landedUrl = page.url();
      const bookingComBotRedirect =
        input.startUrl.includes("booking.com/searchresults") &&
        !landedUrl.includes("errorc_searchstring_not_found") && (
          landedUrl.includes("booking.com/index.html") ||
          /booking\.com\/?(\?|#|$)/.test(landedUrl)  // root/homepage redirect = bot detection
        );
      const bookingComFailed =
        landedUrl.includes("errorc_searchstring_not_found") ||
        bookingComBotRedirect;

      if (bookingComFailed) {
        if (bookingComBotRedirect) {
          // Bot redirect — let the user open the original search URL in their own browser
          // (works fine for real browsers, no CAPTCHA)
          trace(`booking.com bot-redirect detected (${landedUrl}). Returning handoff to original search URL.`);
          const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
          const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;
          await stagehand.close();
          return {
            status: "captcha",
            screenshotBase64,
            handoffUrl: input.startUrl,
            sessionUrl,
            summary: "Booking.com detected an automated browser. Click the link to open the search in your own browser and complete booking there.",
            error: "booking.com bot-redirect to index.html.",
            debugTrace,
          };
        }

        // Resolve fallback: prefer explicit input.fallbackUrl, then parse from task string
        const fallback =
          input.fallbackUrl ??
          input.task.match(/fallback URL[^:]*:\s*(https?:\/\/\S+)/i)?.[1]?.replace(/\s.*$/, "");

        if (fallback) {
          // booking.com search failed (errorc_searchstring_not_found) — retry with fallback URL.
          // fallbackUrl is also a booking.com search URL, so no bot-check needed here.
          trace(`booking.com search failed (${landedUrl}). Navigating to fallback: ${fallback}`);
          await page.goto(fallback, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
        } else {
          trace(`booking.com search failed but no fallback URL found. Letting agent handle it.`);
        }
      }
    }

    // Build the agent instruction
    const instruction = buildInstruction(input);

    // Agent uses the same model string — key is already in process.env
    const agent = stagehand.agent({
      // agentMode: "hybrid" — not yet available in this Stagehand v3 build; will
      // default to hybrid automatically in an upcoming release per the SDK warning.
      model: modelName,
      systemPrompt: `You are a booking assistant completing a hotel reservation on behalf of a user. Be decisive — never ask questions, always try the most reasonable action.

GOAL: Complete all steps up to (but NOT including) CVV entry or final payment confirmation.
Required steps in order: dates → room selection → skip upsell pages → guest info form → card number + expiry → STOP.

STOP IMMEDIATELY before: CVV field, "Pay Now", "Confirm Payment", "Complete Purchase", "Complete Booking", "Confirm Booking", "Submit Payment".
DO NOT stop at: "Reserve", "Continue", "Proceed to payment", "Book Now" (intermediate) — click these to advance.

KEY RULES:
- Cookie/consent banner → click "Decline all" / "Reject all" first, then proceed.
- Domain redirect → stay on the redirected site, it is correct.
- "Add Extras" / "Upgrade" upsell page → click "No thanks, skip it" immediately.
- Room selection page → select cheapest room and click Continue/Reserve. Do NOT fill guest info here.
- "Select a Rate" page (shows multiple rate options with prices) → always pick the lowest-priced rate UNLESS the task explicitly mentions breakfast, free cancellation, or a specific rate preference. Click "Select" on that rate to continue.
- Booking.com room list with QUANTITY DROPDOWNS (each room shows a "0" dropdown): find the cheapest available room, change its dropdown from "0" to "1". After setting it to 1, a blue "现在就预订" (Book Now) button will appear in the RIGHT-SIDE SUMMARY PANEL — click that button immediately. Do NOT interact with the search bar at the top of the page. Do NOT navigate away.
- Calendar month wrong → click ‹/› arrow to navigate; verify header before clicking a date.
- IHG/single-date calendar (shows per-night price on each cell, has Stay duration +/− control) → click check-in date ONLY, then use + button to set nights, then CONTINUE.
- If hotel detail page shows wrong dates → update the date picker first, then View Prices.
- "Book Now" at a consent/review summary (no name/email/card fields visible yet) → check terms checkbox, then click it to open the actual form.
- Terms/privacy checkboxes → always check before clicking booking buttons.
- Fill guest fields one at a time; only fill on the actual checkout form page.
- Browser/CORS/reCAPTCHA console errors → ignore, keep going.
- If clicking a button opens a NEW TAB or new browser window → immediately switch focus to that new tab and continue the booking flow there. Do not stay on the original tab.
- On a Booking.com hotel detail page: your FIRST action must be to SCROLL DOWN to find the room list ("空房情况" / "Available rooms"). Do NOT interact with anything at the top of the page. Do NOT click or type into the search bar (the bar showing destination / dates / guests at the very top) — that is for new hotel searches only. Do NOT type the guest's name, email, or any personal info anywhere on this page — that comes on the NEXT page after you click "现在就预订".
- The room list on a Booking.com hotel page is BELOW the fold — you must scroll down to see it. Only after you can see the room rows should you interact with room selection.
- The Booking.com room selection page has TWO distinct areas: (1) the room list with quantity dropdowns in the CENTER, and (2) the summary panel on the RIGHT with the blue "现在就预订" button. The correct sequence is: change dropdown to "1" → immediately click the blue "现在就预订" in the right panel → done. Nothing else happens on this page.
- Booking.com checkout forms may appear in CHINESE. Treat these Chinese labels as their English equivalents: 姓=Last name, 名=First name, 电子邮箱地址=Email, 手机号码=Phone, 国家/地区=Country, 卡号=Card number, 到期日=Expiry date, 持卡人姓名=Cardholder name, 完成预订=Complete booking (STOP before this), 立即付款=Pay now (STOP before this).
- After switching to a new tab, wait for it to fully load before taking any action.

The user will enter CVV and confirm payment themselves.`,
    });

    // For Booking.com hotel detail pages, skip the initial agent run entirely.
    // Our programmatic recovery code handles room selection and form filling directly.
    // Running the agent here wastes 300+ seconds and causes search-bar interference.
    const landedUrlAfterSetup = page.url();
    const openPageUrls = stagehand.context.pages().map((p) => getScopeUrl(getRawPage(p)));
    const bookingComPageOpen =
      isBookingComUrl(input.startUrl) ||
      isBookingComUrl(landedUrlAfterSetup) ||
      openPageUrls.some((url) => isBookingComUrl(url));
    const initialMaxSteps = bookingComPageOpen ? 0 : 40;

    trace(`Agent starting main run (maxSteps=${initialMaxSteps}, model=${modelName})${bookingComPageOpen ? " [Booking.com detected: agent.execute disabled, using programmatic flow only]" : ""}`);
    const t0 = Date.now();
    const result = initialMaxSteps === 0
      ? { message: "Skipped initial agent run — Booking.com programmatic flow active." }
      : await agent.execute({ instruction, maxSteps: 40 }) as AgentExecutionResult;

    // ── Switch to the most relevant open tab ──────────────────────────────
    // Some hotel sites open a new tab when "Book Now" is clicked (e.g. Radio Hotel).
    // After the agent run, find the most recently opened non-blank page that is NOT
    // the original start URL, and use it for all subsequent DOM operations.
    let activePage = page;
    try {
      const allPages = stagehand.context.pages();
      // Prefer the newest page that has a real URL and isn't the original start URL.
      const newerPages = allPages.filter((p) => {
        const u = getScopeUrl(getRawPage(p));
        return u && u !== "about:blank" && u !== input.startUrl;
      });
      if (newerPages.length > 0) {
        // Last in the array = most recently opened tab.
        activePage = newerPages[newerPages.length - 1];
        trace(`Switched active page to newest tab: ${getScopeUrl(getRawPage(activePage)).slice(0, 80)}`);
      }
    } catch {
      // ignore — keep using the original page
    }
    const raw = getRawPage(activePage);
    const mainMsg = (result.message ?? "").slice(0, 200);
    trace(`Agent finished main run in ${((Date.now() - t0) / 1000).toFixed(1)}s — message: "${mainMsg.slice(0, 120)}"`);

    // Detect fatal API errors (out of credits, invalid key, quota exceeded).
    // Continuing the recovery loop is pointless — every agent call will fail too.
    const fatalApiError =
      /credit balance is too low|insufficient_quota|invalid.{0,20}api.{0,20}key|rate limit exceeded|payment required|quota exceeded|credits? exhausted|billing error|billing issue|browser minutes limit/i.test(mainMsg);
    if (fatalApiError) {
      return {
        status: "error" as const,
        error: `AI model API error: ${mainMsg.slice(0, 300)}`,
        handoffUrl: input.startUrl,
        sessionUrl: useCloud ? stagehand.browserbaseSessionURL : undefined,
        summary: "Booking stopped: the AI model API returned a billing or quota error. Check your API key credits.",
        debugTrace,
      };
    }

    // Check ALL open pages ― booking sites often open a new tab for the
    // checkout flow, so activePage() may still point to the original hotel
    // homepage while the real booking progress is in another tab.
    let agentMessage = (result.message ?? "").toLowerCase();
    let currentUrl = await resolveCurrentUrl(raw, stagehand, input.startUrl);
    const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;

    const p = buildEffectiveProfile(input.profile, input.task);
    const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);
    trace(`Profile check: hasProfile=${hasProfile}, fields=${[p.full_name?"full_name":null, p.first_name?"first_name":null, p.email?"email":null, p.phone?"phone":null].filter(Boolean).join(",") || "none"}`);
    const requestedDates = extractRequestedStayDates(input.task);
    const targetHotelName =
      extractTargetHotelName(input.task) ||
      extractTargetHotelNameFromUrl(input.startUrl) ||
      extractTargetHotelNameFromUrl(currentUrl);
    trace(`Target hotel: ${targetHotelName ?? "unknown"}`);
    let assessment = await assessBookingStage({
      rawPage: raw,
      stagehand,
      startUrl: input.startUrl,
      requestedDates,
      agentMessage,
    });
    let pageText = assessment.pageText;
    currentUrl = assessment.currentUrl;

    const buildStageRecoveryInstruction = (stage: BookingStage): string => {
      switch (stage) {
        case "date_selection":
          return `Continue the CURRENT hotel booking from the booking widget.

The requested dates are already selected.
Click only the booking widget button that advances the flow, such as "Next" or "Continue", near the selected dates / guests summary.
Do NOT click generic page controls like "Next Slide", page carousels, gallery arrows, or site navigation.`;
        case "room_selection":
          return `Continue the CURRENT hotel booking from the room-selection step.

Choose the best available room or rate inside the booking widget, then click only the booking widget button that advances to checkout, such as "Select", "Select room", "Proceed to payment", or "Continue".
Do NOT click "Add more rooms", page carousels, gallery arrows, or site navigation.`;
        case "intermediate_gate":
          return `Continue the CURRENT hotel booking from the review-and-pay gate.

If a privacy-policy or terms checkbox is present, check it.
Then click the intermediate booking button inside the widget, such as "Book Now" or "Reserve Now", to reach the actual guest/payment form.
Do NOT stop at the review summary and do NOT treat this as the final payment step yet.`;
        default:
          return `Continue the CURRENT hotel booking from the current booking widget state and advance to the actual guest/payment form without using generic page controls.`;
      }
    };

    const attemptStageRecovery = async (stage: BookingStage): Promise<boolean> => {
      // Always clear blocking modals before any recovery attempt.
      const cleared = await dismissBlockingModals(raw).catch(() => "");
      if (cleared) trace(`Stage recovery dismissed modal(s) before ${stage}: ${cleared}`);
      const bookingComContext =
        isBookingComUrl(raw.url()) ||
        isBookingComUrl(currentUrl) ||
        bookingComPageOpen;

      switch (stage) {
        case "listing": {
          if (bookingComContext) {
            if (!targetHotelName) {
              trace("Booking.com listing: target hotel name could not be parsed from the task.");
              return false;
            }
            const clicked = await clickBookingComListingTarget(raw, targetHotelName, trace);
            if (!clicked) {
              trace(`Booking.com listing: no clickable result matched "${targetHotelName}".`);
              return false;
            }
            return true;
          }
          return false;
        }
        case "date_selection": {
          const clicked = await clickAllowedAdvanceButton(raw, DATE_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" to advance the date-selection gate.`);
            return true;
          }
          // Never run AI agent for date_selection on Booking.com — it types in the search bar.
          if (bookingComContext) {
            trace("Booking.com date_selection: skipping AI agent to prevent search-bar interference.");
            return false;
          }
          trace("No deterministic date-selection advance button was found, so a stage-specific agent recovery pass is running.");
          await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 8 });
          return true;
        }
        case "room_selection": {
          // ── Booking.com: use Playwright native selectOption() + JS click ──────
          // NEVER fall back to AI agent on Booking.com — it always types in the
          // search bar instead of selecting rooms.
          if (bookingComContext) {
            try {
              const beforeUrl = raw.url();
              await revealBookingComRoomSelection(raw, trace);
              await raw.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))).catch(() => {});
              await new Promise((r) => setTimeout(r, 120));

              // Find all <select> elements that have 0/1/2... room quantity options.
              // Use Playwright's selectOption() which properly triggers React's onChange.
              const allSelects = raw.locator("select");
              const count = await allSelects.count().catch(() => 0);
              let selectedDropdown = false;

              // First pass: check if any dropdown is already > 0 (previously set)
              for (let i = 0; i < count; i++) {
                const sel = allSelects.nth(i);
                try {
                  const val = await sel.inputValue().catch(() => "");
                  const opts = await sel.evaluate((el: HTMLSelectElement) =>
                    Array.from(el.options).map(o => o.value)
                  ).catch(() => [] as string[]);
                  if (opts.includes("0") && opts.includes("1") && val !== "0") {
                    trace(`Booking.com: dropdown ${i} already set to ${val} — skipping select step.`);
                    selectedDropdown = true;
                    break;
                  }
                } catch { /* skip */ }
              }

              // Second pass: find cheapest dropdown at "0" and set it to "1"
              if (!selectedDropdown) {
                // Collect price+index pairs to pick cheapest
                type DropInfo = { idx: number; price: number };
                const candidates: DropInfo[] = [];
                for (let i = 0; i < count; i++) {
                  const sel = allSelects.nth(i);
                  try {
                    const opts = await sel.evaluate((el: HTMLSelectElement) =>
                      Array.from(el.options).map(o => o.value)
                    ).catch(() => [] as string[]);
                    if (!opts.includes("0") || !opts.includes("1")) continue;
                    const val = await sel.inputValue().catch(() => "0");
                    if (val !== "0") continue;
                    // Try to get price from nearest ancestor row
                    const price = await sel.evaluate((el) => {
                      const row = el.closest("tr, [class*='room'], div");
                      const m = (row?.textContent ?? "").match(/\$\s*([\d,]+)/);
                      return m ? parseFloat(m[1].replace(",", "")) : Infinity;
                    }).catch(() => Infinity);
                    candidates.push({ idx: i, price });
                  } catch { /* skip */ }
                }
                candidates.sort((a, b) => a.price - b.price);

                for (const { idx } of candidates) {
                  try {
                    const sel = allSelects.nth(idx);
                    await sel.scrollIntoViewIfNeeded().catch(() => {});
                    await sel.selectOption("1");
                    trace(`Booking.com: set room dropdown index ${idx} to "1" via selectOption().`);
                    selectedDropdown = true;
                    await Promise.allSettled([
                      waitForVisibleActionText(raw, ["I'll reserve", "I’ll reserve", "I will reserve", "reserve now"], 3500),
                      raw.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}),
                    ]);
                    break;
                  } catch (e) {
                    trace(`Booking.com: selectOption on dropdown ${idx} failed: ${e}`);
                  }
                }
              }

              if (!selectedDropdown) {
                const domSet = await setBookingComRoomQuantity(raw);
                if (domSet.ok) {
                  selectedDropdown = true;
                  trace(`Booking.com: ${domSet.summary} via DOM strategy.`);
                  await Promise.allSettled([
                    waitForVisibleActionText(raw, ["I'll reserve", "I鈥檒l reserve", "I will reserve", "reserve now"], 3500),
                    raw.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {}),
                  ]);
                } else {
                  trace(`Booking.com: ${domSet.summary}.`);
                  trace("Booking.com: could not find or set any room quantity dropdown.");
                }
              }

              // Click "I'll reserve" — use Playwright locator click (real mouse event),
              // falling back to JS click. Use /reserve/i to avoid apostrophe issues.
              await raw.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))).catch(() => {});
              await new Promise((r) => setTimeout(r, 120));

              const rawWithRole = raw as typeof raw & {
                getByRole?: (role: string, options?: { name?: RegExp | string }) => ReturnType<typeof raw.locator>;
              };
              if (!rawWithRole.getByRole) {
                rawWithRole.getByRole = () => raw.locator("__codex_missing_getByRole__");
              }

              for (let attempt = 0; attempt < 3; attempt++) {
                // Strategy 1: Playwright locator click (triggers all mouse events)
                let clicked = false;
                try {
                  const reserveCandidates = [
                    raw.locator("button:has-text(\"I'll reserve\")").first(),
                    raw.locator("button:has-text(\"I’ll reserve\")").first(),
                    raw.locator("button:has-text(\"I will reserve\")").first(),
                    raw.locator("button:has-text(\"现在就预订\")").first(),
                    raw.locator("button:has-text(\"立即预订\")").first(),
                    raw.getByRole("button", { name: /i['’]ll reserve|i will reserve/i }).first(),
                    raw.getByRole("button", { name: /现在就预订|立即预订/i }).first(),
                  ];
                  for (const reserveLocator of reserveCandidates) {
                    if (!await reserveLocator.isVisible({ timeout: 1200 }).catch(() => false)) continue;
                    await reserveLocator.scrollIntoViewIfNeeded().catch(() => {});
                    await new Promise((r) => setTimeout(r, 80));
                    await reserveLocator.click({ force: true, timeout: 5000 });
                    clicked = true;
                    trace(`Booking.com: Playwright-clicked "reserve" button on attempt ${attempt + 1}.`);
                    break;
                  }
                } catch (e) {
                  trace(`Booking.com: Playwright click failed on attempt ${attempt + 1}: ${e}`);
                }

                // Strategy 2: JS click fallback
                if (!clicked) {
                  clicked = await raw.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll("button"));
                    const normalize = (value: string) =>
                      value.toLowerCase().replace(/\s+/g, " ").trim();
                    const btn =
                      btns.find((b) => {
                        const text = normalize(b.textContent ?? "");
                        const rect = (b as HTMLElement).getBoundingClientRect();
                        const onRightSide = rect.left >= window.innerWidth * 0.55;
                        const explicitBookingCta =
                          text.includes("i'll reserve") ||
                          text.includes("i’ll reserve") ||
                          text.includes("i will reserve") ||
                          text.includes("现在就预订") ||
                          text.includes("立即预订");
                        return explicitBookingCta && onRightSide;
                      }) ??
                      btns.find((b) => {
                        const text = normalize(b.textContent ?? "");
                        return (
                          text.includes("i'll reserve") ||
                          text.includes("i’ll reserve") ||
                          text.includes("i will reserve") ||
                          text.includes("现在就预订") ||
                          text.includes("立即预订")
                        );
                      });
                    if (!btn) return false;
                    btn.scrollIntoView({ block: "center" });
                    btn.click();
                    return true;
                  }).catch(() => false);
                  if (clicked) trace(`Booking.com: JS-clicked "reserve" button on attempt ${attempt + 1}.`);
                }

                if (clicked) {
                  await Promise.allSettled([
                    raw.waitForLoadState("domcontentloaded", { timeout: 5000 }),
                    waitForPageSignals(raw, {
                      fromUrl: beforeUrl,
                      untilUrlIncludes: ["secure.booking.com/book", "booking.com/book"],
                      untilTextIncludes: [
                        "enter your details",
                        "your details",
                        "phone number",
                        "your arrival time",
                      ],
                      timeoutMs: 8000,
                    }),
                  ]);
                  break;
                }
                trace(`Booking.com: reserve button not found on attempt ${attempt + 1}, waiting...`);
                await new Promise((r) => setTimeout(r, 250));
              }

              return true; // Always return true — never let AI agent handle this on Booking.com
            } catch (e) {
              trace(`Booking.com room selection failed: ${e}`);
              return true; // Still return true to prevent AI agent from taking over
            }
          }

          // Non-Booking.com: try deterministic button click first, then AI agent
          const clicked = await clickAllowedAdvanceButton(raw, ROOM_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" on the room-selection stage.`);
            return true;
          }
          if (bookingComContext) {
            trace("Booking.com room_selection: deterministic controls were not enough, and agent.execute fallback is disabled.");
            return false;
          }
          trace("No deterministic room-selection advance button was found, so a stage-specific agent recovery pass is running.");
          const tr0 = Date.now();
          const rResult = await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 10 } as AgentExecutionResult);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trace(`Room-selection recovery finished in ${((Date.now() - tr0) / 1000).toFixed(1)}s — "${((rResult as any)?.message ?? "").slice(0, 80)}"`);
          return true;
        }
        case "intermediate_gate": {
          const checkedBoxes = await clickAgreementCheckboxes(raw);
          trace(
            checkedBoxes > 0
              ? `Stage recovery checked ${checkedBoxes} consent/privacy checkbox(es) inside the booking widget.`
              : "Stage recovery did not find a new consent/privacy checkbox to check inside the booking widget."
          );
          // Wait for React state to propagate after checkbox check — the "Book Now"
          // button is often disabled until the privacy checkbox is ticked, so clicking
          // it immediately after check() returns will find it still disabled.
          await new Promise((resolve) => setTimeout(resolve, 700));
          let clicked = await clickAllowedAdvanceButton(raw, INTERMEDIATE_GATE_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" on the intermediate booking gate.`);
            return true;
          }
          // Retry once with a force-click that bypasses the isLocatorEnabled guard,
          // in case the button's disabled attribute was removed but not yet reflected.
          clicked = await clickAdvanceButton(raw, INTERMEDIATE_GATE_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery force-clicked "${clicked}" on the intermediate booking gate (retry).`);
            return true;
          }
          if (bookingComContext) {
            trace("Booking.com intermediate_gate: deterministic controls were not enough, and agent.execute fallback is disabled.");
            return false;
          }
          trace("No deterministic intermediate booking button was found, so a stage-specific agent recovery pass is running.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 8 } as any);
          return true;
        }
        default:
          return false;
      }
    };

    const noAvailabilitySignals = [
      "no availability", "no rooms available", "no rates available",
      "fully booked", "sold out", "not available for", "no vacancies",
      "couldn't find the room", "could not find the room",
      "unavailable for your dates", "no properties available",
      "0 properties", "0 results",
    ];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      trace(`Stage assessment ${attempt + 1}: ${assessment.stage} — ${assessment.reason}`);
      if (!["listing", "date_selection", "room_selection", "intermediate_gate"].includes(assessment.stage)) {
        break;
      }

      if (assessment.stage === "room_selection" &&
          containsAny(assessment.pageText, noAvailabilitySignals)) {
        trace(`No-availability signal detected at room_selection — aborting recovery loop.`);
        break;
      }

      // Also bail if the agent message already told us there are no rooms.
      const agentSaysNoAvailability = /no (rooms?|availability|vacancies|rates?)|sold out|fully booked|not available/i.test(agentMessage);
      if (assessment.stage === "room_selection" && agentSaysNoAvailability) {
        trace(`Agent message indicates no availability — aborting recovery loop.`);
        break;
      }

      const acted = await attemptStageRecovery(assessment.stage);
      if (!acted) break;

      const postActionWaitMs =
        bookingComPageOpen || isBookingComUrl(currentUrl) || isBookingComUrl(raw.url())
          ? 350
          : 2500;
      await new Promise((resolve) => setTimeout(resolve, postActionWaitMs));
      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      pageText = assessment.pageText;
      currentUrl = assessment.currentUrl;
    }

    // ── Unknown stage: agent may have stopped mid-flow (maxSteps exhausted) ──
    // If the stage is unknown after the main run (no recognisable page signals),
    // run one more agent pass to continue from wherever it left off.
    // EXCEPTION: Never run continuation agent on Booking.com — it always types in
    // the search bar and navigates to the wrong hotel.
    if (
      assessment.stage === "unknown" &&
      !isBookingComUrl(input.startUrl) &&
      !isBookingComUrl(currentUrl) &&
      !isBookingComUrl(raw.url())
    ) {
      trace("Stage is unknown after main run — running a continuation pass (maxSteps=20).");
      const continuationInstruction =
        `You are continuing a hotel booking that was interrupted mid-flow. ` +
        `The target hotel URL is: ${input.startUrl}. ` +
        `Look at the current state of the browser and continue the booking process from where it left off. ` +
        `Your goal is to reach the payment/checkout page filled with the guest's information. ` +
        `Do NOT submit or pay — stop just before the final payment button.`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contResult = await agent.execute({ instruction: continuationInstruction, maxSteps: 20 }) as any;
      const contMsg: string = contResult?.message ?? contResult?.output ?? "";
      trace(`Continuation pass finished — message: "${contMsg.slice(0, 120)}"`);
      // Update agentMessage so all downstream checks (hitPaymentGate, field verification) see the latest message.
      if (contMsg) agentMessage = contMsg;
      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage: contMsg || agentMessage,
      });
      pageText = assessment.pageText;
      currentUrl = assessment.currentUrl;
      trace(`Post-continuation stage: ${assessment.stage} — ${assessment.reason}`);
    }

    // ── Detect stuck at listing/search page ───────────────────────────────
    // Signs that we are still on the hotel listing / search page and never
    // reached a real booking or checkout step.
    if (assessment.stage === "listing") {
      trace("Final state check concluded the run was still on a listing/date-selection page.");
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The requested dates are unavailable or couldn't be selected on this property. Open the link to choose different dates or book manually.",
        error: "Stuck at listing page — dates unavailable or not selectable",
        debugTrace,
      };
    }

    // ── Direct form-fill fallback ─────────────────────────────────────────
    // If the agent landed on a guest info / checkout form but left fields empty
    // (e.g. because reCAPTCHA console errors confused it), fill them directly
    // using page.act() — lower-level than the agent and not blocked by reCAPTCHA.
    const visibleCheckoutFields = assessment.visibleCheckoutFields;
    // For Booking.com's checkout URL (Step 2 + Step 3), always treat as guest form
    // regardless of visibleCheckoutFields — the step 2 form fields may not be detected
    // by the generic hasVisibleCheckoutFields heuristic.
    // NOTE: Use raw.url() and input.startUrl in addition to currentUrl because
    // resolveCurrentUrl() can pick a non-booking.com iframe URL (analytics/tracking),
    // which would make isBookingCom=false and trigger fillFieldsInScopes incorrectly.
    const rawPageUrl = raw.url();
    const isBookingComCheckout =
      currentUrl.includes("secure.booking.com") || currentUrl.includes("booking.com/book") ||
      rawPageUrl.includes("secure.booking.com") || rawPageUrl.includes("booking.com/book");
    const onGuestForm =
      hasProfile &&
      assessment.stage !== "intermediate_gate" &&
      (visibleCheckoutFields || isBookingComCheckout);

    trace(`Post-recovery state: stage=${assessment.stage}, visibleCheckoutFields=${visibleCheckoutFields}, hasProfile=${hasProfile}, onGuestForm=${onGuestForm}, isBookingComCheckout=${isBookingComCheckout}, rawPageUrl=${rawPageUrl.slice(0, 80)}, currentUrl=${currentUrl.slice(0, 80)}`);

    if (onGuestForm) {
      trace("Detected guest/payment form and started direct field-fill verification.");

      // ── Booking.com: always run programmatic fill regardless of pre-filled state ──
      // The account often pre-fills wrong values (wrong name order, wrong country/phone code).
      // We must override these with the correct profile values every time.
      // Use input.startUrl as the authoritative Booking.com check — currentUrl may be a
      // non-booking.com URL resolved from an analytics/tracking iframe by resolveCurrentUrl().
      const isBookingCom =
        currentUrl.includes("booking.com") ||
        rawPageUrl.includes("booking.com") ||
        input.startUrl.includes("booking.com");
      if (isBookingCom && assessment.stage === "checkout_form") {
        trace("Booking.com guest form detected — running programmatic field fill (overrides account pre-fill).");
        await fillBookingComGuestForm(raw, p, trace);
        await new Promise(r => setTimeout(r, 600));
      }

      if (isBookingCom && assessment.stage === "payment_gate") {
        trace("Booking.com payment page detected — running card-field fill fallback.");
        await fillBookingComPaymentFormV2(raw, p, trace);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (isBookingCom && !["checkout_form", "payment_gate"].includes(assessment.stage)) {
        trace(`Booking.com checkout is open at stage=${assessment.stage}; skipping guest-form override until stage is clearer.`);
      }

      // Check whether the form is already filled (profile email visible in input values)
      let alreadyFilled = false;
      if (p.email) {
        alreadyFilled = await hasValueInScopes(raw, p.email);
      }

      if (!alreadyFilled && !isBookingCom) {
        trace("Guest/payment fields looked empty, so the direct Playwright fill fallback ran.");
        // Use RAW Playwright fill() ― bypasses Stagehand AI and reCAPTCHA DOM interference.
        // Try matching each field by placeholder text, then by accessible label name.
        const specs: FieldSpec[] = [
          { patterns: ["full name"], value: p.full_name ?? "" },
          { patterns: ["first name", "given name", "firstname"], value: p.first_name ?? "" },
          { patterns: ["last name", "family name", "surname", "lastname"], value: p.last_name ?? "" },
          { patterns: ["phone", "mobile", "telephone"], value: p.phone ?? "" },
          { patterns: ["email", "e-mail"], value: p.email ?? "" },
          { patterns: ["street address", "address line 1", "address 1", "billing address"], value: p.address_line1 ?? "" },
          { patterns: ["city"], value: p.city ?? "" },
          { patterns: ["state", "province"], value: p.state ?? "" },
          { patterns: ["zip", "postal code", "postcode"], value: p.zip ?? "" },
          { patterns: ["country"], value: p.country ?? "" },
          { patterns: ["name on card", "cardholder", "card holder"], value: p.card_name ?? "" },
          { patterns: ["card number", "credit card number"], value: p.card_number ?? "" },
          { patterns: ["expir", "expiry", "mm/yy", "mm / yy"], value: p.card_expiry ?? "" },
        ].filter(s => s.value);

        await fillFieldsInScopes(raw, specs);

        // Small pause so the page can react to filled values (React state updates etc.)
        await new Promise(r => setTimeout(r, 800));

        // Re-read page state after direct fill
        assessment = await assessBookingStage({
          rawPage: raw,
          stagehand,
          startUrl: input.startUrl,
          requestedDates,
          agentMessage,
        });
        currentUrl = assessment.currentUrl;
        pageText = assessment.pageText;
      } else if (!isBookingCom) {
        trace("Guest/payment fields already contained profile data, so direct fill fallback was skipped.");
      }

      // Re-read state after any fills
      if (isBookingCom) {
        assessment = await assessBookingStage({
          rawPage: raw,
          stagehand,
          startUrl: input.startUrl,
          requestedDates,
          agentMessage,
        });
        currentUrl = assessment.currentUrl;
        pageText = assessment.pageText;
      }
    }

    let bookingComFinalPaymentDomState = await isBookingComFinalPaymentDomState(raw, currentUrl);
    let bookingComGuestDetailsDomState =
      !bookingComFinalPaymentDomState &&
      await isBookingComGuestDetailsDomState(raw, currentUrl);

    if (!bookingComFinalPaymentDomState && (looksLikeBookingComGuestDetailsStep(pageText, currentUrl) || bookingComGuestDetailsDomState)) {
      // Booking.com sometimes transitions to the final-details/payment page a beat after
      // the CTA click/requestSubmit completes. Re-check once before declaring failure.
      await Promise.allSettled([
        raw.waitForLoadState("domcontentloaded", { timeout: 5000 }),
        waitForPageSignals(raw, {
          fromUrl: currentUrl,
          untilUrlIncludes: ["secure.booking.com/book"],
          untilTextIncludes: [
            "your payment details",
            "complete booking",
            "when do you want to pay",
            "pay now",
            "pay at the property",
            "card number",
            "credit or debit card",
          ],
          untilTextExcludes: [
            "your arrival time",
            "cribs and extra beds",
            "next: final details",
          ],
          timeoutMs: 7000,
        }),
      ]);

      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      currentUrl = assessment.currentUrl;
      pageText = assessment.pageText;
      bookingComFinalPaymentDomState = await isBookingComFinalPaymentDomState(raw, currentUrl);
      bookingComGuestDetailsDomState =
        !bookingComFinalPaymentDomState &&
        await isBookingComGuestDetailsDomState(raw, currentUrl);
    }

    if (!bookingComFinalPaymentDomState && (looksLikeBookingComGuestDetailsStep(pageText, currentUrl) || bookingComGuestDetailsDomState)) {
      trace("Booking.com final state check: still on guest-details step, so payment/card filling is not allowed yet.");
      const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "Booking.com is still on the guest-details step. Personal details must be completed and 'Next: Final details' must succeed before any card fields are filled.",
        error: "Still on Booking.com guest-details step before final-details/payment page.",
        debugTrace,
      };
    }

    if (bookingComFinalPaymentDomState && isBookingComUrl(currentUrl)) {
      trace("Booking.com final payment page confirmed after guest-details step — running final card-field fill pass.");
      await fillBookingComPaymentFormV2(raw, p, trace);
      await new Promise((resolve) => setTimeout(resolve, 800));

      assessment = await assessBookingStage({
        rawPage: raw,
        stagehand,
        startUrl: input.startUrl,
        requestedDates,
        agentMessage,
      });
      currentUrl = assessment.currentUrl;
      pageText = assessment.pageText;
      bookingComFinalPaymentDomState = await isBookingComFinalPaymentDomState(raw, currentUrl);
    }

    const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;

    // ── Determine final outcome ───────────────────────────────────────────
    const msg = agentMessage;
    const hasEnteredFullName = p.full_name ? await hasValueInScopes(raw, p.full_name) : false;
    const hasEnteredFirstName = p.first_name ? await hasValueInScopes(raw, p.first_name) : false;
    const hasEnteredLastName = p.last_name ? await hasValueInScopes(raw, p.last_name) : false;
    const hasEnteredEmail = p.email ? await hasValueInScopes(raw, p.email) : false;
    const hasEnteredPhone = p.phone ? await hasValueInScopes(raw, p.phone) : false;
    const hasEnteredCardNumber = p.card_number ? await hasValueInScopes(raw, p.card_number) : false;
    const hasEnteredCardExpiry = p.card_expiry ? await hasValueInScopes(raw, p.card_expiry) : false;
    const bookingComPaymentFieldVisibility = await getBookingComPaymentFieldVisibility(raw, currentUrl);
    const bookingComPaymentFieldVerification = await verifyBookingComPaymentFieldValues(raw, currentUrl, p);
    const stalledAtIntermediateBookNow = assessment.stage === "intermediate_gate";
    const stalledAtDateSelection = assessment.stage === "date_selection";
    const stalledAtRoomSelection = assessment.stage === "room_selection";
    const hasRequestedDates = !!(requestedDates.checkin && requestedDates.checkout);
    const selectedDatesMatchRequest = hasRequestedDates
      ? hasRequestedStaySelected(pageText, requestedDates)
      : true;
    // Some booking widgets (e.g. Namastay) show a card-only form in a cross-origin iframe
    // with NO identity fields (name/email/phone). In those cases:
    //  a) Identity fields don't exist on the page → skip identity check
    //  b) Card values may be in a cross-origin iframe → hasValueInScopes can't read them
    // We detect "identity fields absent" via pageText (now CDP-backed, so it sees iframes).
    const pageHasIdentityFields = containsAny(pageText, [
      "first name", "last name", "full name", "your name",
      "email", "e-mail", "phone", "mobile", "contact",
    ]);
    const pageHasFullNameField = containsAny(pageText, ["full name", "your name"]);
    const pageHasFirstNameField = containsAny(pageText, ["first name", "given name"]);
    const pageHasLastNameField = containsAny(pageText, ["last name", "family name", "surname"]);
    const pageHasEmailField = containsAny(pageText, ["email", "e-mail"]);
    const pageHasPhoneField = containsAny(pageText, ["phone number", "phone", "mobile", "telephone"]);

    const identityChecks: boolean[] = [];
    if (pageHasFullNameField) {
      identityChecks.push(hasEnteredFullName || (hasEnteredFirstName && hasEnteredLastName));
    } else {
      if (pageHasFirstNameField) identityChecks.push(hasEnteredFirstName);
      if (pageHasLastNameField) identityChecks.push(hasEnteredLastName);
    }
    if (pageHasEmailField) identityChecks.push(hasEnteredEmail);
    if (pageHasPhoneField) identityChecks.push(hasEnteredPhone);

    const identityOk = pageHasIdentityFields
      ? identityChecks.length > 0 && identityChecks.every(Boolean)
      : true; // card-only form — no identity fields to verify

    // For card fields in cross-origin iframes, hasValueInScopes always returns false.
    // When identity fields are absent (card-only form) we also trust the agent filled them.
    const bookingComVisiblePaymentInputs =
      bookingComPaymentFieldVisibility.cardholder ||
      bookingComPaymentFieldVisibility.cardNumber ||
      bookingComPaymentFieldVisibility.cardExpiry;

    const cardNumberOk =
      !p.card_number ||
      hasEnteredCardNumber ||
      bookingComPaymentFieldVerification.cardNumber;
    const cardExpiryOk =
      !p.card_expiry ||
      hasEnteredCardExpiry ||
      bookingComPaymentFieldVerification.cardExpiry;
    const bookingComPaymentSignalsVisible =
      bookingComFinalPaymentDomState ||
      containsAny(pageText, [
        "your payment details",
        "card number",
        "expiration date",
        "expiry date",
        "credit or debit card",
        "complete booking",
      ]);

    const cardOk = bookingComVisiblePaymentInputs
      ? cardNumberOk && cardExpiryOk
      : bookingComPaymentSignalsVisible
        ? cardNumberOk && cardExpiryOk
        : !pageHasIdentityFields
        ? true  // cross-origin card-only form ― trust the agent only when the fields are not inspectable
        : (!p.card_number || hasEnteredCardNumber) && (!p.card_expiry || hasEnteredCardExpiry);

    const hasMinimumFilledProfile = identityOk && cardOk;

    // ── Detect site blocking (bot detection, Cloudflare, challenge pages) ──
    const wasBlocked = assessment.blocked;

    if (wasBlocked) {
      trace("Final state check detected bot protection / blocking signals.");
      return {
        status: "captcha",
        screenshotBase64,
        handoffUrl: input.startUrl,   // send back to original URL, not the error page
        sessionUrl,
        summary: "The hotel's website blocked the automated browser. Open the link to book directly in your browser — it will work normally there.",
        error: "Site blocked the cloud browser (bot protection). Manual booking required.",
        debugTrace,
      };
    }

    // Agent stopped before CVV/pay button (has filled card number+expiry already)
    // Also treat "agent says it successfully completed filling details" as a payment-gate signal:
    // cross-origin widgets make DOM detection impossible, so the agent's own description is the
    // only reliable signal in those cases.
    const agentClaimsFilledDetails =
      /successfully (completed|filled|entered|submitted).{0,60}(guest|booking|details|information|name|email)/i.test(msg) ||
      /filled.{0,30}(guest|personal|contact|booking).{0,30}(details|information|form)/i.test(msg) ||
      /(first name|last name|full name).{0,60}(filled|entered|submitted|provided)/i.test(msg);
    const hitPaymentGate =
      assessment.hitPaymentGate ||
      agentClaimsFilledDetails ||
      msg.includes("cvv") ||
      msg.includes("security code") ||
      msg.includes("pay now") ||
      msg.includes("confirm payment") ||
      msg.includes("complete purchase") ||
      msg.includes("complete booking") ||
      msg.includes("confirm booking") ||
      msg.includes("payment card") ||
      (msg.includes("credit card") && !msg.includes("filled")) ||
      (msg.includes("card number") && !msg.includes("filled"));

    trace(
      `Final verification: stage=${assessment.stage}; reason=${assessment.reason}; ` +
      `visibleCheckoutFields=${assessment.visibleCheckoutFields}; hitPaymentGate=${hitPaymentGate}; ` +
      `fullName=${hasEnteredFullName}; firstName=${hasEnteredFirstName}; lastName=${hasEnteredLastName}; ` +
      `email=${hasEnteredEmail}; phone=${hasEnteredPhone}; ` +
      `cardNumber=${hasEnteredCardNumber}; cardExpiry=${hasEnteredCardExpiry}; ` +
      `bookingComCardNumber=${bookingComPaymentFieldVerification.cardNumber}; bookingComCardExpiry=${bookingComPaymentFieldVerification.cardExpiry}; ` +
      `selectedDatesMatch=${selectedDatesMatchRequest}`
    );

    if (stalledAtIntermediateBookNow) {
      trace("Final state check shows the run still stopped at the intermediate Book Now gate.");
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The agent stopped at an intermediate booking gate before the actual guest/payment form.",
        error: "Stalled before checkout form — intermediary 'Book Now' step was not completed.",
        debugTrace,
      };
    }

    if (stalledAtDateSelection || stalledAtRoomSelection) {
      // Check if "no availability" is the actual reason rather than a navigation stall.
      const noRooms = containsAny(assessment.pageText, noAvailabilitySignals) ||
        /no (rooms?|availability|vacancies|rates?)|sold out|fully booked|not available/i.test(agentMessage);
      trace(
        stalledAtDateSelection
          ? "Final state check shows the run still stopped at the booking widget date-selection gate."
          : noRooms
            ? "Final state check: no availability for the requested dates."
            : "Final state check shows the run still stopped at room selection before checkout."
      );
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: noRooms
          ? "No rooms available for the requested dates at this property."
          : "The agent stopped before reaching the checkout form.",
        error: stalledAtDateSelection
          ? "Stalled at date selection — booking widget did not advance after selecting dates."
          : noRooms
            ? "No availability — the hotel has no rooms for the requested dates."
            : "Stalled at room selection — checkout form was not reached.",
        debugTrace,
      };
    }

    // Skip date-mismatch check when we've already confirmed payment gate arrival —
    // payment pages often don't re-display dates in the same format, causing false positives.
    if (!selectedDatesMatchRequest && !hitPaymentGate) {
      trace("Final state check found that the selected stay dates did not match the requested check-in/check-out dates.");
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The booking widget ended up on different dates than the ones requested, so the run was stopped instead of risking a wrong booking.",
        error: "Selected dates mismatched the requested stay.",
        debugTrace,
      };
    }

    // Only fail the profile check when we can actually SEE the fields in the DOM.
    // If visibleCheckoutFields=false, the form is likely inside a cross-origin iframe
    // (e.g. Hilton, Namastay) and hasValueInScopes always returns false — don't penalise.
    if (
      hitPaymentGate &&
      !hasMinimumFilledProfile &&
      (
        assessment.visibleCheckoutFields ||
        bookingComVisiblePaymentInputs ||
        (bookingComPaymentSignalsVisible && (!!p.card_number || !!p.card_expiry))
      )
    ) {
      trace("Final state check found that the page looked like payment, but the expected profile/card values were not actually present in the form fields.");
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The agent reached a payment-like page, but the guest or card fields were not actually populated correctly.",
        error: "Payment page detected without verified guest/card field values.",
        debugTrace,
      };
    }

    // Sanity check: agent may claim success but the page is still a listing page.
    // If listing signals are present and no booking progress is visible, override.
    if (hitPaymentGate && assessment.listingSignals && !assessment.bookingProgressSignals) {
      trace("Success claim was overridden because listing signals remained visible without checkout progress.");
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The requested dates are unavailable or couldn't be selected on this property. Open the link to choose different dates or book manually.",
        error: "Agent falsely reported completion — still on listing page (dates not selectable)",
        debugTrace,
      };
    }

    if (hitPaymentGate) {
      trace("Final state check confirmed the run reached the payment gate before CVV/final submit.");
      if (!useCloud) {
        // Local mode: keep the browser open so the user can see the filled form
        // and enter CVV directly in the browser window.
        keepBrowserOpen = true;
        trace("Local mode: browser will stay open for 15 minutes — live view available in OneAgent.");
        console.log("\n✅ [stagehand] Payment page is open — use OneAgent live view or the browser window to complete payment.\n");
        // Register page in the global session store so the live view API can stream it.
        browserSessionStore.set(input.jobId, raw, 15 * 60 * 1000);
        // Auto-close after 15 minutes.
        setTimeout(() => {
          browserSessionStore.delete(input.jobId);
          stagehand.close().catch(() => {});
        }, 15 * 60 * 1000);
      }
      return {
        status: "paused_payment",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: result.message || "Reached payment page — ready for you to complete.",
        debugTrace,
      };
    }

    // Agent stopped because it needs guest info from the user
    const needsGuestInfo =
      msg.includes("personal detail") ||
      msg.includes("guest detail") ||
      msg.includes("guest information") ||
      msg.includes("contact information") ||
      msg.includes("no guest") ||
      (!result.completed && msg.includes("form"));

    if (needsGuestInfo) {
      trace("Agent reported that guest/profile details were still required.");
      return {
        status: "needs_login",   // reuses the "needs intervention" flow in tasks UI
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: result.message || "Agent reached the guest info form but has no profile data. Please add your details in Preferences → My Profile.",
        error: "No guest profile — add your name, email and phone in Preferences → My Profile, then retry.",
        debugTrace,
      };
    }

    // Check for no availability
    const noAvailability =
      result.message?.toLowerCase().includes("no availability") ||
      result.message?.toLowerCase().includes("not available") ||
      result.message?.toLowerCase().includes("sold out") ||
      result.message?.toLowerCase().includes("fully booked");

    if (noAvailability) {
      trace("Agent confirmed there was no availability for the requested stay.");
      return {
        status: "no_availability",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: result.message || "No availability found.",
        debugTrace,
      };
    }

    // Needs login
    const needsLogin =
      result.message?.toLowerCase().includes("sign in") ||
      result.message?.toLowerCase().includes("log in") ||
      result.message?.toLowerCase().includes("create account") ||
      currentUrl.toLowerCase().includes("login") ||
      currentUrl.toLowerCase().includes("signin");

    if (needsLogin) {
      trace("Final state check detected a login/sign-in requirement.");
      return {
        status: "needs_login",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The site requires a login. Open the link to sign in and continue.",
        debugTrace,
      };
    }

    if (!hasMinimumFilledProfile) {
      trace("Executor blocked the default success path because the expected guest/card values were still not verified in the checkout fields.");
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The agent appeared to finish, but the guest/contact/card values were not verified in distinct checkout fields.",
        error: "Unverified checkout field values on final state.",
        debugTrace,
      };
    }

    trace(`Executor reached fallback terminal state with agent.completed=${String(result.completed)}.`);
    return {
      status: result.completed ? "completed" : "paused_payment",
      screenshotBase64,
      handoffUrl: currentUrl,
      sessionUrl,
      summary: result.message || "Task completed.",
      debugTrace,
    };
  } catch (err) {
    const { message: error, statusCode, serialized } = extractErrorDetails(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // Preserve the raw error string before any further interpretation, for diagnostics.
    const rawError = serialized ?? error;

    // Write to persistent agent log for debugging
    await writeAgentLog({
      session_id: input.jobId ?? "",
      job_id: input.jobId ?? null,
      level: "error",
      source: "stagehand-executor",
      message: error,
      details: {
        startUrl: input.startUrl,
        task: input.task.slice(0, 500),
        stepIndex: input.stepIndex,
        statusCode,
        serializedError: serialized?.slice(0, 2000),
        stack: stack?.slice(0, 1000),
        model: input.agentModel?.model ?? modelName,
        usingCloud: useCloud,
      },
    });

    // Captcha detection
    if (
      error.toLowerCase().includes("captcha") ||
      error.toLowerCase().includes("cloudflare") ||
      error.toLowerCase().includes("blocked")
    ) {
      trace(`Executor threw a blocking error: ${error}`);
      return {
        status: "captcha",
        handoffUrl: input.startUrl,
        summary: "The site blocked the agent. Open the link to continue manually.",
        error,
        debugTrace,
      };
    }

    if (
      statusCode === 402 ||
      error.toLowerCase().includes("billing") ||
      error.toLowerCase().includes("credits") ||
      error.toLowerCase().includes("quota") ||
      error.toLowerCase().includes("payment required") ||
      rawError.toLowerCase().includes("minutes limit")
    ) {
      trace(`Executor hit 402. Raw: ${rawError.slice(0, 400)}`);

      // Specific Browserbase free-plan minutes exhaustion
      if (rawError.toLowerCase().includes("browser minutes limit") ||
          rawError.toLowerCase().includes("free plan")) {
        return {
          status: "error",
          handoffUrl: input.startUrl,
          summary: "Browserbase free plan browser minutes exhausted.",
          error: "Browserbase free plan limit reached — upgrade at browserbase.com/plans, or remove BROWSERBASE_API_KEY to run locally.",
          debugTrace,
        };
      }

      // Generic 402 — try to name the provider
      const isBrowserbase = rawError.toLowerCase().includes("browserbase") ||
        rawError.toLowerCase().includes("session") ||
        rawError.toLowerCase().includes("concurren");
      const isModelApi = rawError.toLowerCase().includes("openai") ||
        rawError.toLowerCase().includes("anthropic") ||
        rawError.toLowerCase().includes("google") ||
        rawError.toLowerCase().includes("gemini");
      const providerHint = isBrowserbase
        ? "Browserbase"
        : isModelApi
        ? `Model API (${modelName})`
        : `unknown provider — model: ${modelName}`;

      return {
        status: "error",
        handoffUrl: input.startUrl,
        summary: "The automation provider rejected this run before the booking flow could finish.",
        error: `Quota/billing issue (HTTP 402) from ${providerHint}. Check credits and retry.`,
        debugTrace,
      };
    }

    trace(`Executor threw an unexpected error: ${error}`);
    return {
      status: "error",
      handoffUrl: input.startUrl,
      summary: "An unexpected error occurred.",
      error,
      debugTrace,
    };
  } finally {
    if (!keepBrowserOpen) {
      await stagehand.close().catch(() => {});
    }
  }
}

// ── Task instruction builders ────────────────────────────────────────────────

function buildInstruction(input: BrowserTaskInput): string {
  const p = buildEffectiveProfile(input.profile, input.task);
  const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);

  if (hasProfile) {
    const fullName = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
    const addressParts = [
      p.address_line1 && `Street: ${p.address_line1}`,
      p.city && `City: ${p.city}`,
      p.state && `State: ${p.state}`,
      p.zip && `ZIP: ${p.zip}`,
      p.country && `Country: ${p.country}`,
    ].filter(Boolean);
    const cardParts = [
      p.card_name && `Cardholder name: ${p.card_name}`,
      p.card_number && `Card number: ${p.card_number}`,
      p.card_expiry && `Expiry date: ${p.card_expiry}`,
    ].filter(Boolean);

    return `${input.task}

You are starting at: ${input.startUrl}
IMPORTANT: After navigating to the starting URL you may be redirected to a different domain — this is expected and correct (e.g. a hotel may have rebranded or moved). Stay on whatever website you actually land on and complete the booking there. Do NOT navigate to other hotel websites, search engines, or unrelated sites. If you land on the correct hotel's booking page, that IS the right site even if the domain differs from the starting URL.
${input.startUrl.includes("booking.com") ? `\nYou are on booking.com. Flow: search results → click hotel card → hotel detail page → select room → "Reserve" → fill guest info → fill card → STOP before "Complete booking".` : ""}${input.startUrl.includes("expedia.com") ? `\nYou are on Expedia. Flow: search results → click hotel → select room → "Reserve" → fill guest info → fill card → STOP before final payment button.` : ""}

Guest details — fill these into ALL guest/contact information fields you encounter:
- Full name: ${fullName}
- Email: ${p.email}
- Phone: ${p.phone} (this is the 10-digit local number; if the phone field already displays "+1" or a country code, do NOT add another "+1" — type only these digits as-is)
${addressParts.length ? `\nBilling address:\n${addressParts.map(a => `- ${a}`).join("\n")}` : ""}
${cardParts.length ? `\nPayment card (fill number and expiry, then STOP before CVV):\n${cardParts.map(c => `- ${c}`).join("\n")}` : ""}

FIRST STEP — GET TO THE BOOKING FORM:
- If you are on a booking.com or Expedia SEARCH RESULTS page: find the hotel card matching the hotel name in the task, click on it to open its detail page. Do NOT click any generic "Reserve" button on the search results page itself — first open the hotel's own detail page.
- If you are on a booking.com HOTEL DETAIL page: FIRST scroll down past the photos and description to find the room list ("空房情况"). Do NOT touch the search bar at the top. Do NOT type the guest name anywhere yet. Only interact with the room rows below.
- If you see a "Select a Rate" page with multiple rate options: pick the lowest-priced rate UNLESS the task mentions breakfast, free cancellation, or a specific preference. Click its "Select" button to proceed.
- If the hotel homepage shows a "BOOK NOW" or "Book Now" button in the header/navigation bar, click it FIRST to open the booking calendar widget. This is the entry point — you cannot select dates until you click this button.
- If a cookie consent banner appears, click "Decline all" or "Reject all" to dismiss it before proceeding.

HOTEL DETAIL PAGE — VERIFY DATES FIRST:
- When you land on a hotel detail page (e.g. IHG, Marriott, Hilton direct site) that shows a date picker or search bar with check-in/check-out dates, CHECK that the displayed dates match the task's required check-in and check-out before doing anything else.
- If the dates are WRONG (e.g. showing today's date instead of the required dates), update them FIRST:
  1. Click the check-in date field to open the date picker.
  2. Navigate to the correct month and select the correct check-in date.
  3. Set the correct check-out date or stay duration.
  4. Click "Search" / "View Prices" / "Update" to apply the dates.
- Only after dates are correct should you proceed to room selection or "View Prices".

AFTER CLICKING "BOOK NOW" — WAIT FOR CALENDAR TO LOAD:
- After clicking "BOOK NOW", take an ariaTree snapshot BEFORE trying to click anything else.
- Verify the ariaTree shows a BOOKING CALENDAR with a month/year header (e.g., "April 2026") and a date grid showing day numbers. If the calendar is not yet visible, take another screenshot and wait.
- The booking calendar navigation arrows (‹ left / › right) appear INSIDE the Namastay booking panel — they sit directly next to the month/year header text (e.g., "April 2026 ›").
- The "Previous Slide" and "Next Slide" buttons belong to the PHOTO GALLERY carousel on the main hotel page — they control photos, NOT calendar months. NEVER click these.
- To distinguish: if clicking a button changes a photo but not the calendar month header, you clicked the wrong button. Use ariaTree to find the calendar navigation arrows instead.
- When acting on the calendar arrow, describe it as: "click the right arrow button next to the month/year heading inside the Namastay booking calendar"
- After each calendar arrow click, take an ariaTree to confirm the month header changed before clicking again.

BOOKING.COM SPECIFIC FLOW:
1. Search results page → find and click the correct hotel card by name
   - If booking.com shows NO hotel cards, an error message, OR redirects to the booking.com homepage (booking.com/index.html) — this means the search FAILED. Immediately navigate to the fallback URL provided in the task. Do NOT wait or retry the search.
   - Signs of search failure: URL contains "errorc_searchstring_not_found", page shows "We couldn't find", page is booking.com homepage with no search results.
   - If results appear but the exact name isn't listed, click the closest match (same brand or city)
2. Hotel detail page → verify/set dates → scroll to room list → choose cheapest room:
   - If the room list has a QUANTITY DROPDOWN (showing "0", "1", "2"…) next to each room type: set the dropdown for the cheapest room to "1". After setting it to 1, a blue "I'll reserve" (English) or "现在就预订" (Chinese) button appears in the RIGHT-SIDE SUMMARY PANEL — click THAT button as your VERY NEXT action. Do NOT fill any name, email, phone, or other information on this page — the guest info form is on the NEXT page. Do NOT touch the search bar at the top.
   - If the room list has a direct "Reserve" / "I'll reserve" / "Select" / "Book" button per room: click it directly.
   - Always pick the lowest-priced available room unless the task specifies a room type preference.
3. Guest details form — Booking.com may show this form in CHINESE.
   IMPORTANT: Even if you are logged into a Booking.com account and fields are pre-filled, you MUST verify each field matches the guest info provided in the task. Pre-filled values from the account may be wrong — always correct them.
   Go through each field in this EXACT ORDER and fix any wrong values:
   STEP A: 姓 (拼音/英语) = LAST NAME / FAMILY NAME / SURNAME. Check the current value. If it contains the first name or any wrong value, clear it and type ONLY the last name (e.g. if the guest is "Ziwei Guo", this field must contain "Guo"). Do NOT type digits or phone number here.
   STEP B: 名 (拼音/英语) = FIRST NAME / GIVEN NAME. Check the current value. If it contains the last name or any wrong value, clear it and type ONLY the first name (e.g. "Ziwei"). Do NOT type digits or phone number here.
   STEP C: 电子邮箱地址 = Email address. Verify it matches; correct if wrong.
   STEP D: 国家/地区 = Country/region. This MUST match the guest's country. If the guest has a US address/phone, it must show "美国" (United States). If it shows "中国" or any other wrong country, click the dropdown and change it to "美国".
   STEP E: 电话号码 / 手机号码 = Phone number — two parts side by side:
     LEFT part: a country code dropdown. It MUST show "US +1" for US phone numbers. If it shows anything else (e.g. "BT +975", "中国 +86"), click the dropdown and select "United States +1" / "US +1".
     RIGHT part: a separate empty number input box to the right of the country code → click ONLY this right-side input box, then type the 10-digit phone number (digits only, no +1, no dashes, no spaces).
   STEP F: After ALL fields are verified/filled, look for and click the button to advance to the NEXT page. This button may say: "Next: Final details", "Next step", "Continue", "下一步", "继续", or "完成". It is usually at the BOTTOM of the page. Scroll down to find it if needed.
   CRITICAL: The credit card / payment form is on a SEPARATE NEXT PAGE — it does NOT appear on the same page as the guest name/email/phone form. Do NOT attempt to fill card number, CVV, expiry, or address on the guest details page. Do NOT type anything else after the phone number. Immediately scroll down and click "Next: Final details" to go to the payment page.
4. Payment page (reached AFTER clicking 下一步 on guest details page) — may also be in Chinese:
   - 信用卡或借记卡 = Credit or debit card → select this option
   - 卡号 = Card number
   - 到期日 = Expiry date
   - 持卡人姓名 = Cardholder name
   - 完成预订 / 立即付款 = Complete booking / Pay now → STOP before clicking this
5. STOP before CVV (安全码/CVV) and before "完成预订" / "立即付款" button

EXPEDIA SPECIFIC FLOW:
1. Search results → click correct hotel → "Select room"
2. Room selection → choose room → "Reserve"
3. Trip summary / checkout form → fill guest info and card
4. STOP before final "Complete booking" button

Booking widget navigation rules:
- The booking calendar and room selection are inside an IFRAME on the page.
- After selecting dates, click ONLY the "Next" button that is INSIDE the booking widget iframe to advance to room selection. DO NOT click "Next Slide", "Previous Slide", photo carousel arrows, or any other button outside the booking iframe.
- If you clicked a "Next Slide" button by mistake (it navigates a photo gallery), that is the wrong button — look for the Next/Continue button inside the booking iframe instead.
- If any dialog or popup appears (error, warning, advertisement, newsletter, or any modal overlay), click its "Ok", "Close", "Dismiss", or "No thanks" button immediately to dismiss it and continue. Do NOT enter any coupon or promo code if asked.
- If a dialog says "We couldn't find this room", "room not available", "sold out", or similar — click Ok to dismiss, then go back to the room list and select a DIFFERENT available room.
- If a dialog says "no availability" for your dates — click Ok, then try adjusting the dates by ±1 day and search again.
- Never leave a modal open — always dismiss it before trying to interact with the page behind it.
- If clicking "Book Now" or any booking button opens a NEW TAB or popup window, switch to that new tab immediately and continue the booking process there. Do not stay on the original page.

CALENDAR MONTH NAVIGATION:
- Before clicking any date, read the calendar header to see which month is shown.
- If the shown month is BEFORE the target month → click the RIGHT "›" arrow to advance forward.
- If the shown month is AFTER the target month → click the LEFT "‹" arrow to go back.
- After each arrow click, re-read the calendar header to confirm the month changed correctly.
- NEVER click a date cell unless the header already shows the correct month and year.

STAY DURATION / SINGLE CHECK-IN DATE CALENDARS (IHG and similar):
- Some hotel calendars (e.g. IHG) use a CHECK-IN DATE + STAY DURATION model, NOT a check-in/check-out range picker.
- How to identify: the calendar shows a "Stay duration" control with +/− buttons (e.g. "1 night") at the bottom, and each date cell shows a price per night.
- On these calendars: click ONLY the check-in date cell. Do NOT click the checkout date — clicking a second date will OVERRIDE the check-in selection and move it forward.
- After clicking check-in, use the "+" (Increment) button next to "Stay duration" / "1 night" to increase the number of nights until it matches the required stay length.
- Example: check-in May 26, check-out May 28 = 2 nights → click May 26, then click "+" once to go from 1 night to 2 nights.
- Then click CONTINUE to proceed to room selection.

ONLY FILL GUEST INFO ON THE ACTUAL CHECKOUT / GUEST DETAILS PAGE:
- Do NOT call fillForm or type any guest info while on the room selection page, search results page, or calendar dialog.
- The checkout / guest details page typically has clearly labeled fields: "First name", "Last name", "Email address", "Phone number", "Address", "City", "State", "ZIP", and a payment card section.
- If you are not sure whether you are on the checkout form, take an ariaTree snapshot and look for those labeled fields before typing anything.

Fill ALL guest info and billing address fields that are inside the booking widget or checkout form.
Do NOT fill newsletter subscription inputs, footer email fields, or any input outside the booking/checkout area.
If a page shows only card fields (no name/email/phone), skip those and fill just the card fields.

IMPORTANT — "Book Now" button handling:
If a page shows a booking review summary (dates, room, total price) with a privacy policy checkbox and a "Book Now" or "Reserve Now" button:
  1. Check the privacy policy checkbox.
  2. Select "Credit or debit card" if a payment method radio is present.
  3. Click "Book Now" / "Reserve Now" — this only opens the card entry form, it does NOT charge the card.
  4. After clicking, fill the card number and expiry date fields that appear.
  5. STOP before the CVV / security code field.

STOP before CVV and before any button that says "Pay Now", "Confirm Payment", "Complete Purchase", "Complete Booking", "Confirm Booking", or "Submit Payment".
Do NOT stop at "Book Now" or "Reserve Now" — those open the card form, not finalize payment.`;
  }

  // No profile — navigate as far as possible then stop and list what's needed
  return `${input.task}

You are starting at: ${input.startUrl}
IMPORTANT: After navigating you may be redirected to a different domain — stay on whatever site you land on. Do NOT use search engines or navigate to unrelated sites.

Navigate and select dates/room options. The booking calendar is inside an IFRAME — after selecting dates, click ONLY the "Next" button inside the booking iframe (not "Next Slide" or photo carousel buttons on the main page). When you reach a guest information form (name, email, phone), stop and clearly list every field the form is asking for so the user knows what to provide.`;
}

/** Build a natural-language task for restaurant booking. */
export function buildRestaurantTask(params: {
  restaurantName: string;
  city: string;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM
  covers: number;
  profile: import("./types").BookingProfile;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  return {
    profile: params.profile,
    task: `Find ${params.restaurantName} restaurant in ${params.city} and book a table for ${params.covers} people on ${params.date} at ${params.time}. Select the closest available time slot if the exact time is unavailable. Fill in the guest information form completely.`,
  };
}

/** Build a natural-language task for hotel booking. */
export function buildHotelTask(params: {
  hotelName: string;
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  profile: import("./types").BookingProfile;
  roomPreference?: string;  // e.g. "king bed", "double queen", "suite"
  breakfastIncluded?: boolean;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  // Build room selection guidance from preferences
  const roomPref = params.roomPreference ?? params.profile.room_preference;
  const wantsBreakfast = params.breakfastIncluded ?? params.profile.breakfast_preference;

  const roomInstruction = roomPref
    ? `Prefer a ${roomPref} room type if available. `
    : `Select the cheapest available room (preferably a standard king or queen room). `;

  const breakfastInstruction = wantsBreakfast
    ? `Choose a rate that includes breakfast if available. `
    : ``;

  return {
    profile: params.profile,
    task: `Find ${params.hotelName} hotel in ${params.city} and book a room for ${params.adults} adult(s), checking in ${params.checkin} and checking out ${params.checkout}. ${roomInstruction}${breakfastInstruction}Fill in the guest information completely.`,
  };
}

/** Build a natural-language task for flight booking. */
export function buildFlightTask(params: {
  origin: string;
  destination: string;
  date: string;
  passengers: number;
  preferNonstop: boolean;
  profile: import("./types").BookingProfile;
}): Pick<BrowserTaskInput, "task" | "profile"> {
  return {
    profile: params.profile,
    task: `Find the cheapest ${params.preferNonstop ? "non-stop " : ""}flight from ${params.origin} to ${params.destination} on ${params.date} for ${params.passengers} passenger(s). Select the best option and proceed to the passenger details form. Fill in all required information.`,
  };
}
