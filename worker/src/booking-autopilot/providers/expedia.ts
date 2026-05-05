import fs from "fs";
import path from "path";
import type { Frame, Page } from "playwright";
import { buildFlightInventoryDriftMessage } from "@/lib/booking-errors";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";
import { safeMouseClick } from "../shared/playwright-safe";

// Selectors for Expedia Group payment fields (used by both Expedia and Hotels.com)
// Expedia inline payment form (not iframe) — placeholder-based selectors are most reliable.
// Confirmed field placeholders from live Expedia checkout page:
//   Card number:    "0000 0000 0000 0000"
//   Expiry:         "MM/YY"
//   Name on card:   "Name on card"
export const EXPEDIA_GROUP_CARD_NAME_SELECTORS = [
  'input[placeholder="Name on card"]',
  'input[id*="cardHolder"], input[id*="cardholder"], input[id*="card-holder"]',
  'input[name*="cardHolder"], input[name*="cardholder"]',
  'input[autocomplete="cc-name"]',
  'input[placeholder*="Name on card"], input[placeholder*="Cardholder"]',
];
export const EXPEDIA_GROUP_CARD_NAME_LABELS = ["Name on card", "Cardholder name", "Name on Card", "Card holder name"];

export const EXPEDIA_GROUP_CARD_NUMBER_SELECTORS = [
  'input[placeholder="0000 0000 0000 0000"]',
  'input[id*="cardNumber"], input[id*="card-number"]',
  'input[name*="cardNumber"], input[name*="card-number"]',
  'input[autocomplete="cc-number"]',
  'input[placeholder*="Card number"], input[placeholder*="card number"]',
  // Braintree hosted fields use id="credit-card-number" and type="tel"
  'input[id*="credit-card"], input[id="number"]',
  'input[type="tel"][id*="card"], input[type="tel"][name*="card"]',
  'input[type="text"][autocomplete="cc-number"]',
];

export const EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS = [
  'input[placeholder="MM/YY"]',
  'input[id*="expiryDate"], input[id*="expiry"], input[id*="expiration"]',
  'input[name*="expiryDate"], input[name*="expiry"], input[name*="expiration"]',
  'input[autocomplete="cc-exp"]',
  'input[placeholder*="MM/YY"], input[placeholder*="Expiry"], input[placeholder*="Expiration"]',
  // Braintree hosted fields
  'input[id="expiration"], input[id="expirationDate"]',
  'input[type="tel"][id*="expir"]',
];

interface ExpediaGroupProfile {
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  country?: string;
  billing_zip?: string;
  zip?: string; // fallback alias from BookingProfile
  // Guest fields (needed when checkout page combines guest info + payment on one page)
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface ExpediaFlightTarget {
  airline?: string;
  price?: number;
  time?: string;
  flightNumber?: string;
}

export interface ExpediaFlightCandidateScore {
  hasAirline: boolean;
  score: number;
  exactMatch: boolean;
  fallbackEligible: boolean;
  fallbackScore: number;
  hasPrice: boolean;
  hasFlightNumber: boolean;
  timeScore: number;
  departureMinutes: number;
  timeDelta: number | null;
  priceDelta: number | null;
}

export interface ExpediaFlightCandidateEvidence {
  label: string;
  airline: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  route: string | null;
  price: string | null;
  flightNumber: string | null;
  score?: ExpediaFlightCandidateScore;
}

type ExpediaFlightButtonMatch = {
  found: boolean;
  label: string;
  candidates: number;
  x: number;
  y: number;
  inViewportBefore: boolean;
  clickMode?: "coordinate" | "locator";
  samples: string[];
  candidateSummaries?: string[];
  matchMode?: string;
  matchReason?: string;
  evalError?: string;
};

type ExpediaFlightLocatorCandidate = {
  index: number;
  label: string;
  score: ExpediaFlightCandidateScore;
  summary: string;
};

export interface ExpediaFlightCandidateSelectionReport {
  selected: {
    index: number;
    label: string;
    score: ExpediaFlightCandidateScore;
    summary: string;
  } | null;
  candidateCount: number;
  matchMode?: string;
  matchReason?: string;
  samples: string[];
  candidateSummaries: string[];
}

type ExpediaFlightCandidateSelection = {
  best: ExpediaFlightLocatorCandidate | null;
  candidateCount: number;
  matchMode?: string;
  matchReason?: string;
  samples: string[];
  candidateSummaries: string[];
};

type ExpediaFlightLocatorTextLike = {
  evaluate?: <T>(fn: (el: Element) => T | Promise<T>) => Promise<T>;
  getAttribute?: (name: string) => Promise<string | null>;
  textContent?: (options?: { timeout?: number }) => Promise<string | null>;
  innerText?: (options?: { timeout?: number }) => Promise<string | null>;
  locator?: (selector: string) => ExpediaFlightLocatorTextLike;
};

type ExpediaFlightLocatorBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ExpediaFlightLocatorBoxLike = {
  boundingBox?: () => Promise<ExpediaFlightLocatorBox | null>;
  elementHandle?: (options?: { timeout?: number }) => Promise<ExpediaFlightLocatorBoxLike | null>;
  evaluate?: <T>(fn: (el: Element) => T | Promise<T>) => Promise<T>;
  scrollIntoViewIfNeeded?: () => Promise<void>;
};

function parseExpediaFlightTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const raw = t.trim().toLowerCase();
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const suffix = match[3]?.toLowerCase() ?? null;
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (!suffix && hour === 24) hour = 0;
  return hour * 60 + minute;
}

function normalizeExpediaFlightLoose(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeExpediaFlightTight(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractExpediaFlightPrices(text: string): number[] {
  return Array.from(text.matchAll(/\$([\d,]+)/g))
    .map(match => Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10))
    .filter(value => Number.isFinite(value));
}

const EXPEDIA_FLIGHT_AIRLINE_HINTS = [
  "Southwest Airlines",
  "Southwest",
  "American Airlines",
  "American",
  "Delta Air Lines",
  "Delta",
  "United Airlines",
  "United",
  "Spirit Airlines",
  "Spirit",
  "Frontier Airlines",
  "Frontier",
  "JetBlue",
  "Alaska Airlines",
  "Alaska",
];

export function extractExpediaFlightCandidateEvidence(
  rawText: string,
  target: ExpediaFlightTarget = {},
): ExpediaFlightCandidateEvidence {
  const label = rawText.replace(/\s+/g, " ").trim().slice(0, 180);
  const loose = normalizeExpediaFlightLoose(rawText);
  const targetAirline = normalizeExpediaFlightLoose(target.airline);
  const airline =
    target.airline && targetAirline && loose.includes(targetAirline.split(" ")[0] ?? "")
      ? target.airline
      : EXPEDIA_FLIGHT_AIRLINE_HINTS.find(hint => loose.includes(hint.toLowerCase())) ?? null;
  const times = Array.from(rawText.matchAll(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/gi))
    .map(match => (match[1] ?? "").replace(/\s+/g, "").toLowerCase())
    .filter(Boolean);
  const prices = extractExpediaFlightPrices(rawText);
  const flightNumber =
    (rawText.match(/\b([A-Z]{1,3})\s?(\d{2,4})\b/)?.slice(1, 3).join(" ") ?? "")
      .trim()
      .replace(/\s+/, " ") ||
    null;
  const route =
    rawText.match(/\b[A-Z]{3}\b\s*(?:to|-|->)\s*\b[A-Z]{3}\b/i)?.[0] ??
    rawText.match(/[A-Z][A-Za-z .']+\([A-Z]{3}\)\s*(?:to|-|->)\s*[A-Z][A-Za-z .']+\([A-Z]{3}\)/)?.[0] ??
    null;
  const score = Object.keys(target).length > 0
    ? scoreExpediaFlightCandidateText(rawText, target)
    : undefined;

  return {
    label,
    airline,
    departureTime: times[0] ?? null,
    arrivalTime: times[1] ?? null,
    route,
    price: prices.length > 0 ? `$${prices[0]}` : null,
    flightNumber,
    ...(score ? { score } : {}),
  };
}

export function formatExpediaFlightCandidateEvidence(
  rawText: string,
  target: ExpediaFlightTarget = {},
): string {
  const evidence = extractExpediaFlightCandidateEvidence(rawText, target);
  const score = evidence.score;
  const parts = [
    `airline=${evidence.airline ?? "unknown"}`,
    `departure=${evidence.departureTime ?? "unknown"}`,
    `arrival=${evidence.arrivalTime ?? "unknown"}`,
    `route=${evidence.route ?? "unknown"}`,
    `price=${evidence.price ?? "unknown"}`,
    `flightNumber=${evidence.flightNumber ?? "hidden"}`,
  ];
  if (score) {
    parts.push(
      `score=${score.score}`,
      `fallbackScore=${score.fallbackScore}`,
      `timeDelta=${score.timeDelta ?? "unknown"}`,
      `priceDelta=${score.priceDelta ?? "unknown"}`,
    );
  }
  parts.push(`text="${evidence.label}"`);
  return parts.join(" ");
}

async function readExpediaFlightLocatorText(
  locator: ExpediaFlightLocatorTextLike | null | undefined,
): Promise<string> {
  if (!locator) return "";
  if (typeof locator.innerText === "function") {
    const text = await locator.innerText({ timeout: 800 }).catch(() => null);
    if (text) return text;
  }
  if (typeof locator.textContent === "function") {
    const text = await locator.textContent({ timeout: 800 }).catch(() => null);
    if (text) return text;
  }
  return "";
}

function compactExpediaFlightLocatorLabel(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readExpediaFlightLocatorCandidateLabel(
  item: ExpediaFlightLocatorTextLike,
): Promise<string> {
  if (typeof item.evaluate === "function") {
    const evaluated = await item.evaluate((btn) => {
      const element = btn as Element;
      const container = element.closest('li, article, section, [data-test-id], [data-stid], [class*="uitk-card"], [class*="offer-card"], [class*="result"]');
      const htmlElement = element as HTMLElement;
      const context = container?.textContent ?? htmlElement.parentElement?.textContent ?? "";
      return `${element.getAttribute("aria-label") ?? ""} ${htmlElement.textContent ?? ""} ${context}`.replace(/\s+/g, " ").trim();
    }).catch(() => "");
    if (evaluated) return evaluated;
  }

  const ariaLabel =
    typeof item.getAttribute === "function"
      ? await item.getAttribute("aria-label").catch(() => null)
      : null;
  const title =
    typeof item.getAttribute === "function"
      ? await item.getAttribute("title").catch(() => null)
      : null;
  const ownText = await readExpediaFlightLocatorText(item);
  const ancestorTexts: string[] = [];

  if (typeof item.locator === "function") {
    for (const selector of [
      'xpath=ancestor-or-self::li[1]',
      'xpath=ancestor-or-self::article[1]',
      'xpath=ancestor-or-self::section[1]',
      'xpath=ancestor::*[contains(@class, "uitk-card")][1]',
      'xpath=ancestor::*[contains(@class, "offer-card")][1]',
      'xpath=ancestor::*[contains(@class, "result")][1]',
    ]) {
      const nestedLocator = (() => {
        try {
          return item.locator?.(selector);
        } catch {
          return null;
        }
      })();
      const text = await readExpediaFlightLocatorText(nestedLocator);
      if (text) ancestorTexts.push(text);
    }
  }

  return compactExpediaFlightLocatorLabel([ariaLabel, title, ownText, ...ancestorTexts]);
}

export async function readExpediaFlightLocatorBoundingBox(
  item: ExpediaFlightLocatorBoxLike,
): Promise<ExpediaFlightLocatorBox | null> {
  if (typeof item.boundingBox === "function") {
    const box = await item.boundingBox().catch(() => null);
    if (isUsableExpediaFlightLocatorBox(box)) return box;
  }

  if (typeof item.elementHandle === "function") {
    const handle = await item.elementHandle({ timeout: 800 }).catch(() => null);
    if (handle && typeof handle.boundingBox === "function") {
      const box = await handle.boundingBox().catch(() => null);
      if (isUsableExpediaFlightLocatorBox(box)) return box;
    }
  }

  if (typeof item.evaluate === "function") {
    const box = await item.evaluate((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }).catch(() => null);
    if (isUsableExpediaFlightLocatorBox(box)) return box;
  }

  return null;
}

export async function scrollExpediaFlightLocatorIntoView(
  item: ExpediaFlightLocatorBoxLike,
): Promise<boolean> {
  if (typeof item.scrollIntoViewIfNeeded === "function") {
    const ok = await item.scrollIntoViewIfNeeded()
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }

  if (typeof item.evaluate === "function") {
    return item.evaluate((el) => {
      (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
      return true;
    }).catch(() => false);
  }

  return false;
}

function isUsableExpediaFlightLocatorBox(
  box: ExpediaFlightLocatorBox | null | undefined,
): box is ExpediaFlightLocatorBox {
  return !!box &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0;
}

export function classifyExpediaFlightSafetyBoundaryText(
  rawText: string | null | undefined,
): string | null {
  const text = normalizeExpediaFlightLoose(rawText);
  if (!text) return null;
  if (/\b(captcha|robot check|are you a robot|unusual traffic)\b/i.test(text)) {
    return "CAPTCHA boundary";
  }
  if (/\b(verification code|one-time passcode|one time passcode|enter code|verify it'?s you|two-factor|2fa|otp)\b/i.test(text)) {
    return "OTP boundary";
  }
  if (/\b(sign in to continue|log in to continue|login to continue|sign in or create an account to continue|authentication required)\b/i.test(text)) {
    return "login boundary";
  }
  return null;
}

export type ExpediaFlightOverlayClassification =
  | "dismissable_member_price_overlay"
  | "hard_safety_boundary";

export function classifyExpediaFlightBlockingOverlayText(
  rawText: string | null | undefined,
): ExpediaFlightOverlayClassification | null {
  const text = normalizeExpediaFlightLoose(rawText);
  if (!text) return null;
  if (classifyExpediaFlightSafetyBoundaryText(text)) {
    return "hard_safety_boundary";
  }
  const mentionsMemberPromo =
    text.includes("member prices") ||
    text.includes("one key") ||
    text.includes("onekeycash") ||
    text.includes("unlock instant savings") ||
    text.includes("sign in and book a flight");
  const looksLikeSignInPromo =
    /\bsign[-_\s]?in\b/.test(text) &&
    (
      text.includes("member") ||
      text.includes("savings") ||
      text.includes("one key") ||
      text.includes("onekeycash") ||
      text.includes("learn more")
    );
  return mentionsMemberPromo || looksLikeSignInPromo
    ? "dismissable_member_price_overlay"
    : null;
}

export function hasExpediaFlightBundlePopupText(rawText: string | null | undefined): boolean {
  const text = normalizeExpediaFlightLoose(rawText);
  return text.includes("car rental dates") ||
    text.includes("explore packages") ||
    (text.includes("bundle & save") && text.includes("includes your selected flight"));
}

export interface ExpediaFlightCheckoutStateInput {
  currentUrl: string;
  bodyText: string;
  visibleInputDescriptions?: string[];
}

export interface ExpediaFlightCheckoutState {
  onCheckout: boolean;
  reason: string;
  hasTravelerCopy: boolean;
  hasTravelerFields: boolean;
  stillOnReview: boolean;
  stillOnSearch: boolean;
  stillOnReviewUrl: boolean;
  bundlePopupVisible: boolean;
}

export function classifyExpediaFlightCheckoutState(
  input: ExpediaFlightCheckoutStateInput,
): ExpediaFlightCheckoutState {
  const currentUrl = normalizeExpediaFlightLoose(input.currentUrl);
  const bodyText = normalizeExpediaFlightLoose(input.bodyText);
  const visibleInputDescriptions = input.visibleInputDescriptions ?? [];
  const stillOnSearch = currentUrl.includes("flights-search");
  const stillOnReviewUrl = currentUrl.includes("flight-information");
  const urlIsCheckout =
    currentUrl.includes("/checkout") ||
    currentUrl.includes("/flights-checkout");
  const bundlePopupVisible = hasExpediaFlightBundlePopupText(bodyText);
  const stillOnReview =
    stillOnReviewUrl ||
    bodyText.includes("review your trip") ||
    bodyText.includes("skip to checkout") ||
    bodyText.includes("next: checkout") ||
    bodyText.includes("next: seats") ||
    bodyText.includes("continue without choosing seats");
  const hasTravelerCopy =
    bodyText.includes("traveler information") ||
    bodyText.includes("passenger information") ||
    bodyText.includes("who's flying") ||
    bodyText.includes("enter payment");
  const hasTravelerFields = visibleInputDescriptions.some(desc =>
    /first.?name|last.?name|given.?name|family.?name|surname|date.?of.?birth|birth.?date|passport|known.?traveler|tsa.?pre|phone|email/.test(desc)
  );

  if (bundlePopupVisible) {
    return {
      onCheckout: false,
      reason: "bundle-popup-open",
      hasTravelerCopy,
      hasTravelerFields,
      stillOnReview,
      stillOnSearch,
      stillOnReviewUrl,
      bundlePopupVisible,
    };
  }
  if (urlIsCheckout) {
    return {
      onCheckout: true,
      reason: "checkout-url",
      hasTravelerCopy,
      hasTravelerFields,
      stillOnReview,
      stillOnSearch,
      stillOnReviewUrl,
      bundlePopupVisible,
    };
  }
  if (stillOnSearch || stillOnReviewUrl) {
    return {
      onCheckout: false,
      reason: stillOnSearch ? "still-on-flight-search" : "still-on-review-url",
      hasTravelerCopy,
      hasTravelerFields,
      stillOnReview,
      stillOnSearch,
      stillOnReviewUrl,
      bundlePopupVisible,
    };
  }
  if ((hasTravelerCopy || hasTravelerFields) && !stillOnReview) {
    return {
      onCheckout: true,
      reason: hasTravelerFields ? "traveler-fields-visible" : "traveler-copy-visible",
      hasTravelerCopy,
      hasTravelerFields,
      stillOnReview,
      stillOnSearch,
      stillOnReviewUrl,
      bundlePopupVisible,
    };
  }
  return {
    onCheckout: false,
    reason: stillOnReview ? "still-on-review" : "no-checkout-signal",
    hasTravelerCopy,
    hasTravelerFields,
    stillOnReview,
    stillOnSearch,
    stillOnReviewUrl,
    bundlePopupVisible,
  };
}

export function scoreExpediaFlightCandidateText(
  rawText: string,
  target: ExpediaFlightTarget,
): ExpediaFlightCandidateScore {
  const combined = normalizeExpediaFlightLoose(rawText);
  const combinedTight = normalizeExpediaFlightTight(combined);
  const timeMinutes = parseExpediaFlightTimeToMinutes(target.time);
  const airlineLoose = normalizeExpediaFlightLoose(target.airline);
  const airlineWord = airlineLoose.split(" ")[0] ?? "";
  const flightNumberTight = normalizeExpediaFlightTight(target.flightNumber);
  const flightDigits = (target.flightNumber ?? "").replace(/\D/g, "");
  const priceToken = typeof target.price === "number" ? `$${target.price}` : "";

  const hasAirline = !airlineWord || combined.includes(airlineWord) || combined.includes(airlineLoose);
  const visiblePrices = extractExpediaFlightPrices(combined);
  const priceDelta =
    typeof target.price === "number" && visiblePrices.length > 0
      ? Math.min(...visiblePrices.map(value => Math.abs(value - target.price!)))
      : null;
  const hasPrice = !priceToken || combined.includes(priceToken) || priceDelta === 0;
  const hasFlightNumber =
    !flightNumberTight ||
    combinedTight.includes(flightNumberTight) ||
    (flightDigits.length >= 3 && combinedTight.includes(flightDigits));
  const departureMatch =
    combined.match(/departing at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ??
    combined.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i);
  const departureMinutes = parseExpediaFlightTimeToMinutes(departureMatch?.[1] ?? null);
  const timeDelta =
    timeMinutes !== null && departureMinutes !== null
      ? Math.abs(departureMinutes - timeMinutes)
      : null;
  const timeScore =
    timeMinutes !== null
      ? departureMinutes === timeMinutes
        ? 4
        : departureMinutes !== null && Math.abs(departureMinutes - timeMinutes) <= 5
          ? 2
          : 0
      : 1;
  const score =
    (hasFlightNumber ? 5 : 0) +
    timeScore * 2 +
    (hasPrice ? 1 : 0);
  const hasExactTargetTime = timeMinutes !== null && departureMinutes === timeMinutes;
  const hasNearTargetTime = timeDelta !== null && timeDelta <= 120;
  const hasStrongTargetIdentity = hasFlightNumber || hasExactTargetTime;
  const exactMatch =
    (!flightNumberTight || hasFlightNumber) &&
    (timeMinutes === null || timeScore > 0) &&
    (hasStrongTargetIdentity || !priceToken || hasPrice);
  const hasPriceFallbackWithoutTargetTime =
    timeMinutes === null && (hasPrice || (priceDelta !== null && priceDelta <= 60));
  const fallbackEligible =
    hasFlightNumber ||
    hasNearTargetTime ||
    hasPriceFallbackWithoutTargetTime;
  const fallbackScore =
    (hasFlightNumber ? 120 : 0) +
    (hasExactTargetTime ? 100 : 0) +
    (timeDelta !== null ? Math.max(0, 60 - Math.floor(timeDelta / 2)) : 0) +
    (priceDelta !== null ? Math.max(0, 10 - Math.floor(priceDelta / 20)) : 0);

  return {
    hasAirline,
    score,
    exactMatch,
    fallbackEligible,
    fallbackScore,
    hasPrice,
    hasFlightNumber,
    timeScore,
    departureMinutes: departureMinutes ?? -1,
    timeDelta,
    priceDelta,
  };
}

function sortExpediaFlightCandidatesByFit(
  target: ExpediaFlightTarget,
  a: ExpediaFlightCandidateScore,
  b: ExpediaFlightCandidateScore,
  mode: "strict" | "fallback",
): number {
  if (mode === "strict" && b.score !== a.score) return b.score - a.score;
  if (mode === "fallback" && b.fallbackScore !== a.fallbackScore) return b.fallbackScore - a.fallbackScore;
  const timeMinutes = parseExpediaFlightTimeToMinutes(target.time);
  if (timeMinutes !== null) {
    const aDelta = a.departureMinutes >= 0 ? Math.abs(a.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
    const bDelta = b.departureMinutes >= 0 ? Math.abs(b.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
    if (aDelta !== bDelta) return aDelta - bDelta;
  }
  const aPriceDelta = a.priceDelta ?? Number.POSITIVE_INFINITY;
  const bPriceDelta = b.priceDelta ?? Number.POSITIVE_INFINITY;
  if (aPriceDelta !== bPriceDelta) return aPriceDelta - bPriceDelta;
  return 0;
}

export function selectExpediaFlightCandidateLabels(
  labels: readonly string[],
  target: ExpediaFlightTarget,
  prefix = "candidate labels",
): ExpediaFlightCandidateSelectionReport {
  const samples = labels
    .map(label => label.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
  const candidates = labels
    .map((label, index) => {
      const clippedLabel = label.replace(/\s+/g, " ").trim().slice(0, 140);
      if (!clippedLabel.toLowerCase().includes("select")) return null;
      const score = scoreExpediaFlightCandidateText(clippedLabel, target);
      if (!(score.hasAirline || score.exactMatch || score.fallbackEligible)) {
        return null;
      }
      return {
        index,
        label: clippedLabel,
        score,
        summary: formatExpediaFlightCandidateEvidence(clippedLabel, target),
      };
    })
    .filter((candidate): candidate is ExpediaFlightLocatorCandidate => candidate !== null);
  const selection = selectExpediaFlightCandidate(candidates, samples, target, prefix);
  return {
    selected: selection.best
      ? {
          index: selection.best.index,
          label: selection.best.label,
          score: selection.best.score,
          summary: selection.best.summary,
        }
      : null,
    candidateCount: selection.candidateCount,
    matchMode: selection.matchMode,
    matchReason: selection.matchReason,
    samples: selection.samples,
    candidateSummaries: selection.candidateSummaries,
  };
}

// Billing ZIP code selectors for Expedia checkout.
// NOTE: "autocomplete=postal-code" is intentionally omitted — Expedia checkout pages often
// have multiple fields with that attribute (including street address), and browser autocomplete
// can overwrite the filled value with a full address suggestion. Use explicit id/name/placeholder
// selectors only, which are more stable and specific.
const EXPEDIA_BILLING_ZIP_SELECTORS = [
  // Confirmed from live Expedia checkout debug (id="payment_zip_code")
  'input[id="payment_zip_code"]',
  'input[id*="billingZip"], input[id*="billing-zip"], input[id*="BillingZip"]',
  'input[name*="billingZip"], input[name*="billing-zip"]',
  'input[placeholder*="ZIP code"], input[placeholder*="Zip code"], input[placeholder*="Postal code"]',
  'input[aria-label*="Billing ZIP"], input[aria-label*="ZIP code"], input[aria-label*="ZIP Code"]',
  'input[id*="zipCode"], input[id*="zip-code"], input[name*="zipCode"]',
];

const EXPEDIA_BILLING_ADDRESS1_SELECTORS = [
  'input[id*="billingAddressLine1" i]',
  'input[id*="billing-address-line-1" i]',
  'input[id*="addressLine1" i]',
  'input[name*="billingAddressLine1" i]',
  'input[name*="addressLine1" i]',
  'input[placeholder*="123 Main" i]',
  'input[placeholder*="Billing address" i]',
  'input[aria-label*="Billing address 1" i]',
  'input[aria-label*="Address line 1" i]',
];

const EXPEDIA_BILLING_CITY_SELECTORS = [
  'input[id*="billingCity" i]',
  'input[id*="billing-city" i]',
  'input[id*="city" i]',
  'input[name*="billingCity" i]',
  'input[name*="city" i]',
  'input[aria-label*="City" i]',
];

const EXPEDIA_BILLING_STATE_SELECTORS = [
  'select[id*="billingState" i]',
  'select[id*="billing-state" i]',
  'select[id*="state" i]',
  'select[name*="billingState" i]',
  'select[name*="state" i]',
  'select[aria-label*="State" i]',
];

const EXPEDIA_BILLING_COUNTRY_SELECTORS = [
  'select[id*="billingCountry" i]',
  'select[id*="billing-country" i]',
  'select[id*="country" i]',
  'select[name*="billingCountry" i]',
  'select[name*="country" i]',
  'select[aria-label*="Country" i]',
  'select[aria-label*="Country/Territory" i]',
];

/**
 * Fill a form input using the same technique as Booking.com:
 *  1. locator.fill() — standard Playwright
 *  2. Native HTMLInputElement setter + dispatchEvent — forces React to recognize the change
 *  3. pressSequentially — keyboard simulation fallback
 *
 * This is critical for React-controlled inputs where plain fill() doesn't trigger state updates.
 */
async function fillReactInput(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  value: string,
  label: string,
  trace: (msg: string) => void,
  isDigits = false
): Promise<boolean> {
  if (!value) return false;

  const verify = async (): Promise<boolean> => {
    try {
      const actual = await locator.inputValue({ timeout: 1000 });
      return actual.replace(/\s/g, "") === value.replace(/\s/g, "");
    } catch { return false; }
  };

  // Step 1: standard fill
  try {
    await locator.click({ clickCount: 3 }).catch(() => {});
    await locator.fill(value);
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise(r => setTimeout(r, 150));
    if (await verify()) {
      trace(`Expedia fill: "${label}" OK via locator.fill()`);
      return true;
    }
  } catch { /* fall through */ }

  // Step 2: native setter + React event dispatch (same technique as Booking.com)
  try {
    const filled = await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.focus();
      if (nativeSetter) {
        nativeSetter.call(input, "");
        nativeSetter.call(input, v);
      } else {
        input.value = v;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return true;
    }, value).catch(() => false);
    if (filled) {
      await new Promise(r => setTimeout(r, 200));
      if (await verify()) {
        trace(`Expedia fill: "${label}" OK via native setter`);
        return true;
      }
    }
  } catch { /* fall through */ }

  // Step 3: keyboard simulation (last resort)
  try {
    await locator.click({ clickCount: 3 }).catch(() => {});
    if (typeof locator.pressSequentially === "function") {
      await locator.pressSequentially(value, { delay: isDigits ? 40 : 55 });
    } else {
      await page.keyboard.type(value, { delay: isDigits ? 40 : 55 });
    }
    await locator.blur().catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    if (await verify()) {
      trace(`Expedia fill: "${label}" OK via keyboard`);
      return true;
    }
  } catch { /* fall through */ }

  trace(`Expedia fill: "${label}" FAILED — all strategies exhausted`);
  return false;
}

/**
 * Find a visible input by label texts (getByLabel) or CSS selectors,
 * then fill it using the React-compatible native setter technique.
 */
async function findAndFillExpediaField(
  page: Page,
  labelTexts: string[],
  selectors: string[],
  value: string,
  label: string,
  trace: (msg: string) => void,
  isDigits = false
): Promise<boolean> {
  if (!value) return false;

  // Try getByLabel first — most robust, works regardless of id/name/placeholder
  for (const labelText of labelTexts) {
    try {
      const loc = page.getByLabel(labelText, { exact: false });
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      const first = loc.first();
      if (!(await first.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      const ok = await fillReactInput(page, first, value, `${label} [label="${labelText}"]`, trace, isDigits);
      if (ok) return true;
    } catch { /* try next */ }
  }

  // Try CSS selectors — scan main page only (iframes handled separately by fillCardFieldsInPaymentIframes)
  // NOTE: scrollIntoViewIfNeeded is NOT available on Stagehand-proxied locators — do NOT call it here.
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      const ok = await fillReactInput(page, loc, value, `${label} [sel="${sel}"]`, trace, isDigits);
      if (ok) return true;
    } catch { /* try next */ }
  }

  trace(`Expedia fill: "${label}" — no matching visible field found`);
  return false;
}

async function selectExpediaTravelerOption(
  page: Page,
  labelTexts: string[],
  selectors: string[],
  candidates: string[],
  label: string,
  trace: (msg: string) => void,
): Promise<boolean> {
  const trySelect = async (locator: ReturnType<Page["locator"]>, source: string): Promise<boolean> => {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 4); i++) {
      const item = locator.nth(i);
      if (!(await item.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      for (const candidate of candidates) {
        const attempts: Array<string | { value: string } | { label: string }> = [
          candidate,
          { value: candidate },
          { label: candidate },
        ];
        for (const attempt of attempts) {
          try {
            const selected = await item.selectOption(attempt, { timeout: 1000 });
            if (selected.length > 0) {
              trace(`Expedia traveler: selected ${label} via ${source}`);
              return true;
            }
          } catch {
            // Try the next value/label shape.
          }
        }
      }
    }
    return false;
  };

  for (const labelText of labelTexts) {
    const loc = page.getByLabel(labelText, { exact: false });
    if (await trySelect(loc, `label "${labelText}"`)) return true;
  }

  for (const selector of selectors) {
    const loc = page.locator(selector);
    if (await trySelect(loc, `selector "${selector}"`)) return true;
  }

  trace(`Expedia traveler: could not select ${label}`);
  return false;
}

async function clickExpediaTravelerGender(
  page: Page,
  gender: "male" | "female",
  trace: (msg: string) => void,
): Promise<boolean> {
  const label = gender === "male" ? "Male" : "Female";
  const selectors = gender === "male"
    ? [
        'input[type="radio"][value="male" i]',
        'input[type="radio"][aria-label="male" i]',
        'input[type="radio"][id*="male" i]:not([id*="female" i])',
        'input[type="radio"][name*="male" i]:not([name*="female" i])',
      ]
    : [
        'input[type="radio"][value="female" i]',
        'input[type="radio"][aria-label="female" i]',
        'label:has-text("Female") input[type="radio"]',
      ];

  try {
    const loc = page.getByLabel(label, { exact: true });
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 3); i++) {
      const item = loc.nth(i);
      if (!(await item.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      await item.click({ timeout: 1000 });
      trace(`Expedia traveler: selected gender via label "${label}"`);
      return true;
    }
  } catch {
    // Try selector fallback.
  }

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if (!(await loc.isVisible({ timeout: 1000 }).catch(() => false))) continue;
      await loc.click({ timeout: 1000 });
      trace(`Expedia traveler: selected gender via selector "${selector}"`);
      return true;
    } catch {
      // Try next selector.
    }
  }

  trace("Expedia traveler: could not select gender");
  return false;
}

async function fillExpediaTravelerDobFallback(
  page: Page,
  dateOfBirth: string | undefined,
  trace: (msg: string) => void,
): Promise<void> {
  const candidates = buildExpediaDateOfBirthSelectCandidates(dateOfBirth);
  if (!candidates) return;
  await selectExpediaTravelerOption(
    page,
    ["Month", "Birth month", "Date of birth month"],
    [
      'select[aria-label*="month" i]',
      'select[name*="month" i]',
      'select[id*="month" i]',
      'select[data-stid*="month" i]',
    ],
    candidates.month,
    "birth month",
    trace,
  );
  await selectExpediaTravelerOption(
    page,
    ["Day", "Birth day", "Date of birth day"],
    [
      'select[aria-label*="day" i]',
      'select[name*="day" i]',
      'select[id*="day" i]',
      'select[data-stid*="day" i]',
    ],
    candidates.day,
    "birth day",
    trace,
  );
  await selectExpediaTravelerOption(
    page,
    ["Year", "Birth year", "Date of birth year"],
    [
      'select[aria-label*="year" i]',
      'select[name*="year" i]',
      'select[id*="year" i]',
      'select[data-stid*="year" i]',
    ],
    candidates.year,
    "birth year",
    trace,
  );
}

async function fillExpediaSplitCardExpiry(
  page: Page,
  cardExpiry: string | undefined,
  trace: (msg: string) => void,
): Promise<boolean> {
  const candidates = buildExpediaCardExpirySelectCandidates(cardExpiry);
  if (!candidates) return false;

  const evaluateResult = await page.evaluate(({ month, year }: { month: string[]; year: string[] }) => {
    const isVisible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        !("disabled" in el && Boolean((el as HTMLSelectElement).disabled));
    };
    const nativeSelect = (el: HTMLSelectElement, candidates: string[]): boolean => {
      const normalizedCandidates = candidates.map(v => v.toLowerCase().replace(/^0+/, ""));
      const option = Array.from(el.options).find(opt => {
        const value = (opt.value ?? "").trim().toLowerCase().replace(/^0+/, "");
        const text = (opt.textContent ?? "").trim().toLowerCase().replace(/^0+/, "");
        return normalizedCandidates.includes(value) || normalizedCandidates.includes(text);
      });
      if (!option) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(el, option.value);
      else el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === option.value;
    };
    const visibleSelects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"))
      .filter(isVisible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        const id = el.getAttribute("id") ?? "";
        const label = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
        const text = [
          label,
          el.getAttribute("name") ?? "",
          id,
          el.getAttribute("aria-label") ?? "",
          el.getAttribute("autocomplete") ?? "",
          el.closest("label")?.textContent ?? "",
          el.parentElement?.textContent ?? "",
        ].join(" ").replace(/\s+/g, " ").trim().toLowerCase();
        return { el, rect, text };
      });

    let monthSelect = visibleSelects.find(({ text }) =>
      /(expir|expiry|expiration|cc-exp).{0,30}month|month.{0,30}(expir|expiry|expiration|cc-exp)/.test(text)
    )?.el;
    let yearSelect = visibleSelects.find(({ text }) =>
      /(expir|expiry|expiration|cc-exp).{0,30}year|year.{0,30}(expir|expiry|expiration|cc-exp)/.test(text)
    )?.el;

    if (!monthSelect || !yearSelect) {
      const labels = Array.from(document.querySelectorAll<HTMLElement>("label, div, span, p"))
        .filter(isVisible)
        .filter(el => /expiration date|expiry date|expiration|expiry/i.test((el.textContent ?? "").replace(/\s+/g, " ")))
        .map(el => el.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      const labelRect = labels[0];
      if (labelRect) {
        const nearby = visibleSelects
          .filter(({ rect }) => rect.top >= labelRect.top - 4 && rect.top <= labelRect.bottom + 140)
          .sort((a, b) => a.rect.top === b.rect.top ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
        monthSelect = monthSelect ?? nearby[0]?.el;
        yearSelect = yearSelect ?? nearby[1]?.el;
      }
    }

    return {
      month: monthSelect ? nativeSelect(monthSelect, month) : false,
      year: yearSelect ? nativeSelect(yearSelect, year) : false,
    };
  }, { month: candidates.month, year: candidates.year }).catch(() => ({ month: false, year: false }));

  if (evaluateResult.month || evaluateResult.year) {
    trace(`Expedia payment: selected split expiry month=${evaluateResult.month} year=${evaluateResult.year}`);
  }

  let monthOk = evaluateResult.month;
  let yearOk = evaluateResult.year;

  if (!monthOk) {
    monthOk = await selectExpediaTravelerOption(
      page,
      ["Expiration Month", "Expiry Month", "Card expiration month"],
      [
        'select[autocomplete="cc-exp-month"]',
        'select[aria-label*="expiration month" i]',
        'select[aria-label*="expiry month" i]',
        'select[name*="exp" i][name*="month" i]',
        'select[id*="exp" i][id*="month" i]',
      ],
      candidates.month,
      "expiration month",
      trace,
    );
  }
  if (!yearOk) {
    yearOk = await selectExpediaTravelerOption(
      page,
      ["Expiration Year", "Expiry Year", "Card expiration year"],
      [
        'select[autocomplete="cc-exp-year"]',
        'select[aria-label*="expiration year" i]',
        'select[aria-label*="expiry year" i]',
        'select[name*="exp" i][name*="year" i]',
        'select[id*="exp" i][id*="year" i]',
      ],
      candidates.year,
      "expiration year",
      trace,
    );
  }

  return monthOk && yearOk;
}

async function fillExpediaBillingAddressFields(
  page: Page,
  profile: ExpediaGroupProfile,
  trace: (msg: string) => void,
): Promise<void> {
  if (profile.country) {
    const country = profile.country;
    const countryCandidates = Array.from(new Set([
      country,
      country.toUpperCase() === "US" ? "United States of America" : "",
      country.toUpperCase() === "USA" ? "United States of America" : "",
      country.toLowerCase() === "united states" ? "United States of America" : "",
    ].filter(Boolean)));
    await selectExpediaTravelerOption(
      page,
      ["Country/Territory", "Country/Region", "Country"],
      EXPEDIA_BILLING_COUNTRY_SELECTORS,
      countryCandidates,
      "billing country",
      trace,
    );
  }

  if (profile.address_line1) {
    await findAndFillExpediaField(
      page,
      ["Billing address 1", "Billing address", "Address line 1", "Address 1"],
      EXPEDIA_BILLING_ADDRESS1_SELECTORS,
      profile.address_line1,
      "billing address 1",
      trace,
    );
  }

  if (profile.city) {
    await findAndFillExpediaField(
      page,
      ["City", "Billing city"],
      EXPEDIA_BILLING_CITY_SELECTORS,
      profile.city,
      "billing city",
      trace,
    );
  }

  if (profile.state) {
    const state = profile.state;
    const stateCandidates = Array.from(new Set([state, state.toUpperCase()]));
    const selected = await selectExpediaTravelerOption(
      page,
      ["State", "Billing state", "State/Province"],
      EXPEDIA_BILLING_STATE_SELECTORS,
      stateCandidates,
      "billing state",
      trace,
    );
    if (!selected) {
      await findAndFillExpediaField(
        page,
        ["State", "Billing state", "State/Province"],
        EXPEDIA_BILLING_STATE_SELECTORS.map(selector => selector.replace(/^select/, "input")),
        state,
        "billing state",
        trace,
      );
    }
  }
}

export async function scrollExpediaCheckoutToFinalReviewBoundary(
  page: Page,
  trace: (msg: string) => void,
): Promise<boolean> {
  const visible = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a"))
      .filter(el => /complete booking|review and book|book your trip/i.test((el.textContent ?? "").replace(/\s+/g, " ")));
    const target = candidates.find(el => /complete booking/i.test(el.textContent ?? "")) ?? candidates.at(-1);
    if (!target) return false;
    target.scrollIntoView({ block: "center" });
    const rect = target.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }).catch(() => false);
  trace(`Expedia payment boundary: Complete Booking visible=${visible}; final button not clicked`);
  await new Promise(r => setTimeout(r, 500));
  return visible;
}

async function findVisibleInScope(scope: Page | Frame, selectors: string[]): Promise<{ scope: Page | Frame; selector: string } | null> {
  for (const selector of selectors) {
    const visible = await scope.evaluate((sel) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      return !!(el && el.offsetParent !== null && !el.disabled);
    }, selector).catch(() => false);
    if (visible) return { scope, selector };
  }
  return null;
}

async function fillExpediaGroupPaymentField(
  page: Page,
  selectorList: string[],
  value: string,
  label: string,
  trace: (msg: string) => void,
  labelTexts?: string[]
): Promise<boolean> {
  if (!value) return false;

  // Strategy 0: getByLabel — works even without knowing the exact selector/id
  if (labelTexts && labelTexts.length > 0) {
    for (const labelText of labelTexts) {
      try {
        const locator = page.getByLabel(labelText, { exact: false });
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const el = locator.first();
        if (!(await el.isVisible({ timeout: 1000 }).catch(() => false))) continue;
        await el.click({ clickCount: 3 }).catch(() => {});
        await el.fill(value);
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise(r => setTimeout(r, 150));
        const actual = await el.inputValue().catch(() => "");
        if (actual === value) {
          trace(`Expedia payment: filled ${label} via label "${labelText}"`);
          return true;
        }
        // Fallback to keyboard type if fill didn't stick
        await el.click({ clickCount: 3 }).catch(() => {});
        await page.keyboard.type(value, { delay: 40 });
        await page.keyboard.press("Escape").catch(() => {});
        const actual2 = await el.inputValue().catch(() => "");
        if (actual2 === value) {
          trace(`Expedia payment: filled ${label} via label "${labelText}" (keyboard)`);
          return true;
        }
      } catch {
        // try next label
      }
    }
  }

  // First check inline (main page)
  const inlineMatch = await findVisibleInScope(page, selectorList);
  if (inlineMatch) {
    try {
      await page.click(inlineMatch.selector, { clickCount: 3 }).catch(() => {});
      await page.fill(inlineMatch.selector, value);
      // Dismiss any browser autocomplete dropdown that might override the typed value
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise(r => setTimeout(r, 150));
      // Verify the value actually stuck (autocomplete can overwrite it)
      const filled = await page.evaluate((sel) => {
        const el = document.querySelector<HTMLInputElement>(sel);
        return el ? el.value : "";
      }, inlineMatch.selector).catch(() => "");
      if (filled !== value) {
        trace(`Expedia payment: ${label} mismatch after fill (got "${filled.slice(0, 30)}") — retrying with keyboard`);
        // Fallback: triple-click + keyboard type to avoid autocomplete
        await page.click(inlineMatch.selector, { clickCount: 3 }).catch(() => {});
        await page.keyboard.type(value, { delay: 40 });
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise(r => setTimeout(r, 150));
        const filled2 = await page.evaluate((sel) => {
          const el = document.querySelector<HTMLInputElement>(sel);
          return el ? el.value : "";
        }, inlineMatch.selector).catch(() => "");
        trace(`Expedia payment: ${label} after keyboard retry = "${filled2.slice(0, 30)}"`);
      } else {
        trace(`Expedia payment: filled ${label} inline OK`);
      }
      return true;
    } catch (err) {
      trace(`Expedia payment: inline fill failed for ${label}: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  // Try iframes — include ALL non-blank frames since payment processors (Braintree, etc.)
  // use cross-origin iframes whose URLs don't contain "expedia" or "checkout"
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    const rawUrl: unknown = frame.url;
    const frameUrl = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
    if (!frameUrl || frameUrl === "about:blank" || frameUrl === "about:srcdoc") continue;
    const frameMatch = await findVisibleInScope(frame, selectorList);
    if (frameMatch) {
      try {
        await frame.fill(frameMatch.selector, value);
        const filled = await frame.evaluate((sel) => {
          const el = document.querySelector<HTMLInputElement>(sel);
          return el ? el.value : "";
        }, frameMatch.selector).catch(() => "");
        trace(`Expedia payment: filled ${label} in iframe (${frameUrl.slice(0, 60)}) (value present: ${filled.length > 0})`);
        return true;
      } catch (err) {
        trace(`Expedia payment: iframe fill failed for ${label}: ${(err as Error).message?.slice(0, 80)}`);
      }
    }
  }

  trace(`Expedia payment: could not find visible ${label} field (inline or iframe)`);
  return false;
}

interface ExpediaGuestProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  gender?: string;
  date_of_birth?: string;
}

export function normalizeExpediaTravelerGender(value?: string): "male" | "female" | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(m|male|man|mr|男|男性)$/.test(normalized)) return "male";
  if (/^(f|female|woman|ms|mrs|miss|女|女性)$/.test(normalized)) return "female";
  return undefined;
}

export function buildExpediaDateOfBirthSelectCandidates(dateOfBirth?: string): {
  month: string[];
  day: string[];
  year: string[];
} | null {
  const parts = (dateOfBirth ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const [, yyyy, mm, dd] = parts;
  const monthIndex = parseInt(mm, 10);
  const dayIndex = parseInt(dd, 10);
  const monthNames = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[monthIndex] ?? "";
  return {
    month: [mm, String(monthIndex), monthName, monthName.slice(0, 3)].filter(Boolean),
    day: [dd, String(dayIndex)],
    year: [yyyy],
  };
}

export function buildExpediaCardExpirySelectCandidates(cardExpiry?: string): {
  month: string[];
  year: string[];
} | null {
  const parts = (cardExpiry ?? "").trim().match(/^(\d{1,2})\D+(\d{2}|\d{4})$/);
  if (!parts) return null;
  const monthIndex = parseInt(parts[1], 10);
  if (!Number.isFinite(monthIndex) || monthIndex < 1 || monthIndex > 12) return null;
  const fullYear = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  const shortYear = fullYear.slice(-2);
  const mm = String(monthIndex).padStart(2, "0");
  const monthNames = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[monthIndex] ?? "";
  return {
    month: [mm, String(monthIndex), monthName, monthName.slice(0, 3)].filter(Boolean),
    year: [fullYear, shortYear],
  };
}

export interface ExpediaFlightTravelerFormState {
  missingRequiredFields: string[];
  filledFields: string[];
  visibleRequiredFields: string[];
}

export interface ExpediaFlightTravelerControlSnapshot {
  checked: boolean;
  selectedIndex: number;
  tagName: string;
  text: string;
  type: string;
  value: string;
}

export interface ExpediaFlightTravelerFormSnapshot {
  bodyText: string;
  controls: ExpediaFlightTravelerControlSnapshot[];
}

export function summarizeExpediaFlightTravelerFormState(
  snapshot: ExpediaFlightTravelerFormSnapshot,
): ExpediaFlightTravelerFormState {
  const controls = snapshot.controls.map(control => ({
    ...control,
    text: control.text.toLowerCase(),
    type: control.type.toLowerCase(),
    tagName: control.tagName.toLowerCase(),
    value: control.value.trim(),
  }));
  const bodyText = snapshot.bodyText.toLowerCase();

  const inputValue = (control: ExpediaFlightTravelerControlSnapshot): string => {
    if (control.tagName.toLowerCase() === "select") {
      return control.selectedIndex > 0 ? control.value.trim() : "";
    }
    return control.value.trim();
  };

  const hasFilled = (patterns: RegExp[]): boolean => controls.some(control =>
    patterns.some(pattern => pattern.test(control.text)) && inputValue(control).length > 0
  );
  const hasVisible = (patterns: RegExp[]): boolean => controls.some(control =>
    patterns.some(pattern => pattern.test(control.text))
  );
  const bodyHas = (patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(bodyText));
  const radioChecked = (patterns: RegExp[]): boolean => {
    const radios = controls.filter(control =>
      control.type === "radio" && patterns.some(pattern => pattern.test(control.text))
    );
    return radios.length > 0 && radios.some(control => control.checked);
  };

  const visibleRequiredFields: string[] = [];
  const missingRequiredFields: string[] = [];
  const filledFields: string[] = [];
  const addExpected = (label: string, patterns: RegExp[]): void => {
    const visible = hasVisible(patterns) || bodyHas(patterns);
    const filled = hasFilled(patterns);
    if (visible) visibleRequiredFields.push(label);
    if (filled) filledFields.push(label);
    if (visible && !filled) missingRequiredFields.push(label);
  };

  addExpected("first name", [/first.?name|given.?name|forename|firstname/]);
  addExpected("last name", [/last.?name|family.?name|surname|lastname/]);
  addExpected("email address", [/e.?mail/]);
  addExpected("phone number", [/phone|mobile|cellular|tel(?:ephone)?/]);

  if (bodyText.includes("date of birth")) {
    addExpected("birth month", [/\bmonth\b/]);
    addExpected("birth day", [/\bday\b/]);
    addExpected("birth year", [/\byear\b/]);
  }

  if (bodyText.includes("gender")) {
    visibleRequiredFields.push("gender");
    if (radioChecked([/gender|male|female/])) filledFields.push("gender");
    else missingRequiredFields.push("gender");
  }

  if (bodyText.includes("who's traveling") && visibleRequiredFields.length === 0) {
    missingRequiredFields.push("traveler form fields not detected");
  }

  return {
    missingRequiredFields: Array.from(new Set(missingRequiredFields)),
    filledFields: Array.from(new Set(filledFields)),
    visibleRequiredFields: Array.from(new Set(visibleRequiredFields)),
  };
}

/**
 * Fill Expedia / Hotels.com guest fields using page.evaluate + native HTMLInputElement setter.
 *
 * Uses page.evaluate() instead of locator.evaluate() because the Stagehand proxy
 * does NOT expose .evaluate() on locators. page.evaluate() is always available.
 *
 * Expedia uses non-standard IDs like "smart-form-control-input-component-trave"
 * so we match by placeholder pattern and input type instead of id/name/autocomplete.
 *
 * Confirmed field patterns from live debug:
 *   input[0]: placeholder="(e.g. John)"  type=text  → First name
 *   input[1]: placeholder="(e.g. Smith)" type=text  → Last name
 *   input[2]: type=email                            → Email
 *   input[3]: type=tel (not country code)           → Phone
 */
export async function fillExpediaGuestForm(
  page: Page,
  profile: ExpediaGuestProfile,
  trace: (msg: string) => void,
): Promise<void> {
  // Wait for guest fields to appear using confirmed placeholder patterns
  await page.waitForSelector(
    'input[placeholder*="John"], input[placeholder*="Smith"], input[type="email"]',
    { timeout: 8000 }
  ).catch(() => null);
  await new Promise(r => setTimeout(r, 400));

  // Dismiss any checkout nudge modal (e.g. "This booking is almost yours!") before filling
  await dismissExpediaAlmostYoursModal(page, trace);

  const phoneDigits = (profile.phone ?? "").replace(/\D/g, "");
  const gender = normalizeExpediaTravelerGender(profile.gender);

  // Fill all 4 guest fields via page.evaluate + native setter in a single pass.
  // This approach:
  //   - Uses page.evaluate() which IS available on the Stagehand proxy
  //   - Finds inputs by placeholder/type pattern (not by fragile id/name selectors)
  //   - Uses native HTMLInputElement setter to trigger React state updates
  const results = await page.evaluate(
    ({ first, last, email, phone, dateOfBirth, gender }: { first: string; last: string; email: string; phone: string; dateOfBirth: string; gender: string }) => {
      const nativeFill = (el: HTMLInputElement, val: string): boolean => {
        if (!val) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        el.focus();
        if (setter) { setter.call(el, ""); setter.call(el, val); }
        else { el.value = ""; el.value = val; }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
        return el.value === val;
      };
      const nativeSelect = (el: HTMLSelectElement, candidates: string[]): boolean => {
        const normalizedCandidates = candidates.map(v => v.toLowerCase().replace(/^0+/, ""));
        const option = Array.from(el.options).find(opt => {
          const value = (opt.value ?? "").trim().toLowerCase().replace(/^0+/, "");
          const text = (opt.textContent ?? "").trim().toLowerCase().replace(/^0+/, "");
          return normalizedCandidates.includes(value) || normalizedCandidates.includes(text);
        });
        if (!option) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        if (setter) setter.call(el, option.value);
        else el.value = option.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === option.value;
      };
      const nativeCheck = (el: HTMLInputElement): boolean => {
        if (!el || el.type !== "radio" || el.disabled) return false;
        el.click();
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.checked;
      };
      const fieldText = (el: Element): string => {
        const id = el.getAttribute("id") ?? "";
        const label = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
        return [
          label,
          el.getAttribute("name") ?? "",
          el.getAttribute("id") ?? "",
          el.getAttribute("aria-label") ?? "",
          (el as HTMLInputElement).placeholder ?? "",
          el.closest("label")?.textContent ?? "",
          el.parentElement?.textContent ?? "",
        ].join(" ").replace(/\s+/g, " ").trim().toLowerCase();
      };

      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      // Filter to visible, interactive inputs only
      const visible = allInputs.filter(el =>
        el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" &&
        !el.disabled && (el.offsetParent !== null || el.getBoundingClientRect().width > 0)
      );

      const results: Record<string, boolean | string> = {};

      // First name: placeholder contains "John" (confirmed: "(e.g. John)")
      const firstEl = visible.find(el =>
        el.placeholder.toLowerCase().includes("john") ||
        el.autocomplete === "given-name" ||
        el.id.toLowerCase().includes("firstname") ||
        el.name.toLowerCase().includes("firstname")
      );
      results.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

      // Last name: placeholder contains "Smith" (confirmed: "(e.g. Smith)")
      const lastEl = visible.find(el =>
        el.placeholder.toLowerCase().includes("smith") ||
        el.autocomplete === "family-name" ||
        el.id.toLowerCase().includes("lastname") ||
        el.name.toLowerCase().includes("lastname")
      );
      results.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

      // Email: type="email" is unambiguous
      const emailEl = visible.find(el => el.type === "email");
      results.email = emailEl ? nativeFill(emailEl, email) : "not_found";

      // Phone: type="tel" but NOT country code/region selectors
      const phoneEl = visible.find(el =>
        el.type === "tel" &&
        !el.id.toLowerCase().includes("country") &&
        !el.id.toLowerCase().includes("region") &&
        !el.id.toLowerCase().includes("code") &&
        !el.name.toLowerCase().includes("country") &&
        !(el.getAttribute("aria-label") ?? "").toLowerCase().includes("country")
      );
      results.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

      const dobParts = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dobParts) {
        const [, yyyy, mm, dd] = dobParts;
        const monthNames = [
          "", "january", "february", "march", "april", "may", "june",
          "july", "august", "september", "october", "november", "december",
        ];
        const visibleSelects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"))
          .filter(el => !el.disabled && (el.offsetParent !== null || el.getBoundingClientRect().width > 0));
        const monthSelect = visibleSelects.find(el => /month/.test(fieldText(el)));
        const daySelect = visibleSelects.find(el => /\bday\b/.test(fieldText(el)));
        const yearSelect = visibleSelects.find(el => /\byear\b/.test(fieldText(el)));
        results.birthMonth = monthSelect ? nativeSelect(monthSelect, [mm, String(parseInt(mm, 10)), monthNames[parseInt(mm, 10)] ?? ""]) : "not_found";
        results.birthDay = daySelect ? nativeSelect(daySelect, [dd, String(parseInt(dd, 10))]) : "not_found";
        results.birthYear = yearSelect ? nativeSelect(yearSelect, [yyyy]) : "not_found";
      }

      if (gender) {
        const genderRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
          .filter(el => !el.disabled && (el.offsetParent !== null || el.getBoundingClientRect().width > 0));
        const genderEl = genderRadios.find(el => {
          const text = fieldText(el);
          if (gender === "male") return /\bmale\b/.test(text) && !/\bfemale\b/.test(text);
          return /\bfemale\b/.test(text);
        });
        results.gender = genderEl ? nativeCheck(genderEl) : "not_found";
      }

      return results;
    },
    {
      first: profile.first_name ?? "",
      last: profile.last_name ?? "",
      email: profile.email ?? "",
      phone: phoneDigits,
      dateOfBirth: profile.date_of_birth ?? "",
      gender: gender ?? "",
    }
  ).catch((err: Error) => {
    trace(`Expedia guest fill: page.evaluate failed — ${err.message?.slice(0, 80)}`);
    return {} as Record<string, boolean | string>;
  });

  trace(`Expedia guest fill results: ${JSON.stringify(results)}`);

  // Fallback for any field that wasn't found via page.evaluate: try findAndFillExpediaField
  if (results.firstName !== true && profile.first_name) {
    trace("Expedia guest: first name not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["First name", "First Name", "Given name"],
      ['input[placeholder*="John"]', 'input[autocomplete="given-name"]', 'input[placeholder*="First name"]'],
      profile.first_name, "first name", trace);
  }
  if (results.lastName !== true && profile.last_name) {
    trace("Expedia guest: last name not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Last name", "Last Name", "Family name"],
      ['input[placeholder*="Smith"]', 'input[autocomplete="family-name"]', 'input[placeholder*="Last name"]'],
      profile.last_name, "last name", trace);
  }
  if (results.email !== true && profile.email) {
    trace("Expedia guest: email not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Email address", "Email"],
      ['input[type="email"]', 'input[autocomplete="email"]'],
      profile.email, "email", trace);
  }
  if (results.phone !== true && phoneDigits) {
    trace("Expedia guest: phone not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Phone number", "Phone Number"],
      ['input[type="tel"]:not([id*="country"])'],
      phoneDigits, "phone", trace, true);
  }
  if ((results.birthMonth !== true || results.birthDay !== true || results.birthYear !== true) && profile.date_of_birth) {
    trace("Expedia guest: date of birth not fully filled via evaluate - trying locator fallback");
    await fillExpediaTravelerDobFallback(page, profile.date_of_birth, trace);
  }
  if (results.gender !== true && gender) {
    trace("Expedia guest: gender not found via evaluate - trying locator fallback");
    await clickExpediaTravelerGender(page, gender, trace);
  }
}

/**
 * Dismiss the Expedia "This booking is almost yours!" nudge modal if present.
 * This modal appears on the /checkout/session/ payment page and blocks form fill.
 * Strategy: click "Continue booking" button, or fall back to the × close button.
 * @param waitMs - optional wait before checking (modal may render after page interaction)
 */
export async function inspectExpediaFlightTravelerFormState(page: Page): Promise<ExpediaFlightTravelerFormState> {
  const snapshot = await page.evaluate((): ExpediaFlightTravelerFormSnapshot => {
    const isVisible = (el: Element): boolean => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0";
    };
    const fieldText = (el: Element): string => {
      const id = el.getAttribute("id") ?? "";
      const label = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
      const localText = [
        label,
        el.getAttribute("name") ?? "",
        el.getAttribute("id") ?? "",
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("autocomplete") ?? "",
        (el as HTMLInputElement).placeholder ?? "",
        el.closest("label")?.textContent ?? "",
      ].join(" ").replace(/\s+/g, " ").trim().toLowerCase();
      if (localText) return localText;

      const parentText = (el.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const labelFamilies = [
        /first.?name|given.?name|forename|firstname/,
        /last.?name|family.?name|surname|lastname/,
        /e.?mail/,
        /phone|mobile|cellular|tel(?:ephone)?/,
        /country|territory/,
        /\bmonth\b/,
        /\bday\b/,
        /\byear\b/,
        /gender|male|female/,
      ];
      const familyMatches = labelFamilies.filter(pattern => pattern.test(parentText)).length;
      return parentText.length <= 120 && familyMatches <= 1 ? parentText : "";
    };
    const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]), select, textarea'
    )).filter(el => isVisible(el) && !el.disabled);

    return {
      bodyText: (document.body.textContent ?? "").toLowerCase(),
      controls: controls.map((el) => ({
        checked: el instanceof HTMLInputElement ? el.checked : false,
        selectedIndex: el instanceof HTMLSelectElement ? el.selectedIndex : -1,
        tagName: el.tagName,
        text: fieldText(el),
        type: el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase(),
        value: (el.value ?? "").trim(),
      })),
    };
  }).catch(() => null);
  if (!snapshot) {
    return {
      missingRequiredFields: ["traveler form inspection failed"],
      filledFields: [],
      visibleRequiredFields: [],
    };
  }
  return summarizeExpediaFlightTravelerFormState(snapshot);
}

async function dismissExpediaAlmostYoursModal(page: Page, trace: (msg: string) => void, waitMs = 0): Promise<void> {
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

  // Detect modal via text content OR by presence of "Continue booking" button
  // (body.textContent can be slow/stale; button presence is more reliable)
  const hasModal = await page.evaluate(() => {
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    if (bodyText.includes("almost yours") || bodyText.includes("booking is almost")) return true;
    // Also detect via "Continue booking" button that is visible (used in the modal)
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    return buttons.some(btn => {
      const text = (btn.textContent ?? "").trim().toLowerCase();
      if (text !== "continue booking") return false;
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }).catch(() => false);

  trace(`Expedia: 'almost yours' modal check — found=${hasModal}`);
  if (!hasModal) return;

  // Strategy 1: click the "Continue booking" button directly
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
    for (const btn of buttons) {
      const text = (btn.textContent ?? "").trim().toLowerCase();
      if (text === "continue booking" || text === "continue") {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          (btn as HTMLElement).click();
          return "continue_booking";
        }
      }
    }
    return null;
  }).catch(() => null);

  if (clicked) {
    trace(`Expedia: dismissed 'almost yours' modal via '${clicked}' button`);
    await new Promise(r => setTimeout(r, 600));
    return;
  }

  // Strategy 2: click the × close button inside any modal-like container with "almost yours" text
  const closedX = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const btn of allButtons) {
      const text = (btn.textContent ?? "").trim();
      const ariaLabel = (btn.getAttribute("aria-label") ?? "").toLowerCase();
      const isClose = text === "×" || text === "✕" || text === "✗" ||
        text.toLowerCase() === "x" || text.toLowerCase() === "close" ||
        ariaLabel.includes("close") || ariaLabel.includes("dismiss");
      if (!isClose) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Verify container has "almost yours" text
      let ancestor: HTMLElement | null = btn.parentElement;
      while (ancestor && ancestor !== document.body) {
        if ((ancestor.textContent ?? "").toLowerCase().includes("almost yours")) {
          (btn as HTMLElement).click();
          return true;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return false;
  }).catch(() => false);

  if (closedX) {
    trace("Expedia: dismissed 'almost yours' modal via × close button");
    await new Promise(r => setTimeout(r, 600));
    return;
  }

  // Strategy 3: press Escape — works for most modal implementations
  try {
    await page.keyboard.press("Escape");
    trace("Expedia: pressed Escape to dismiss 'almost yours' modal");
    await new Promise(r => setTimeout(r, 600));
    return;
  } catch { /* ignore */ }

  // Strategy 4: click the first visible button INSIDE the modal container
  // (catches SVG-icon-only × buttons with no text or aria-label)
  const closedAny = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const modalEl = allEls.find(el => {
      const t = (el.textContent ?? "").toLowerCase();
      return (t.includes("almost yours") || t.includes("continue booking")) &&
        el.querySelectorAll("button, [role='button']").length > 0;
    });
    if (!modalEl) return false;
    // Try non-primary buttons first (the close/dismiss button), then primary
    const btns = Array.from(modalEl.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const closeBtn = btns.find(b => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const t = (b.textContent ?? "").trim().toLowerCase();
      // Close buttons are usually small and have short/empty text
      return t === "" || t === "×" || t === "✕" || t === "x" || t.length < 5;
    });
    const target = closeBtn ?? btns.find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (target) { target.click(); return true; }
    return false;
  }).catch(() => false);

  if (closedAny) {
    trace("Expedia: dismissed 'almost yours' modal via strategy 4 (any button in modal container)");
    await new Promise(r => setTimeout(r, 600));
  } else {
    trace("Expedia: 'almost yours' modal present but could not dismiss — continuing anyway");
  }
}

/**
 * Scan all non-blank iframes for payment widget card inputs and fill them.
 *
 * Expedia's payment widget (Checkout.com, Braintree, etc.) loads card inputs
 * inside cross-origin iframes positioned over placeholder elements in the main DOM.
 * The Frame objects returned by page.frames() have full Playwright API (NOT the
 * Stagehand proxy restriction), so we can use frame.locator().nth().fill() freely.
 *
 * Detection: match visible inputs by placeholder, aria-label, or autocomplete:
 *   - Card number: placeholder "0000 0000 0000 0000" or aria-label/autocomplete
 *   - Expiry: placeholder "MM/YY" or similar
 *   - Cardholder name: placeholder/label contains "name"
 *
 * Returns which fields were successfully filled in iframes.
 */
async function fillCardFieldsInPaymentIframes(
  page: Page,  // needed for page.keyboard fallback
  cardName: string,
  cardNumber: string,
  cardExpiry: string,
  trace: (msg: string) => void
): Promise<{ name: boolean; number: boolean; expiry: boolean }> {
  // Safe URL getter — f.url is a method, not a property; calling without `this` binding loses context
  const getFrameUrl = (f: Frame): string => {
    try { return f.url(); } catch { return "(url-error)"; }
  };

  const allFrames = page.frames();
  const nonMainFrames = allFrames.filter(f => f !== page.mainFrame());
  trace(`Expedia card iframes: total=${allFrames.length}, non-main=${nonMainFrames.length}`);

  // Debug dump: show URL + input count for every non-main frame.
  // Checkout.com uses about:srcdoc frames (previously filtered out incorrectly).
  for (let i = 0; i < Math.min(nonMainFrames.length, 30); i++) {
    const f = nonMainFrames[i];
    const url = getFrameUrl(f);
    const inputCount = await f.evaluate(() =>
      document.querySelectorAll("input").length
    ).catch(() => -1);
    // Only log frames with inputs or the first few (to diagnose empty frames)
    if (inputCount > 0 || i < 6) {
      trace(`  frame[${i}] url="${url.slice(0, 60)}" inputs=${inputCount}`);
    }
  }

  // Scan ALL non-main frames — do NOT filter by URL.
  // Checkout.com and similar widgets use about:srcdoc or dynamically-written about:blank
  // frames that contain the real card inputs, hidden from the parent page.
  const filled = { name: false, number: false, expiry: false };

  for (const frame of nonMainFrames) {
    const frameUrl = getFrameUrl(frame);

    // Get all non-hidden inputs in this frame.
    // NOTE: We intentionally DO NOT filter by visibility here — Checkout.com and
    // similar PCI-widget iframes often have inputs with offsetParent === null (they
    // use position:fixed or are inside a transform context), so the strict visibility
    // check would skip them. We try ALL non-hidden inputs and let fill() fail gracefully.
    const inputs = await frame.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((el, i) => ({
        i,
        type: el.type || "text",
        id: el.id || "",
        placeholder: el.placeholder || "",
        autocomplete: el.autocomplete || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      }))
    ).catch(() => [] as Array<{ i: number; type: string; id: string; placeholder: string; autocomplete: string; ariaLabel: string }>);

    const candidateInputs = inputs.filter(d => {
      if (d.type === "hidden") return false;
      const combined = `${d.id} ${d.placeholder} ${d.autocomplete} ${d.ariaLabel}`.toLowerCase();
      return !/\bcvv\b|\bcvc\b|security.?code|verification.?code|card.?security/.test(combined);
    });
    if (candidateInputs.length === 0) continue;

    trace(`Expedia card: frame (${frameUrl.slice(0, 60)}) has ${candidateInputs.length} input(s)`);
    for (const d of candidateInputs) {
      trace(`  [${d.i}] type=${d.type} id="${d.id.slice(0, 30)}" ph="${d.placeholder.slice(0, 30)}" aria="${d.ariaLabel.slice(0, 30)}" ac=${d.autocomplete}`);
    }

    for (const inp of candidateInputs) {
      const ph = inp.placeholder.toLowerCase();
      const lbl = inp.ariaLabel.toLowerCase();
      const ac = inp.autocomplete.toLowerCase();
      const id = inp.id.toLowerCase();

      // Identify field type by placeholder / aria-label / autocomplete / id
      let fieldType: "name" | "number" | "expiry" | null = null;
      let value = "";

      if (
        ph.includes("0000") || ph.includes("card number") ||
        lbl.includes("card number") || lbl.includes("card no") ||
        ac === "cc-number" || id === "pan" || id.includes("pan-") ||
        id.includes("card-num") || id.includes("cardnum") ||
        id === "number" || id === "payment_credit_card" || id.includes("credit-card")
      ) {
        fieldType = "number";
        value = cardNumber;
      } else if (
        ph === "mm/yy" || ph.includes("mm / yy") || ph.includes("mm/yyyy") ||
        ph.includes("expir") || lbl.includes("expir") || lbl.includes("expiry") ||
        ac === "cc-exp" || id === "expiry" || id.includes("expir")
      ) {
        fieldType = "expiry";
        value = cardExpiry;
      } else if (
        // Use PRECISE matching only — "id.includes('name')" is too broad and matches
        // guest form inputs like "smart-form-control-input-component-traveler-first-name"
        ac === "cc-name" ||
        id === "name" || id === "chn" || id.includes("chn-") ||
        lbl.includes("name on card") || lbl.includes("cardholder") ||
        ph.includes("name on card") || ph.includes("cardholder")
      ) {
        fieldType = "name";
        value = cardName;
      }

      if (!fieldType || !value) continue;

      // Skip hidden CKO placeholder inputs (id ends with "-placeholder" or "-input-placeholder").
      // These are display:none backing elements for CKO iframes — filling them does nothing,
      // and the page.type() fallback would type into whatever random element has focus.
      if (inp.id.includes("-placeholder")) continue;

      try {
        const loc = frame.locator("input").nth(inp.i);
        // NOTE: scrollIntoViewIfNeeded is NOT available on Stagehand-proxied locators.
        // Skip it — click() will scroll automatically if needed.
        await loc.click({ clickCount: 3 }).catch(() => {});
        await loc.fill(value);
        await new Promise(r => setTimeout(r, 200));
        const actual = await loc.inputValue().catch(() => "");
        const ok = actual.replace(/\s/g, "") === value.replace(/\s/g, "") || actual.length > 0;
        trace(`Expedia card: ${fieldType} fill — ${ok ? "OK" : "EMPTY"} (got "${actual.slice(0, 20)}")`);
        if (ok) filled[fieldType] = true;

        // Fallback: keyboard type if fill didn't stick
        // page.keyboard is undefined on Stagehand v3 — use Stagehand's type() API
        if (!ok) {
          await loc.click({ clickCount: 3 }).catch(() => {});
          await (page as unknown as { type: (t: string) => Promise<void> }).type(value);
          await new Promise(r => setTimeout(r, 200));
          const actual2 = await loc.inputValue().catch(() => "");
          if (actual2.length > 0) {
            trace(`Expedia card: ${fieldType} fill via keyboard — OK`);
            filled[fieldType] = true;
          }
        }
      } catch (err) {
        trace(`Expedia card: ${fieldType} fill error — ${(err as Error).message?.slice(0, 60)}`);
      }
    }

    // ── Frame-locator fallback: try CSS selectors directly on frame ─────────
    // This catches cases where evaluate() returned inputs but index-based .nth()
    // mismatches due to DOM changes between evaluate and locator calls.
    if (!filled.number && cardNumber) {
      for (const sel of [
        'input[placeholder*="0000"]', 'input[autocomplete="cc-number"]',
        'input[id*="pan"]', 'input[id*="card-num"]', 'input[id*="cardnum"]',
        'input[id="number"]', 'input[id*="credit-card"]',
      ]) {
        try {
          const loc = frame.locator(sel).first();
          const count = await loc.count().catch(() => 0);
          if (count === 0) continue;
          await loc.click({ clickCount: 3 }).catch(() => {});
          if (typeof (loc as { pressSequentially?: (v: string, o?: { delay: number }) => Promise<void> }).pressSequentially === "function") {
            await (loc as { pressSequentially: (v: string, o: { delay: number }) => Promise<void> }).pressSequentially(cardNumber, { delay: 50 });
          } else {
            await loc.fill(cardNumber);
          }
          const actual = await loc.inputValue().catch(() => "");
          if (actual.replace(/\s/g, "").length > 0) {
            trace(`Expedia card: number filled via frame.locator("${sel}") in ${frameUrl.slice(0, 40)}`);
            filled.number = true;
            break;
          }
        } catch { /* try next */ }
      }
    }
    if (!filled.expiry && cardExpiry) {
      for (const sel of [
        'input[placeholder="MM/YY"]', 'input[placeholder*="MM"]',
        'input[autocomplete="cc-exp"]', 'input[id*="expir"]', 'input[id="expiry"]',
      ]) {
        try {
          const loc = frame.locator(sel).first();
          const count = await loc.count().catch(() => 0);
          if (count === 0) continue;
          await loc.click({ clickCount: 3 }).catch(() => {});
          await loc.fill(cardExpiry);
          const actual = await loc.inputValue().catch(() => "");
          if (actual.replace(/\s/g, "").length > 0) {
            trace(`Expedia card: expiry filled via frame.locator("${sel}") in ${frameUrl.slice(0, 40)}`);
            filled.expiry = true;
            break;
          }
        } catch { /* try next */ }
      }
    }
  }

  const anyFilled = filled.name || filled.number || filled.expiry;
  if (!anyFilled) {
    trace("Expedia card iframes: no card inputs found in any frame — widget may not be loaded");
  } else {
    trace(`Expedia card iframes: filled name=${filled.name}, number=${filled.number}, expiry=${filled.expiry}`);
  }
  return filled;
}

export async function fillExpediaGroupPaymentForm(
  page: Page,
  profile: ExpediaGroupProfile,
  trace: (msg: string) => void
): Promise<void> {
  // Wait for the checkout page to fully render before interacting.
  // Expedia's React checkout lazy-renders card fields and modals after initial page load.
  trace("Expedia payment: waiting for checkout page to fully render...");
  await Promise.race([
    // Wait for card number input OR the modal to appear (whichever comes first)
    page.waitForSelector(
      'input[placeholder="0000 0000 0000 0000"], input[placeholder*="Name on card"], [placeholder*="Card number"], input[id*="cardNumber"], input[autocomplete="cc-number"]',
      { timeout: 8000 }
    ).catch(() => null),
    page.waitForSelector(
      'button:has-text("Continue booking"), button:has-text("continue booking")',
      { timeout: 8000 }
    ).catch(() => null),
    new Promise(r => setTimeout(r, 8000)), // hard cap
  ]);
  // Extra settle time after DOM appears (React effects / autocomplete / animation)
  await new Promise(r => setTimeout(r, 800));
  trace("Expedia payment: page settled — proceeding with modal dismiss and form fill");

  // Dismiss the "This booking is almost yours!" nudge modal if present
  await dismissExpediaAlmostYoursModal(page, trace);

  // ── DEBUG: dump all inputs via page.evaluate (works with Stagehand proxy) ──
  try {
    const inputData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map((e, i) => ({
        i,
        type: e.type || "-",
        id: (e.id || "-").slice(0, 40),
        name: (e.name || "-").slice(0, 40),
        placeholder: (e.placeholder || "-").slice(0, 40),
        autocomplete: e.autocomplete || "-",
        ariaLabel: (e.getAttribute("aria-label") || "-").slice(0, 40),
        visible: e.offsetParent !== null,
      }));
    }).catch(() => []);
    trace(`Expedia DEBUG: page.evaluate found ${inputData.length} input(s)`);
    for (const d of inputData.slice(0, 12)) {
      trace(`  input[${d.i}]: ${JSON.stringify(d)}`);
    }
  } catch (dbgErr) {
    trace(`Expedia DEBUG: input scan failed — ${(dbgErr as Error).message?.slice(0, 80)}`);
  }

  // Always attempt guest fill on /checkout/session (combined guest+payment page)
  trace("Expedia payment: attempting guest info fill (combined checkout page)");
  await fillExpediaGuestForm(page, profile, trace);
  await new Promise(r => setTimeout(r, 400));

  // Detect inline vs iframe payment (use Playwright locator for shadow DOM support)
  const inlineCardCount = await page.locator(
    'input[placeholder="0000 0000 0000 0000"], input[id*="cardNumber"], input[autocomplete="cc-number"]'
  ).count().catch(() => 0);

  // Log all non-blank iframes for debugging (payment processor iframes may be cross-origin)
  const allFrames = page.frames().filter(f => {
    if (f === page.mainFrame()) return false;
    const rawUrl: unknown = f.url;
    const url = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "");
    return url && url !== "about:blank" && url !== "about:srcdoc";
  });
  const iframeCount = allFrames.length;
  if (allFrames.length > 0) {
    trace(`Expedia payment: found ${allFrames.length} non-blank iframe(s): ${allFrames.map(f => {
      const u: unknown = f.url;
      return (typeof u === "function" ? (u as () => string)() : (u as string) ?? "").slice(0, 60);
    }).join(" | ")}`);
  }

  trace(`Expedia payment: detected ${inlineCardCount} inline card input(s), ${iframeCount} total iframe(s)`);

  // Handle Expedia "Protect your stay" required section — select "No protection".
  // This section is required before "Book now" becomes active.
  const protectionSelected = await page.evaluate(() => {
    // Look for the "No protection" radio/button option
    const labels = Array.from(document.querySelectorAll<HTMLElement>('label, button, [role="radio"], [role="button"], input[type="radio"]'));
    const noProtLabel = labels.find(el => {
      const text = (el.textContent ?? "").trim().toLowerCase();
      return text.includes("no protection") || text.includes("willing to risk") || text.includes("i'm willing");
    });
    if (noProtLabel) {
      noProtLabel.scrollIntoView({ block: "center" });
      noProtLabel.click();
      return true;
    }
    // Also try clicking an <input type="radio"> with nearby "no protection" text
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const radio of radios) {
      const container = radio.closest('[class*="option"], [class*="Option"], [class*="plan"], li, div');
      const text = (container?.textContent ?? "").toLowerCase();
      if (text.includes("no protection") || text.includes("willing to risk")) {
        radio.click();
        return true;
      }
    }
    return false;
  }).catch(() => false);
  if (protectionSelected) {
    trace("Expedia payment: selected 'No protection' plan");
  } else {
    trace("Expedia payment: 'Protect your stay' section not found or already handled");
  }

  // After protection plan interaction, Expedia may show a confirmation dialog
  // (e.g. "Your stay is not protected. Continue?"). Dismiss it before card fill.
  await new Promise(r => setTimeout(r, 600));
  const protectionModalDismissed = await page.evaluate(() => {
    // Look for a modal/dialog overlay that appeared after protection plan selection
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], .modal, [class*="modal"], [class*="dialog"], [class*="overlay"]'
    ));
    for (const dialog of dialogs) {
      const r = dialog.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Find a dismiss button inside
      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button, [role="button"]'));
      const dismissBtn = buttons.find(btn => {
        const text = (btn.textContent ?? "").trim().toLowerCase();
        return text === "continue" || text === "continue booking" || text === "got it" ||
          text === "ok" || text === "close" || text === "i understand" || text === "dismiss" ||
          text === "×" || text === "✕";
      });
      if (dismissBtn) {
        const br = dismissBtn.getBoundingClientRect();
        if (br.width > 0 && br.height > 0) {
          (dismissBtn as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);
  if (protectionModalDismissed) {
    trace("Expedia payment: dismissed protection plan confirmation dialog");
    await new Promise(r => setTimeout(r, 500));
  }
  // Also run the "almost yours" check
  await dismissExpediaAlmostYoursModal(page, trace, 200);

  // Ensure "Card" payment method is selected (clicking protection plan may deselect it)
  const cardSelected = await page.evaluate(() => {
    // Find and click a "Card" radio/button in the payment section
    const els = Array.from(document.querySelectorAll<HTMLElement>('input[type="radio"], button, [role="radio"], label'));
    const cardEl = els.find(el => {
      const text = (el.textContent ?? "").trim().toLowerCase();
      const val = (el as HTMLInputElement).value?.toLowerCase() ?? "";
      return text === "card" || val === "card" || text.includes("credit") || text.includes("debit");
    });
    if (cardEl) { (cardEl as HTMLElement).click(); return true; }
    return false;
  }).catch(() => false);
  if (cardSelected) {
    trace("Expedia payment: re-selected 'Card' payment method");
    await new Promise(r => setTimeout(r, 600));
  }

  // Scroll to the card details section so fields become visible
  await page.evaluate(() => {
    const cardSection = Array.from(document.querySelectorAll<HTMLElement>('*')).find(el => {
      const text = (el.textContent ?? "").trim();
      return text.startsWith("Card details") || text.startsWith("Card number") || text.includes("0000 0000 0000");
    });
    if (cardSection) cardSection.scrollIntoView({ block: "center" });
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));

  // ── Card fields strategy ──────────────────────────────────────────────────────
  // Expedia uses Checkout.com (CKO) for payment. CKO renders card inputs inside
  // cross-origin iframes that are positioned OVER placeholder divs in the main DOM:
  //   <input id="chn-input-placeholder" type="text" style="display:none">  ← hidden
  //   <iframe ...>  ← real input here, inaccessible via frame.evaluate()
  //
  // From live debugging (2026-04-12):
  //   • page.frames() returns 28 frames, all cross-origin (url-error, inputs=-1)
  //   • The placeholder elements have visible=false (display:none / 0 bbox)
  //   • frame.evaluate() fails for all Checkout.com frames
  //   • page is a Stagehand CDP Page (NOT Playwright) — page.mouse is undefined!
  //     Use page.click(x, y) directly (Stagehand Page API) for coordinate clicks.
  //
  // Strategy (in order):
  //   1. Playwright frameLocator() with Checkout.com iframe selectors (CKO IDs)
  //   2. Visible iframe scan: find <iframe> elements with non-zero bounding box,
  //      sort by vertical position, click center → keyboard.type()
  //   3. Placeholder-parent climb: walk up DOM from placeholder until a parent
  //      has a visible bounding box, click its center → keyboard.type()
  //   4. fillCardFieldsInPaymentIframes: existing frame evaluate scan
  //   5. findAndFillExpediaField: inline page.locator() for non-iframe forms
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Strategy 1: Playwright frameLocator() ─────────────────────────────────
  // Checkout.com injects iframes with IDs like "cko-frames-cardnumber",
  // "cko-frames-expirydate", "cko-frames-cardholdername".
  let checkoutComFrameFilled = { name: false, number: false, expiry: false };
  try {
    const ckoFieldMap = [
      {
        key: "name" as const,
        value: profile.card_name ?? "",
        iframeSels: ['iframe[id*="cardholdername" i]', 'iframe[id*="holdername" i]', 'iframe[name*="cardholdername" i]'],
        inputSels: ['input[autocomplete="cc-name"]', 'input[id*="name"]', 'input'],
      },
      {
        key: "number" as const,
        value: profile.card_number ?? "",
        iframeSels: ['iframe[id*="cardnumber" i]', 'iframe[id*="card-number" i]', 'iframe[name*="cardnumber" i]', 'iframe[id*="pan" i]'],
        inputSels: ['input[autocomplete="cc-number"]', 'input[placeholder*="0000"]', 'input[id*="pan"]', 'input'],
      },
      {
        key: "expiry" as const,
        value: profile.card_expiry ?? "",
        iframeSels: ['iframe[id*="expirydate" i]', 'iframe[id*="expiry-date" i]', 'iframe[id*="expiry" i]', 'iframe[name*="expiry" i]'],
        inputSels: ['input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]', 'input'],
      },
    ];

    for (const field of ckoFieldMap) {
      if (!field.value) continue;
      for (const iframeSel of field.iframeSels) {
        try {
          const fl = page.frameLocator(iframeSel);
          for (const inputSel of field.inputSels) {
            const loc = fl.locator(inputSel).first();
            const count = await loc.count().catch(() => 0);
            if (count === 0) continue;
            await loc.click({ clickCount: 3 }).catch(() => {});
            await loc.fill(field.value);
            const actual = await loc.inputValue().catch(() => "");
            if (actual.replace(/\s/g, "").length > 0) {
              checkoutComFrameFilled[field.key] = true;
              trace(`CKO frameLocator: ${field.key} filled via "${iframeSel}" + "${inputSel}"`);
              break;
            }
          }
          if (checkoutComFrameFilled[field.key]) break;
        } catch { /* try next */ }
      }
    }
  } catch (ckoErr) {
    trace(`CKO frameLocator: outer error — ${(ckoErr as Error).message?.slice(0, 60)}`);
  }
  trace(`CKO frameLocator results: name=${checkoutComFrameFilled.name}, number=${checkoutComFrameFilled.number}, expiry=${checkoutComFrameFilled.expiry}`);

  // ── Strategy 2: CKO iframe ID-based click→keyboard ──────────────────────
  // Checkout.com injects iframes with IDs that encode their purpose:
  //   "cko-frames-cardnumber", "cko-frames-expirydate", "cko-frames-cardholdername"
  // We match each unfilled field to its iframe by ID pattern (NOT positional order).
  //
  // IMPORTANT: positional order is WRONG when "Name on card" is an inline field
  // (no CKO iframe). If there are only 2 iframes (card number + expiry) but we
  // assign by position assuming 3 (name, number, expiry), we fill:
  //   cardFields[0]=name → iframe[0]=card_number_iframe  ← wrong field
  //   cardFields[1]=number → iframe[1]=expiry_iframe     ← card number in expiry = "88/88"
  const needsVisibleIframeFill = !checkoutComFrameFilled.number || !checkoutComFrameFilled.expiry;
  if (needsVisibleIframeFill) {
    try {
      // Collect all visible CKO iframes with their IDs and bounding boxes
      const ckoIframes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"))
          .map(el => {
            const r = el.getBoundingClientRect();
            return {
              id: (el.id ?? "").toLowerCase(),
              frameName: (el.name ?? "").toLowerCase(),
              src: (el.src ?? "").toLowerCase(),
              x: r.x, y: r.y, w: r.width, h: r.height,
            };
          })
          .filter(b => {
            if (!(b.w > 0 && b.h > 0 && b.h < 120)) return false;
            const text = `${b.id} ${b.frameName} ${b.src}`;
            return !/\bcvv\b|\bcvc\b|security.?code|verification.?code|card.?security/.test(text);
          }); // card fields are short (<120px tall)
      }).catch(() => [] as Array<{ id: string; frameName: string; src: string; x: number; y: number; w: number; h: number }>);

      trace(`CKO visible iframes: ${ckoIframes.length} short iframes found`);
      for (const b of ckoIframes.slice(0, 6)) {
        trace(`  iframe id="${b.id}" x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} w=${b.w.toFixed(0)} h=${b.h.toFixed(0)}`);
      }

      // Classify each iframe by its ID/name/src into: "number" | "expiry" | "name" | null
      // Hotels.com/Expedia CKO iframe IDs: iframe-pan, iframe-expdate, iframe-chn, iframe-cvv
      const classifyIframe = (id: string, frameName: string, src: string): keyof typeof checkoutComFrameFilled | null => {
        const s = `${id} ${frameName} ${src}`;
        if (/cardnumber|card-number|pan(?!ic|el)/.test(s)) return "number";
        if (/expirydate|expiry-date|expiry(?!less)|expiration|expdate/.test(s)) return "expiry";
        if (/cardholdername|holdername|cardname|card-name|\bchn\b/.test(s)) return "name";
        return null;
      };

      // ID-based fill: match each CKO iframe to the correct field
      // IMPORTANT: Re-fetch each iframe's live rect just before clicking — CKO validation errors
      // (e.g. "Sorry, that card isn't accepted") shift the page layout after card-number is typed,
      // making the pre-captured y-coordinates stale for subsequent fields (especially expiry).
      let matchedAny = false;
      for (const iframe of ckoIframes) {
        const fieldType = classifyIframe(iframe.id, iframe.frameName, iframe.src);
        if (!fieldType) continue;
        if (checkoutComFrameFilled[fieldType]) continue;
        const value = fieldType === "number" ? (profile.card_number ?? "")
                    : fieldType === "expiry" ? (profile.card_expiry ?? "")
                    : (profile.card_name ?? "");
        if (!value) continue;

        // Re-read the live bounding rect of this specific iframe before clicking,
        // in case earlier fills triggered validation messages that shifted the layout.
        const liveRect = await page.evaluate((iframeId: string) => {
          const el = document.getElementById(iframeId) as HTMLIFrameElement | null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }, iframe.id).catch(() => null as null);

        const rect = liveRect ?? iframe;  // fall back to pre-captured if re-fetch fails
        if (liveRect && (Math.abs(liveRect.y - iframe.y) > 5 || Math.abs(liveRect.x - iframe.x) > 5)) {
          trace(`CKO id-based iframe "${iframe.id}": rect shifted — old y=${iframe.y.toFixed(0)}, live y=${liveRect.y.toFixed(0)}`);
        }

        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        try {
          await (page as unknown as { click: (x: number, y: number) => Promise<void> }).click(cx, cy);
          await new Promise(r => setTimeout(r, 300));
          // page.keyboard is undefined on Stagehand v3 — use Stagehand's own keyPress/type API
          await (page as unknown as { keyPress: (k: string) => Promise<void> }).keyPress("Control+a");
          await new Promise(r => setTimeout(r, 100));
          await (page as unknown as { type: (t: string) => Promise<void> }).type(value);
          await new Promise(r => setTimeout(r, 200));
          checkoutComFrameFilled[fieldType] = true;
          matchedAny = true;
          trace(`CKO id-based iframe "${iframe.id}": ${fieldType} filled via page.click(${cx.toFixed(0)},${cy.toFixed(0)}) + keyboard`);
        } catch (err) {
          trace(`CKO id-based iframe "${iframe.id}": ${fieldType} error — ${(err as Error).message?.slice(0, 50)}`);
        }
      }

      // Fallback: if no iframes matched by ID (iframe IDs are non-standard), use positional
      // order but ONLY for the CKO iframes we found, and ONLY for fields not yet filled.
      // Crucially: only include in cardFields fields that we believe ARE in iframes.
      // Use the iframe count as a hint: if there are exactly 2 short iframes, assume
      // they are card number + expiry (name is inline). Never include name in positional
      // fill if we only have 2 iframes and name is still unfilled.
      if (!matchedAny && ckoIframes.length > 0) {
        trace(`CKO positional fallback: ${ckoIframes.length} unmatched iframe(s)`);
        const sortedIframes = [...ckoIframes].sort((a, b) => a.y - b.y);
        // Build fill list: only number and expiry (skip name — it's likely inline)
        const positionalFields: Array<{ value: string; key: keyof typeof checkoutComFrameFilled }> = [];
        if (!checkoutComFrameFilled.number && profile.card_number)
          positionalFields.push({ value: profile.card_number, key: "number" });
        if (!checkoutComFrameFilled.expiry && profile.card_expiry)
          positionalFields.push({ value: profile.card_expiry, key: "expiry" });

        for (let i = 0; i < Math.min(positionalFields.length, sortedIframes.length); i++) {
          const box = sortedIframes[i];
          const field = positionalFields[i];
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          try {
            await (page as unknown as { click: (x: number, y: number) => Promise<void> }).click(cx, cy);
            await new Promise(r => setTimeout(r, 300));
            // page.keyboard is undefined on Stagehand v3 — use Stagehand's own keyPress/type API
            await (page as unknown as { keyPress: (k: string) => Promise<void> }).keyPress("Control+a");
            await new Promise(r => setTimeout(r, 100));
            await (page as unknown as { type: (t: string, o?: { delay?: number }) => Promise<void> }).type(field.value, { delay: 50 });
            await new Promise(r => setTimeout(r, 200));
            checkoutComFrameFilled[field.key] = true;
            trace(`CKO positional iframe[${i}]: ${field.key} filled via page.click(${cx.toFixed(0)},${cy.toFixed(0)}) + keyboard`);
          } catch (err) {
            trace(`CKO positional iframe[${i}]: ${field.key} error — ${(err as Error).message?.slice(0, 50)}`);
          }
        }
      }
    } catch (visErr) {
      trace(`CKO visible iframe scan error: ${(visErr as Error).message?.slice(0, 60)}`);
    }
  }

  // ── Strategy 3: placeholder-parent click → keyboard ───────────────────────
  // Walk up DOM from each hidden placeholder until we find a parent with visible
  // bounding box. Click its center — the overlying CKO iframe should receive the
  // focus and keyboard.type() then types into the iframe.
  const needsParentClimbFill = !checkoutComFrameFilled.number || !checkoutComFrameFilled.expiry;
  if (needsParentClimbFill) {
    const parentCoords = await page.evaluate(() => {
      const walk = (startId: string): { x: number; y: number } | null => {
        let el: HTMLElement | null = document.getElementById(startId);
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 120) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
          el = el.parentElement;
        }
        return null;
      };
      return {
        name: walk("chn-input-placeholder"),
        number: walk("pan-input-placeholder"),
        expiry: walk("expiry-input-placeholder"),
      };
    }).catch(() => ({ name: null, number: null, expiry: null }));

    trace(`CKO parent-climb coords: name=${JSON.stringify(parentCoords.name)}, number=${JSON.stringify(parentCoords.number)}, expiry=${JSON.stringify(parentCoords.expiry)}`);

    const parentFillPairs: Array<[typeof parentCoords.name, string, keyof typeof checkoutComFrameFilled]> = [
      [parentCoords.name, profile.card_name ?? "", "name"],
      [parentCoords.number, profile.card_number ?? "", "number"],
      [parentCoords.expiry, profile.card_expiry ?? "", "expiry"],
    ];
    for (const [coord, value, key] of parentFillPairs) {
      if (checkoutComFrameFilled[key] || !coord || !value) continue;
      try {
        await (page as unknown as { click: (x: number, y: number) => Promise<void> }).click(coord.x, coord.y);
        await new Promise(r => setTimeout(r, 300));
        // page.keyboard is undefined on Stagehand v3 — use Stagehand's own keyPress/type API
        await (page as unknown as { keyPress: (k: string) => Promise<void> }).keyPress("Control+a");
        await new Promise(r => setTimeout(r, 100));
        await (page as unknown as { type: (t: string, o?: { delay?: number }) => Promise<void> }).type(value, { delay: 50 });
        await new Promise(r => setTimeout(r, 200));
        checkoutComFrameFilled[key] = true;
        trace(`CKO parent-climb: ${key} filled via page.click(${coord.x.toFixed(0)},${coord.y.toFixed(0)}) + keyboard`);
      } catch (err) {
        trace(`CKO parent-climb: ${key} error — ${(err as Error).message?.slice(0, 50)}`);
      }
    }
  }

  // Only run the heavy iframe scan + inline fallback if CKO strategies didn't fill everything
  const skipIframeScanning = checkoutComFrameFilled.name && checkoutComFrameFilled.number && checkoutComFrameFilled.expiry;

  // Wait for payment widget iframes to load (Checkout.com iframes appear with the page).
  // If already loaded (>15 frames present), skip polling. Otherwise poll up to 2s.
  const iframesBefore = page.frames().length;
  if (!skipIframeScanning) {
    trace(`Expedia card: checking payment widget iframes (currently ${iframesBefore} frame(s))...`);
    if (iframesBefore < 15) {
      // Payment widget not yet loaded — poll briefly
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 500));
        const now = page.frames().length;
        if (now > iframesBefore) {
          trace(`Expedia card: new iframe(s) detected (${iframesBefore} → ${now}) — settling 800ms`);
          await new Promise(r => setTimeout(r, 800));
          break;
        }
      }
    } else {
      trace("Expedia card: payment widget already loaded — proceeding immediately");
    }
  }

  // Dismiss modal one final time right before card fill — it may have reappeared
  // after protection-plan selection or "Card" tab click.
  await dismissExpediaAlmostYoursModal(page, trace, 300);

  // Merge CKO results with iframe scan result (pass empty strings for already-filled fields)
  let iframeFilledFields = checkoutComFrameFilled;
  if (!skipIframeScanning) {
    const iframeResult = await fillCardFieldsInPaymentIframes(
      page,
      checkoutComFrameFilled.name ? "" : (profile.card_name ?? ""),
      checkoutComFrameFilled.number ? "" : (profile.card_number ?? ""),
      checkoutComFrameFilled.expiry ? "" : (profile.card_expiry ?? ""),
      trace
    );
    // Merge: a field is filled if either CKO or iframe scan succeeded
    iframeFilledFields = {
      name: checkoutComFrameFilled.name || iframeResult.name,
      number: checkoutComFrameFilled.number || iframeResult.number,
      expiry: checkoutComFrameFilled.expiry || iframeResult.expiry,
    };
  }

  // For each field NOT filled by the iframe strategy, attempt inline fill.
  // If the field is in an iframe, page.locator() returns count=0 → no-op (safe).
  // If the field is inline (Hotels.com or non-Checkout.com forms), this fills it.
  if (!iframeFilledFields.name && profile.card_name) {
    trace("Expedia payment: card name not filled via iframe — trying inline selector");
    await findAndFillExpediaField(page,
      ["Name on card", "Cardholder name", "Card holder name"],
      EXPEDIA_GROUP_CARD_NAME_SELECTORS, profile.card_name, "cardholder name", trace);
  }

  // ── Inline card number + expiry: use page.evaluate() with strict placeholder selectors ──
  // Why: findAndFillExpediaField() can fill the WRONG field — e.g. the expiry field gets
  // the card number value ("8888888888888888" → masked as "88/88") because CSS selectors
  // are too broad. Using placeholder="0000 0000 0000 0000" and placeholder="MM/YY" is
  // unambiguous: each placeholder is unique to exactly one field in the form.
  // This runs BEFORE the locator fallback; the locator fallback runs only if this fails.
  const nativeFillInline = async (sel: string, val: string, fieldLabel: string): Promise<boolean> => {
    const ok = await page.evaluate(({ selector, value }: { selector: string; value: string }) => {
      const el = document.querySelector<HTMLInputElement>(selector);
      if (!el || el.disabled || el.offsetParent === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      el.focus();
      if (setter) { setter.call(el, ""); setter.call(el, value); }
      else { el.value = ""; el.value = value; }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    }, { selector: sel, value: val }).catch(() => false);
    if (ok) trace(`Expedia payment: filled ${fieldLabel} via page.evaluate placeholder selector`);
    return ok;
  };

  if (!iframeFilledFields.number && profile.card_number) {
    trace("Expedia payment: card number not filled via iframe — trying inline selector");
    // First: precise placeholder-based evaluate fill (Hotels.com inline form)
    const numOk = await nativeFillInline('input[placeholder="0000 0000 0000 0000"]', profile.card_number, "card number");
    if (!numOk) {
      // Fallback: locator-based fill (Expedia or other forms)
      await findAndFillExpediaField(page,
        ["Card number", "Credit card number"],
        EXPEDIA_GROUP_CARD_NUMBER_SELECTORS, profile.card_number, "card number", trace, true);
    }
  }
  if (!iframeFilledFields.expiry && profile.card_expiry) {
    const splitExpiryOk = await fillExpediaSplitCardExpiry(page, profile.card_expiry, trace);
    if (splitExpiryOk) iframeFilledFields.expiry = true;
  }
  if (!iframeFilledFields.expiry && profile.card_expiry) {
    trace("Expedia payment: card expiry not filled via iframe — trying inline selector");
    // First: precise placeholder-based evaluate fill (Hotels.com inline form)
    const expOk = await nativeFillInline('input[placeholder="MM/YY"]', profile.card_expiry, "expiry date");
    if (!expOk) {
      // Fallback: locator-based fill
      await findAndFillExpediaField(page,
        ["Expiration date", "Expiry date", "Expiry"],
        EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS, profile.card_expiry, "expiry date", trace);
    }
  }

  // "This booking is almost yours!" modal appears AFTER card fields are filled.
  // Dismiss it now before attempting billing ZIP fill.
  await dismissExpediaAlmostYoursModal(page, trace, 400);

  await fillExpediaBillingAddressFields(page, profile, trace);

  // Fill billing ZIP code via page.evaluate + native setter.
  // Uses the same technique as guest form filling (which we know works on Stagehand proxy).
  // locator.evaluate() is not available on Stagehand proxy, so we must use page.evaluate()
  // with document.querySelector to trigger React's state update.
  const billingZip = profile.billing_zip ?? profile.zip;
  if (billingZip) {
    const zipFilled = await page.evaluate(({ zip, selectors }: { zip: string; selectors: string[] }) => {
      const nativeFill = (el: HTMLInputElement, v: string): boolean => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        el.focus();
        if (setter) { setter.call(el, ""); setter.call(el, v); }
        else { el.value = ""; el.value = v; }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
        return el.value === v;
      };
      // Try each selector
      for (const sel of selectors) {
        const el = document.querySelector<HTMLInputElement>(sel);
        if (el && el.offsetParent !== null && !el.disabled) {
          return nativeFill(el, zip);
        }
      }
      // Fallback: find by label text
      const labels = Array.from(document.querySelectorAll<HTMLLabelElement>("label"));
      for (const lbl of labels) {
        const text = lbl.textContent?.toLowerCase() ?? "";
        if (!text.includes("zip") && !text.includes("postal")) continue;
        const forId = lbl.getAttribute("for");
        const input = forId ? document.getElementById(forId) as HTMLInputElement :
          lbl.querySelector("input") as HTMLInputElement;
        if (input && input.offsetParent !== null) return nativeFill(input, zip);
      }
      return false;
    }, { zip: billingZip, selectors: EXPEDIA_BILLING_ZIP_SELECTORS }).catch(() => false);

    if (zipFilled) {
      trace(`Expedia payment: filled billing ZIP via page.evaluate (length=${billingZip.length})`);
    } else {
      trace("Expedia payment: billing ZIP page.evaluate failed — trying locator fallback");
      await findAndFillExpediaField(page,
        ["Billing ZIP code", "ZIP code", "Postal code"],
        EXPEDIA_BILLING_ZIP_SELECTORS, billingZip, "billing ZIP", trace, true);
    }
  } else {
    trace("Expedia payment: no billing ZIP in profile — skipping");
  }

  // Verification pass
  const verifyField = async (selectors: string[], fieldName: string): Promise<boolean> => {
    for (const sel of selectors) {
      const val = await page.evaluate((s) => {
        const el = document.querySelector<HTMLInputElement>(s);
        return el ? el.value : null;
      }, sel).catch(() => null);
      if (val !== null) {
        trace(`Expedia payment verify: ${fieldName} = "${val.length > 0 ? "[filled]" : "[empty]"}"`);
        return val.length > 0;
      }
    }
    // Also check iframes (including cross-origin payment processor frames)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const rawUrl: unknown = frame.url;
      const frameUrl = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
      if (!frameUrl || frameUrl === "about:blank") continue;
      for (const sel of selectors) {
        const val = await frame.evaluate((s) => {
          const el = document.querySelector<HTMLInputElement>(s);
          return el ? el.value : null;
        }, sel).catch(() => null);
        if (val !== null) {
          trace(`Expedia payment verify (iframe ${frameUrl.slice(0, 40)}): ${fieldName} = "${val.length > 0 ? "[filled]" : "[empty]"}"`);
          return val.length > 0;
        }
      }
    }
    trace(`Expedia payment verify: ${fieldName} field not found`);
    return false;
  };

  const nameOk = profile.card_name ? await verifyField(EXPEDIA_GROUP_CARD_NAME_SELECTORS, "cardholder name") : true;
  const numberOk = profile.card_number ? await verifyField(EXPEDIA_GROUP_CARD_NUMBER_SELECTORS, "card number") : true;
  const expiryOk = profile.card_expiry ? await verifyField(EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS, "expiry") : true;
  trace(`Expedia payment verification: name=${nameOk}, cardNumber=${numberOk}, expiry=${expiryOk}`);
}

// ── Programmatic Expedia flight booking ────────────────────────────────────────
// Fully replaces the AI agent for Expedia flight booking.
// Flow: find flight → select fare popup → dismiss bundle popup → skip to checkout → fill info

export interface FlightBookingProfile extends ExpediaGuestProfile {
  date_of_birth?: string;
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  known_traveler_number?: string;
  nationality?: string;
}

type ExpediaBundleDismissAttempt = {
  found: boolean;
  source: string;
  reason: string;
  text: string;
};

async function isExpediaFlightBundlePopupVisible(page: Page): Promise<boolean> {
  const pageLike = page as unknown as {
    getByText?: (text: string | RegExp, options?: { exact?: boolean }) => unknown;
    evaluate?: <T>(fn: () => T | Promise<T>) => Promise<T>;
  };

  const visibleByText = async (text: string | RegExp, exact = false): Promise<boolean> => {
    try {
      const locator = pageLike.getByText?.(text, { exact }) as {
        first?: () => unknown;
        isVisible?: (options?: { timeout?: number }) => Promise<boolean>;
      } | undefined;
      const target = (locator?.first?.() ?? locator) as {
        isVisible?: (options?: { timeout?: number }) => Promise<boolean>;
      } | undefined;
      if (target?.isVisible) return await target.isVisible({ timeout: 600 });
    } catch {
      // Fall through to DOM text scan.
    }
    return false;
  };

  if (
    await visibleByText("Car rental dates", true) ||
    await visibleByText("Explore packages", true) ||
    await visibleByText(/bundle\s*&\s*save/i)
  ) {
    return true;
  }

  if (!pageLike.evaluate) return false;
  return await pageLike.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height > 100;
      });
    return dialogs.some(el => {
      const text = (el.textContent ?? "").toLowerCase();
      return text.includes("car rental dates") ||
        text.includes("explore packages") ||
        (text.includes("bundle & save") && text.includes("includes your selected flight"));
    });
  }).catch(() => false);
}

async function dismissExpediaFlightBundlePopupWithLocator(page: Page): Promise<ExpediaBundleDismissAttempt> {
  const pageLike = page as unknown as {
    getByText?: (text: string | RegExp, options?: { exact?: boolean }) => unknown;
    locator?: (selector: string) => unknown;
    keyboard?: { press?: (key: string) => Promise<unknown> };
  };

  const clickLocator = async (rawLocator: unknown, source: string): Promise<ExpediaBundleDismissAttempt | null> => {
    if (!rawLocator) return null;
    const locator = rawLocator as {
      first?: () => unknown;
      last?: () => unknown;
      click?: (options?: { timeout?: number; force?: boolean }) => Promise<unknown>;
      textContent?: (options?: { timeout?: number }) => Promise<string | null>;
    };
    const target = (locator.last?.() ?? locator.first?.() ?? locator) as {
      click?: (options?: { timeout?: number; force?: boolean }) => Promise<unknown>;
      textContent?: (options?: { timeout?: number }) => Promise<string | null>;
    };
    if (!target.click) return null;
    const text = await target.textContent?.({ timeout: 500 }).catch(() => "") ?? "";
    try {
      await target.click({ timeout: 2500 });
      return { found: true, source, reason: "locator-clicked", text: text.trim().slice(0, 40) };
    } catch {
      try {
        await target.click({ timeout: 2500, force: true });
        return { found: true, source, reason: "locator-force-clicked", text: text.trim().slice(0, 40) };
      } catch {
        return null;
      }
    }
  };

  const textClicked = await clickLocator(
    pageLike.getByText?.(/^\s*No,?\s+thanks\s*$/i, { exact: true }),
    "getByText:no-thanks",
  );
  if (textClicked) return textClicked;

  const controls = pageLike.locator?.('button, a, [role="button"]') as {
    filter?: (options: { hasText: RegExp }) => unknown;
  } | undefined;
  const filteredClicked = await clickLocator(
    controls?.filter?.({ hasText: /^\s*No,?\s+thanks\s*$/i }),
    "locator-filter:no-thanks",
  );
  if (filteredClicked) return filteredClicked;

  const closeClicked = await clickLocator(
    pageLike.locator?.('#forced-choice-modal-dismiss-btn, button[aria-label*="close" i], button[title*="close" i], button[data-testid*="close" i]'),
    "locator:close",
  );
  if (closeClicked) return closeClicked;

  try {
    await pageLike.keyboard?.press?.("Escape");
    return { found: true, source: "keyboard", reason: "escape-pressed", text: "" };
  } catch {
    return { found: false, source: "none", reason: "no-locator-dismiss-control", text: "" };
  }
}

type ExpediaReviewCheckoutActionResult = {
  clicked: boolean;
  source: string;
  text: string;
  visibleButtons: string[];
  error?: string;
};

async function clickExpediaFlightReviewCheckoutAction(page: Page): Promise<ExpediaReviewCheckoutActionResult> {
  const domResult: ExpediaReviewCheckoutActionResult = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'));
    const visible = allButtons
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    const visibleButtons = visible
      .map(el => {
        const r = el.getBoundingClientRect();
        return `"${(el.textContent ?? "").trim().slice(0, 40)}"@(${Math.round(r.x)},${Math.round(r.y)})`;
      })
      .filter(text => !text.startsWith('""'))
      .slice(0, 60);
    const target = visible.find(el => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === "next: checkout" ||
        text.includes("next: checkout") ||
        text.includes("skip to checkout") ||
        aria.includes("next: checkout") ||
        aria.includes("skip to checkout");
    });
    if (!target) {
      return { clicked: false, source: "dom", text: "", visibleButtons };
    }
    target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
    const label = ((target.textContent ?? "").trim() || target.getAttribute("aria-label") || "").slice(0, 60);
    target.click();
    return { clicked: true, source: "dom", text: label, visibleButtons };
  }).catch((err: Error) => ({
    clicked: false,
    source: "dom-error",
    text: "",
    visibleButtons: [] as string[],
    error: err.message?.slice(0, 100),
  }));

  if (domResult.clicked) return domResult;

  const pageLike = page as unknown as {
    getByRole?: (role: "button" | "link", options: { name: RegExp }) => unknown;
    getByText?: (text: string | RegExp, options?: { exact?: boolean }) => unknown;
    locator?: (selector: string) => unknown;
  };

  const clickLocator = async (rawLocator: unknown, source: string): Promise<ExpediaReviewCheckoutActionResult | null> => {
    if (!rawLocator) return null;
    const locator = rawLocator as {
      first?: () => unknown;
      click?: (options?: { timeout?: number; force?: boolean }) => Promise<unknown>;
      textContent?: (options?: { timeout?: number }) => Promise<string | null>;
    };
    const target = (locator.first?.() ?? locator) as {
      click?: (options?: { timeout?: number; force?: boolean }) => Promise<unknown>;
      textContent?: (options?: { timeout?: number }) => Promise<string | null>;
    };
    if (!target.click) return null;
    const text = await target.textContent?.({ timeout: 500 }).catch(() => "") ?? "";
    try {
      await target.click({ timeout: 3000 });
      return { clicked: true, source, text: text.trim().slice(0, 60), visibleButtons: domResult.visibleButtons, error: domResult.error };
    } catch {
      try {
        await target.click({ timeout: 3000, force: true });
        return { clicked: true, source: `${source}:force`, text: text.trim().slice(0, 60), visibleButtons: domResult.visibleButtons, error: domResult.error };
      } catch {
        return null;
      }
    }
  };

  const roleButton = await clickLocator(pageLike.getByRole?.("button", { name: /(?:next:\s*checkout|skip\s+to\s+checkout)/i }), "role:button");
  if (roleButton) return roleButton;
  const roleLink = await clickLocator(pageLike.getByRole?.("link", { name: /(?:next:\s*checkout|skip\s+to\s+checkout)/i }), "role:link");
  if (roleLink) return roleLink;
  const textLocator = await clickLocator(pageLike.getByText?.(/(?:next:\s*checkout|skip\s+to\s+checkout)/i), "text");
  if (textLocator) return textLocator;

  return domResult;
}

async function dismissExpediaFlightSoftOverlays(
  page: Page,
  trace: (msg: string) => void,
  waitMs = 0,
): Promise<void> {
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

  const result = await page.evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (el: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hardBoundary = (text: string): boolean =>
      /\b(sign in to continue|log in to continue|login to continue|sign in or create an account to continue|authentication required|verification code|one-time passcode|one time passcode|captcha|robot check|unusual traffic|otp)\b/i.test(text);
    const softOverlay = (text: string): boolean =>
      text.includes("member prices") ||
      text.includes("one key") ||
      text.includes("onekeycash") ||
      text.includes("unlock instant savings") ||
      text.includes("sign in and book a flight") ||
      (/\bsign[-_\s]?in\b/.test(text) &&
        (text.includes("member") || text.includes("savings") || text.includes("one key") || text.includes("onekeycash") || text.includes("learn more")));
    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"], dialog, [class*="popover"], [class*="overlay"], [class*="uitk-menu"], [data-stid*="popover"], [data-testid*="popover"]'
    )).filter(isVisible);
    for (const container of containers) {
      const text = normalize(container.textContent);
      if (!text || !softOverlay(text)) continue;
      if (hardBoundary(text)) {
        return { status: "hard_boundary", text: text.slice(0, 120), button: "" };
      }
      const controls = Array.from(container.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
        .filter(isVisible);
      const dismiss = controls.find(control => {
        const label = normalize(
          `${control.textContent ?? ""} ${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.getAttribute("id") ?? ""}`
        );
        if (!label) return false;
        if (/\bsign[-_\s]?in\b/.test(label)) return false;
        return (
          label === "x" ||
          label.includes("close") ||
          label.includes("dismiss") ||
          label.includes("no thanks") ||
          label.includes("not now") ||
          label.includes("skip")
        );
      });
      if (dismiss) {
        dismiss.click();
        const label = normalize(dismiss.textContent || dismiss.getAttribute("aria-label") || dismiss.getAttribute("title") || dismiss.getAttribute("id"));
        return { status: "dismissed", text: text.slice(0, 120), button: label.slice(0, 60) };
      }
      return { status: "soft_overlay_no_button", text: text.slice(0, 120), button: "" };
    }
    return { status: "none", text: "", button: "" };
  }).catch((error: Error) => ({
    status: "error",
    text: error.message?.slice(0, 120) ?? "unknown overlay scan error",
    button: "",
  }));

  if (result.status === "dismissed") {
    trace(`[flight-rpa] Dismissed soft Expedia flight overlay before card scan: button="${result.button}" text="${result.text}"`);
    await new Promise(r => setTimeout(r, 600));
    return;
  }
  if (result.status === "soft_overlay_no_button") {
    trace(`[flight-rpa] Soft Expedia flight overlay had no safe dismiss button; pressing Escape. text="${result.text}"`);
    await page.keyboard.press("Escape").catch(() => undefined);
    await new Promise(r => setTimeout(r, 600));
    return;
  }
  if (result.status === "hard_boundary") {
    trace(`[flight-rpa] Expedia overlay looks like a hard safety boundary; leaving it for boundary detection. text="${result.text}"`);
  } else if (result.status === "error") {
    trace(`[flight-rpa] Expedia soft overlay scan failed: ${result.text}`);
  }
}

async function findExpediaFlightButtonWithLocatorFallback(
  page: Page,
  target: ExpediaFlightTarget,
  trace: (msg: string) => void,
): Promise<ExpediaFlightButtonMatch> {
  const { selection, locator } = await collectExpediaFlightLocatorCandidates(page, target);
  const best = selection.best;
  if (!best) {
    return {
      found: false,
      label: "",
      candidates: selection.candidateCount,
      x: 0,
      y: 0,
      inViewportBefore: false,
      samples: selection.samples,
      candidateSummaries: selection.candidateSummaries,
    };
  }

  const targetButton = locator.nth(best.index);
  const beforeBox = await readExpediaFlightLocatorBoundingBox(targetButton);
  await scrollExpediaFlightLocatorIntoView(targetButton);
  await new Promise(r => setTimeout(r, 200));
  const afterBox = await readExpediaFlightLocatorBoundingBox(targetButton);
  if (!afterBox) {
    trace("[flight-rpa] Locator fallback found a text match but could not read its bounding box; will click by locator");
    return {
      found: true,
      label: best.label,
      candidates: selection.candidateCount,
      x: 0,
      y: 0,
      inViewportBefore: false,
      clickMode: "locator",
      matchMode: selection.matchMode,
      matchReason: `${selection.matchReason ?? "locator fallback match"}; bounding box unavailable`,
      samples: selection.samples,
      candidateSummaries: selection.candidateSummaries,
    };
  }

  return {
    found: true,
    label: best.label,
    candidates: selection.candidateCount,
    x: afterBox.x + afterBox.width / 2,
    y: afterBox.y + afterBox.height / 2,
    inViewportBefore: !!beforeBox && beforeBox.y >= 0 && beforeBox.y + beforeBox.height <= 900,
    clickMode: "coordinate",
    matchMode: selection.matchMode,
    matchReason: selection.matchReason,
    samples: selection.samples,
    candidateSummaries: selection.candidateSummaries,
  };
}

async function clickExpediaFlightButtonWithLocatorFallback(
  page: Page,
  target: ExpediaFlightTarget,
): Promise<{
  clicked: boolean;
  label: string;
  candidates: number;
  matchMode?: string;
  matchReason?: string;
  samples: string[];
  candidateSummaries: string[];
  error?: string;
}> {
  const { selection, locator } = await collectExpediaFlightLocatorCandidates(page, target);
  const best = selection.best;
  if (!best) {
    return {
      clicked: false,
      label: "",
      candidates: selection.candidateCount,
      samples: selection.samples,
      candidateSummaries: selection.candidateSummaries,
    };
  }

  try {
    const targetButton = locator.nth(best.index);
    await scrollExpediaFlightLocatorIntoView(targetButton);
    await new Promise(r => setTimeout(r, 200));
    await targetButton.click({ delay: 120, timeout: 5000 });
    return {
      clicked: true,
      label: best.label,
      candidates: selection.candidateCount,
      matchMode: selection.matchMode,
      matchReason: selection.matchReason,
      samples: selection.samples,
      candidateSummaries: selection.candidateSummaries,
    };
  } catch (error) {
    return {
      clicked: false,
      label: best.label,
      candidates: selection.candidateCount,
      matchMode: selection.matchMode,
      matchReason: selection.matchReason,
      samples: selection.samples,
      candidateSummaries: selection.candidateSummaries,
      error: (error as Error).message?.slice(0, 120) ?? "unknown locator click error",
    };
  }
}

async function collectExpediaFlightLocatorCandidates(
  page: Page,
  target: ExpediaFlightTarget,
): Promise<{
  locator: ReturnType<Page["locator"]>;
  selection: ExpediaFlightCandidateSelection;
}> {
  const locator = page.locator('button, [role="button"]');
  const count = await locator.count().catch(() => 0);
  const candidates: ExpediaFlightLocatorCandidate[] = [];
  const samples: string[] = [];

  for (let index = 0; index < Math.min(count, 250); index++) {
    const item = locator.nth(index);
    const visible = await item.isVisible().catch(() => false);
    if (!visible) continue;
    const label = await readExpediaFlightLocatorCandidateLabel(item);
    if (!label.toLowerCase().includes("select")) continue;
    if (samples.length < 6) samples.push(label.slice(0, 140));
    const score = scoreExpediaFlightCandidateText(label, target);
    if (score.hasAirline || score.exactMatch || score.fallbackEligible) {
      const clippedLabel = label.slice(0, 140);
      candidates.push({
        index,
        label: clippedLabel,
        score,
        summary: formatExpediaFlightCandidateEvidence(clippedLabel, target),
      });
    }
  }

  return { locator, selection: selectExpediaFlightCandidate(candidates, samples, target, "locator fallback") };
}

function selectExpediaFlightCandidate(
  candidates: ExpediaFlightLocatorCandidate[],
  samples: string[],
  target: ExpediaFlightTarget,
  prefix: string,
): ExpediaFlightCandidateSelection {
  const airlineCandidates = candidates.filter(candidate => candidate.score.hasAirline);
  const strictCandidates = airlineCandidates
    .filter(candidate => candidate.score.exactMatch)
    .sort((a, b) => sortExpediaFlightCandidatesByFit(target, a.score, b.score, "strict"));
  const sameAirlineFallbackCandidates = airlineCandidates
    .filter(candidate => !candidate.score.exactMatch && candidate.score.fallbackEligible)
    .sort((a, b) => sortExpediaFlightCandidatesByFit(target, a.score, b.score, "fallback"));
  const crossAirlineFallbackCandidates = candidates
    .filter(candidate =>
      !candidate.score.hasAirline &&
      !candidate.score.exactMatch &&
      candidate.score.fallbackEligible
    )
    .sort((a, b) => sortExpediaFlightCandidatesByFit(target, a.score, b.score, "fallback"));

  const orderedCandidates = [
    ...strictCandidates,
    ...sameAirlineFallbackCandidates,
    ...crossAirlineFallbackCandidates,
  ];
  const best = orderedCandidates[0] ?? null;
  if (!best) {
    return {
      best: null,
      candidateCount: candidates.length,
      samples,
      candidateSummaries: candidates.length > 0
        ? candidates.slice(0, 4).map(candidate => candidate.summary)
        : samples.slice(0, 4).map(sample => formatExpediaFlightCandidateEvidence(sample, target)),
    };
  }

  return {
    best,
    candidateCount: candidates.length,
    matchMode: strictCandidates[0]
      ? prefix.replace(/\s+/g, "_")
      : sameAirlineFallbackCandidates[0]
        ? "fallback"
        : "cross_airline_fallback",
    matchReason: strictCandidates[0]
      ? `${prefix} exact target fit`
      : sameAirlineFallbackCandidates[0]
        ? `${prefix} same airline timeDelta=${best.score.timeDelta ?? "?"} priceDelta=${best.score.priceDelta ?? "?"}`
        : `${prefix} cross-airline timeDelta=${best.score.timeDelta ?? "?"} priceDelta=${best.score.priceDelta ?? "?"}`,
    samples: orderedCandidates.slice(0, 4).map(candidate => candidate.label),
    candidateSummaries: orderedCandidates.slice(0, 4).map(candidate => candidate.summary),
  };
}

async function clickExpediaFlightButtonWithDomRescan(
  page: Page,
  target: ExpediaFlightTarget,
): Promise<{
  clicked: boolean;
  label: string;
  candidates: number;
  matchMode?: string;
  matchReason?: string;
  samples: string[];
  candidateSummaries: string[];
  error?: string;
}> {
  const result = await page.evaluate(({ airline, price, time, flightNumber }: ExpediaFlightTarget) => {
    const parseTimeToMinutes = (t: string | null | undefined): number | null => {
      if (!t) return null;
      const raw = t.trim().toLowerCase();
      const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (!match) return null;
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const suffix = match[3]?.toLowerCase() ?? null;
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
      if (!suffix && hour === 24) hour = 0;
      return hour * 60 + minute;
    };
    const normalizeLoose = (s: string | null | undefined): string =>
      (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizeTight = (s: string | null | undefined): string =>
      (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const extractPrices = (text: string): number[] =>
      Array.from(text.matchAll(/\$([\d,]+)/g))
        .map(match => Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10))
        .filter(value => Number.isFinite(value));
    const timeMinutes = parseTimeToMinutes(time);
    const airlineLoose = normalizeLoose(airline);
    const airlineWord = airlineLoose.split(" ")[0] ?? "";
    const flightNumberTight = normalizeTight(flightNumber);
    const flightDigits = (flightNumber ?? "").replace(/\D/g, "");
    const priceToken = typeof price === "number" ? `$${price}` : "";

    const selectableCandidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .map(btn => {
        const label = normalizeLoose((btn.getAttribute("aria-label") ?? "") + " " + (btn.textContent ?? ""));
        if (!label.includes("select")) return null;
        const container = btn.closest('li, article, section, [data-test-id], [data-stid], [class*="uitk-card"], [class*="offer-card"], [class*="result"]');
        const context = normalizeLoose(container?.textContent ?? btn.parentElement?.textContent ?? "");
        const combined = `${label} ${context}`.trim();
        const combinedTight = normalizeTight(combined);
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const hasAirline = !airlineWord || combined.includes(airlineWord) || combined.includes(airlineLoose);
        const visiblePrices = extractPrices(combined);
        const priceDelta =
          typeof price === "number" && visiblePrices.length > 0
            ? Math.min(...visiblePrices.map(value => Math.abs(value - price)))
            : null;
        const hasPrice = !priceToken || combined.includes(priceToken) || priceDelta === 0;
        const hasFlightNumber =
          !flightNumberTight ||
          combinedTight.includes(flightNumberTight) ||
          (flightDigits.length >= 3 && combinedTight.includes(flightDigits));
        const departureMatch =
          combined.match(/departing at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ??
          combined.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i);
        const departureMinutes = parseTimeToMinutes(departureMatch?.[1] ?? null);
        const timeDelta =
          timeMinutes !== null && departureMinutes !== null
            ? Math.abs(departureMinutes - timeMinutes)
            : null;
        const timeScore =
          timeMinutes !== null
            ? departureMinutes === timeMinutes
              ? 4
              : departureMinutes !== null && Math.abs(departureMinutes - timeMinutes) <= 5
                ? 2
                : 0
            : 1;
        const score =
          (hasFlightNumber ? 5 : 0) +
          timeScore * 2 +
          (hasPrice ? 1 : 0);
        const hasExactTargetTime = timeMinutes !== null && departureMinutes === timeMinutes;
        const hasNearTargetTime = timeDelta !== null && timeDelta <= 120;
        const hasStrongTargetIdentity = hasFlightNumber || hasExactTargetTime;
        const exactMatch =
          (!flightNumberTight || hasFlightNumber) &&
          (timeMinutes === null || timeScore > 0) &&
          (hasStrongTargetIdentity || !priceToken || hasPrice);
        const hasPriceFallbackWithoutTargetTime =
          timeMinutes === null && (hasPrice || (priceDelta !== null && priceDelta <= 60));
        const fallbackEligible =
          hasFlightNumber ||
          hasNearTargetTime ||
          hasPriceFallbackWithoutTargetTime;
        const fallbackScore =
          (hasFlightNumber ? 120 : 0) +
          (hasExactTargetTime ? 100 : 0) +
          (timeDelta !== null ? Math.max(0, 60 - Math.floor(timeDelta / 2)) : 0) +
          (priceDelta !== null ? Math.max(0, 10 - Math.floor(priceDelta / 20)) : 0);
        return {
          btn,
          label: combined.slice(0, 140),
          hasAirline,
          exactMatch,
          fallbackEligible,
          hasFlightNumber,
          hasPrice,
          score,
          fallbackScore,
          departureMinutes: departureMinutes ?? -1,
          timeDelta,
          priceDelta,
        };
      })
      .filter(Boolean) as Array<{
        btn: HTMLElement;
        label: string;
        hasAirline: boolean;
        exactMatch: boolean;
        fallbackEligible: boolean;
        hasFlightNumber: boolean;
        hasPrice: boolean;
        score: number;
        fallbackScore: number;
        departureMinutes: number;
        timeDelta: number | null;
        priceDelta: number | null;
      }>;

    const sortByTargetFit = (
      a: { score: number; fallbackScore: number; departureMinutes: number; priceDelta: number | null },
      b: { score: number; fallbackScore: number; departureMinutes: number; priceDelta: number | null },
      mode: "strict" | "fallback",
    ) => {
      if (mode === "strict" && b.score !== a.score) return b.score - a.score;
      if (mode === "fallback" && b.fallbackScore !== a.fallbackScore) return b.fallbackScore - a.fallbackScore;
      if (timeMinutes !== null) {
        const aDelta = a.departureMinutes >= 0 ? Math.abs(a.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
        const bDelta = b.departureMinutes >= 0 ? Math.abs(b.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
        if (aDelta !== bDelta) return aDelta - bDelta;
      }
      const aPriceDelta = a.priceDelta ?? Number.POSITIVE_INFINITY;
      const bPriceDelta = b.priceDelta ?? Number.POSITIVE_INFINITY;
      if (aPriceDelta !== bPriceDelta) return aPriceDelta - bPriceDelta;
      return 0;
    };

    const airlineCandidates = selectableCandidates.filter(candidate => candidate.hasAirline);
    const strictCandidates = airlineCandidates
      .filter(candidate => candidate.exactMatch)
      .sort((a, b) => sortByTargetFit(a, b, "strict"));
    const sameAirlineFallbackCandidates = airlineCandidates
      .filter(candidate => !candidate.exactMatch && candidate.fallbackEligible)
      .sort((a, b) => sortByTargetFit(a, b, "fallback"));
    const crossAirlineFallbackCandidates = selectableCandidates
      .filter(candidate =>
        !candidate.hasAirline &&
        !candidate.exactMatch &&
        candidate.fallbackEligible
      )
      .sort((a, b) => sortByTargetFit(a, b, "fallback"));

    const best = strictCandidates[0] ?? sameAirlineFallbackCandidates[0] ?? crossAirlineFallbackCandidates[0];
    const samples = [...strictCandidates, ...sameAirlineFallbackCandidates, ...crossAirlineFallbackCandidates]
      .slice(0, 4)
      .map(candidate => candidate.label);
    if (!best) {
      return {
        clicked: false,
        label: "",
        candidates: 0,
        samples: selectableCandidates.slice(0, 6).map(candidate => candidate.label),
      };
    }

    best.btn.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
    best.btn.click();
    return {
      clicked: true,
      label: best.label,
      candidates: strictCandidates.length + sameAirlineFallbackCandidates.length + crossAirlineFallbackCandidates.length,
      matchMode: strictCandidates[0]
        ? "dom_rescan"
        : sameAirlineFallbackCandidates[0]
          ? "dom_rescan_fallback"
          : "dom_rescan_cross_airline_fallback",
      matchReason: strictCandidates[0]
        ? "DOM rescan exact target fit"
        : sameAirlineFallbackCandidates[0]
          ? `DOM rescan same airline timeDelta=${best.timeDelta ?? "?"} priceDelta=${best.priceDelta ?? "?"}`
          : `DOM rescan cross-airline timeDelta=${best.timeDelta ?? "?"} priceDelta=${best.priceDelta ?? "?"}`,
      samples,
    };
  }, target).catch((error: Error) => ({
    clicked: false,
    label: "",
    candidates: 0,
    samples: [] as string[],
    error: error.message?.slice(0, 120) ?? "unknown DOM rescan click error",
  }));

  return {
    ...result,
    candidateSummaries: (result.samples ?? []).map(sample =>
      formatExpediaFlightCandidateEvidence(sample, target)
    ),
  };
}

export async function bookExpediaFlightProgrammatic(
  page: Page,
  profile: FlightBookingProfile,
  targetAirline: string | undefined,
  targetPrice: number | undefined,
  targetDepartureTime: string | undefined,
  targetFlightNumber: string | undefined,
  trace: (msg: string) => void,
  /** Optional: returns all open pages so we can switch to a newly opened tab */
  getAllPages?: () => Page[],
  /** Optional: Stagehand instance for Attempt C fallback on fare-commit */
  stagehand?: { act: (s: string) => Promise<unknown> },
): Promise<{ reached_checkout: boolean; currentUrl: string; activePage?: Page; error?: string }> {
  let activePage = page; // may be updated if Expedia opens review in new tab

  const getUrl = () => {
    try { return (activePage as unknown as { url: () => string }).url(); } catch { return ""; }
  };

  // ── Debug: screenshot helper (writes to .debug-screenshots/<run-id>/) ───
  const debugRunId = `flight-rpa-${Date.now()}`;
  const debugDir = path.join(process.cwd(), ".debug-screenshots", debugRunId);
  try { fs.mkdirSync(debugDir, { recursive: true }); } catch { /* ignore */ }
  const safeScreenshot = async (label: string): Promise<void> => {
    try {
      const p = path.join(debugDir, `${label}.jpg`);
      await (activePage as unknown as { screenshot: (o: { path: string; type: string; quality: number }) => Promise<Buffer> })
        .screenshot({ path: p, type: "jpeg", quality: 55 });
      trace(`[flight-rpa] 📸 ${label} → ${p}`);
    } catch (err) {
      trace(`[flight-rpa] screenshot(${label}) failed: ${(err as Error).message?.slice(0, 80)}`);
    }
  };

  const detectSafetyBoundary = async (targetPage: Page = activePage): Promise<string | null> => {
    const bodyText = await targetPage.evaluate(() => document.body.textContent ?? "").catch(() => "");
    return classifyExpediaFlightSafetyBoundaryText(bodyText);
  };

  // ── Step 1: Wait for flight results ───────────────────────────────────────
  const enforceOneWayTripUi = async (): Promise<void> => {
    const url = getUrl().toLowerCase();
    if (!url.includes("trip=oneway")) return;

    const tripState = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"], [role="button"]'))
        .filter(el => {
          const text = (el.textContent ?? "").trim().toLowerCase();
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 &&
            (text === "roundtrip" || text === "one-way" || text === "multi-city");
        })
        .map(el => ({
          text: (el.textContent ?? "").trim(),
          ariaSelected: el.getAttribute("aria-selected"),
          ariaPressed: el.getAttribute("aria-pressed"),
          ariaCurrent: el.getAttribute("aria-current"),
          className: (el.getAttribute("class") ?? "").toLowerCase(),
        }));

      const active = tabs.find(tab =>
        tab.ariaSelected === "true" ||
        tab.ariaPressed === "true" ||
        tab.ariaCurrent === "page" ||
        /\bselected\b|\bactive\b|\buitk-tab-selected\b/.test(tab.className)
      );

      return {
        tabs: tabs.map(tab => tab.text),
        activeText: active?.text ?? "",
      };
    }).catch(() => ({ tabs: [] as string[], activeText: "" }));

    trace(`[flight-rpa] Trip UI before enforce: tabs="${tripState.tabs.join(" | ")}" active="${tripState.activeText || "(unknown)"}"`);
    if (tripState.activeText.toLowerCase() === "one-way") return;

    const clicked = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"], [role="button"]'))
        .find(el => {
          const text = (el.textContent ?? "").trim().toLowerCase();
          const r = el.getBoundingClientRect();
          return text === "one-way" && r.width > 0 && r.height > 0;
        });
      if (!target) return false;
      target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
      target.click();
      return true;
    }).catch(() => false);

    trace(`[flight-rpa] Trip UI enforce one-way: clicked=${clicked}`);
    if (clicked) await new Promise(r => setTimeout(r, 1200));
  };

  const dismissForcedChoiceDatePicker = async (): Promise<boolean> => {
    const dismissed = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 200 && r.height > 200;
        });

      const dialog = dialogs.find(el => {
        const text = (el.textContent ?? "").toLowerCase();
        return text.includes("pick-up date") ||
          text.includes("drop-off date") ||
          (text.includes("done") && (text.includes("may 2026") || text.includes("june 2026")));
      });
      if (!dialog) return false;

      const closeBtn = dialog.querySelector<HTMLElement>(
        '#forced-choice-modal-dismiss-btn, button[aria-label*="close" i], button[title*="close" i], button[data-testid*="close" i]'
      );
      if (closeBtn) {
        closeBtn.click();
        return true;
      }

      const doneBtn = Array.from(dialog.querySelectorAll<HTMLElement>('button, a'))
        .find(el => (el.textContent ?? "").trim().toLowerCase() === "done");
      if (doneBtn) {
        doneBtn.click();
        return true;
      }

      return false;
    }).catch(() => false);

    if (dismissed) {
      trace("[flight-rpa] Closed forced-choice date picker");
      await new Promise(r => setTimeout(r, 1000));
    }
    return dismissed;
  };

  await enforceOneWayTripUi();
  await dismissExpediaFlightSoftOverlays(page, trace, 300);
  trace("[flight-rpa] Waiting for flight results to load...");
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const hasResults = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll<HTMLElement>('button'));
      return btns.some(b => {
        const label = (b.getAttribute("aria-label") ?? "").toLowerCase();
        return label.includes("select") && label.includes("flight");
      });
    }).catch(() => false);
    if (hasResults) break;
  }
  await new Promise(r => setTimeout(r, 800));
  await dismissExpediaFlightSoftOverlays(page, trace, 100);
  const preScanBoundary = await detectSafetyBoundary(page);
  if (preScanBoundary) {
    trace(`[flight-rpa] Login/OTP/CAPTCHA boundary detected before flight-card scan: ${preScanBoundary}`);
    await safeScreenshot("01b-safety-boundary-before-card-scan");
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      error: `Expedia flight ${preScanBoundary} reached. Stop for manual intervention; do not bypass login, OTP, or CAPTCHA.`,
    };
  }

  // ── Roundtrip detection + leg loop setup ────────────────────────────────
  // Expedia URL pattern:
  //   initial (roundtrip):  /Flights-Search?trip=roundtrip&leg1=…&leg2=…
  //   outbound committed:   /Flights-Search?journeysContinuationId=…
  //   final committed:      /Flights-Checkout?… (leaves flights-search)
  // One-way skips the middle state. We detect roundtrip from the initial URL
  // and run Steps 2–3 twice — once per leg — with target hints appropriate to
  // each leg.
  const isRoundtrip =
    getUrl().toLowerCase().includes("trip=roundtrip") ||
    /[?&]leg2=/i.test(getUrl());
  const legsToSelect = isRoundtrip ? 2 : 1;
  trace(`[flight-rpa] Trip type: ${isRoundtrip ? "roundtrip (2 legs)" : "one-way"}`);

  // Leg-scoped target hints. On the return-selection page the incremental
  // pricing (+$79 vs $440 outbound total) makes a direct price match useless,
  // so for leg 1 we drop price/time/flight-number and let the scoring pick the
  // cheapest select-button. We keep the airline preference — users usually
  // want the same carrier for both legs.
  let legTargetAirline = targetAirline;
  let legTargetPrice = targetPrice;
  let legTargetDepartureTime = targetDepartureTime;
  let legTargetFlightNumber = targetFlightNumber;

  for (let leg = 0; leg < legsToSelect; leg++) {
    const isReturnLeg = leg === 1;
    const legLabel = isReturnLeg ? "return" : "outbound";

    if (isReturnLeg) {
      legTargetPrice = undefined;
      legTargetDepartureTime = undefined;
      legTargetFlightNumber = undefined;

      trace("[flight-rpa] Outbound committed — waiting for return-flight results to load...");
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const hasResults = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll<HTMLElement>('button'));
          return btns.some(b => {
            const label = (b.getAttribute("aria-label") ?? "").toLowerCase();
            return label.includes("select") && label.includes("flight");
          });
        }).catch(() => false);
        if (hasResults) break;
      }
      await new Promise(r => setTimeout(r, 800));
    }

    trace(`[flight-rpa] ── Leg ${leg + 1}/${legsToSelect} (${legLabel}) ──`);

  // ── Step 2: Find, scroll to, and click the target flight card ─────────────
  trace(`[flight-rpa] Searching for flight: airline="${legTargetAirline}" price=$${legTargetPrice} time="${legTargetDepartureTime}" flightNo="${legTargetFlightNumber}"`);
  await safeScreenshot("01-search-results");

  const legFlightTarget: ExpediaFlightTarget = {
    airline: legTargetAirline,
    price: legTargetPrice,
    time: legTargetDepartureTime,
    flightNumber: legTargetFlightNumber,
  };

  let found: ExpediaFlightButtonMatch = await page.evaluate(({ airline, price, time, flightNumber }: { airline?: string; price?: number; time?: string; flightNumber?: string }) => {
    const parseTimeToMinutes = (t: string | null | undefined): number | null => {
      if (!t) return null;
      const raw = t.trim().toLowerCase();
      const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (!match) return null;
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const suffix = match[3]?.toLowerCase() ?? null;
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
      if (!suffix && hour === 24) hour = 0;
      return hour * 60 + minute;
    };
    const timeMinutes = parseTimeToMinutes(time);
    const normalizeLoose = (s: string | null | undefined): string =>
      (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizeTight = (s: string | null | undefined): string =>
      (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const extractPrices = (text: string): number[] =>
      Array.from(text.matchAll(/\$([\d,]+)/g))
        .map(match => Number.parseInt((match[1] ?? "").replace(/,/g, ""), 10))
        .filter(value => Number.isFinite(value));
    const airlineLoose = normalizeLoose(airline);
    const airlineWord = airlineLoose.split(" ")[0] ?? "";
    const flightNumberTight = normalizeTight(flightNumber);
    const flightDigits = (flightNumber ?? "").replace(/\D/g, "");
    const priceToken = typeof price === "number" ? `$${price}` : "";

    const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const selectableCandidates = allButtons
      .map(btn => {
        const label = normalizeLoose((btn.getAttribute("aria-label") ?? "") + " " + (btn.textContent ?? ""));
        if (!label.includes("select")) return null;
        const container = btn.closest('li, article, section, [data-test-id], [data-stid], [class*="uitk-card"], [class*="offer-card"], [class*="result"]');
        const context = normalizeLoose(container?.textContent ?? btn.parentElement?.textContent ?? "");
        const combined = `${label} ${context}`.trim();
        const combinedTight = normalizeTight(combined);
        const hasAirline = !airlineWord || combined.includes(airlineWord) || combined.includes(airlineLoose);
        const visiblePrices = extractPrices(combined);
        const priceDelta =
          typeof price === "number" && visiblePrices.length > 0
            ? Math.min(...visiblePrices.map(value => Math.abs(value - price)))
            : null;
        const hasPrice = !priceToken || combined.includes(priceToken) || priceDelta === 0;
        const hasFlightNumber =
          !flightNumberTight ||
          combinedTight.includes(flightNumberTight) ||
          (flightDigits.length >= 3 && combinedTight.includes(flightDigits));
        const departureMatch =
          combined.match(/departing at (\d{1,2}:\d{2}\s*(?:am|pm)?)/i) ??
          combined.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i);
        const departureMinutes = parseTimeToMinutes(departureMatch?.[1] ?? null);
        const timeDelta =
          timeMinutes !== null && departureMinutes !== null
            ? Math.abs(departureMinutes - timeMinutes)
            : null;
        const timeScore =
          timeMinutes !== null
            ? departureMinutes === timeMinutes
              ? 4
              : departureMinutes !== null && Math.abs(departureMinutes - timeMinutes) <= 5
                ? 2
                : 0
            : 1;
        const score =
          (hasFlightNumber ? 5 : 0) +
          timeScore * 2 +
          (hasPrice ? 1 : 0);
        const hasExactTargetTime = timeMinutes !== null && departureMinutes === timeMinutes;
        const hasNearTargetTime = timeDelta !== null && timeDelta <= 120;
        const hasStrongTargetIdentity = hasFlightNumber || hasExactTargetTime;
        const exactMatch =
          (!flightNumberTight || hasFlightNumber) &&
          (timeMinutes === null || timeScore > 0) &&
          (hasStrongTargetIdentity || !priceToken || hasPrice);
        const hasPriceFallbackWithoutTargetTime =
          timeMinutes === null && (hasPrice || (priceDelta !== null && priceDelta <= 60));
        const fallbackEligible =
          hasFlightNumber ||
          hasNearTargetTime ||
          hasPriceFallbackWithoutTargetTime;
        const fallbackScore =
          (hasFlightNumber ? 120 : 0) +
          (hasExactTargetTime ? 100 : 0) +
          (timeDelta !== null ? Math.max(0, 60 - Math.floor(timeDelta / 2)) : 0) +
          (priceDelta !== null ? Math.max(0, 10 - Math.floor(priceDelta / 20)) : 0);
        const r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return {
          btn,
          label: combined.slice(0, 140),
          hasAirline,
          score,
          exactMatch,
          fallbackEligible,
          fallbackScore,
          hasPrice,
          hasFlightNumber,
          timeScore,
          departureMinutes: departureMinutes ?? -1,
          timeDelta,
          priceDelta,
        };
      })
      .filter(Boolean) as Array<{
        btn: HTMLElement;
        label: string;
        hasAirline: boolean;
        score: number;
        exactMatch: boolean;
        fallbackEligible: boolean;
        fallbackScore: number;
        hasPrice: boolean;
        hasFlightNumber: boolean;
        timeScore: number;
        departureMinutes: number;
        timeDelta: number | null;
        priceDelta: number | null;
      }>;
    const airlineCandidates = selectableCandidates.filter(candidate => candidate.hasAirline);

    const sortByTargetFit = (
      a: { score: number; fallbackScore: number; departureMinutes: number; priceDelta: number | null },
      b: { score: number; fallbackScore: number; departureMinutes: number; priceDelta: number | null },
      mode: "strict" | "fallback",
    ) => {
      if (mode === "strict" && b.score !== a.score) return b.score - a.score;
      if (mode === "fallback" && b.fallbackScore !== a.fallbackScore) return b.fallbackScore - a.fallbackScore;
      if (timeMinutes !== null) {
        const aDelta = a.departureMinutes >= 0 ? Math.abs(a.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
        const bDelta = b.departureMinutes >= 0 ? Math.abs(b.departureMinutes - timeMinutes) : Number.POSITIVE_INFINITY;
        if (aDelta !== bDelta) return aDelta - bDelta;
      }
      const aPriceDelta = a.priceDelta ?? Number.POSITIVE_INFINITY;
      const bPriceDelta = b.priceDelta ?? Number.POSITIVE_INFINITY;
      if (aPriceDelta !== bPriceDelta) return aPriceDelta - bPriceDelta;
      return 0;
    };

    const strictCandidates = airlineCandidates
      .filter(candidate => candidate.exactMatch)
      .sort((a, b) => sortByTargetFit(a, b, "strict"));
    const sameAirlineFallbackCandidates = airlineCandidates
      .filter(candidate => !candidate.exactMatch && candidate.fallbackEligible)
      .sort((a, b) => sortByTargetFit(a, b, "fallback"));
    const crossAirlineFallbackCandidates = selectableCandidates
      .filter(candidate =>
        !candidate.hasAirline &&
        !candidate.exactMatch &&
        candidate.fallbackEligible
      )
      .sort((a, b) => sortByTargetFit(a, b, "fallback"));
    const best = strictCandidates[0] ?? sameAirlineFallbackCandidates[0] ?? crossAirlineFallbackCandidates[0];
    if (!best) {
      const samples = allButtons
        .map(btn => normalizeLoose((btn.getAttribute("aria-label") ?? "") + " " + (btn.textContent ?? "")))
        .filter(text => text.includes("select"))
        .slice(0, 6);
      return { found: false, label: "", candidates: 0, x: 0, y: 0, inViewportBefore: false, samples };
    }

    const rectBefore = best.btn.getBoundingClientRect();
    const inViewportBefore = rectBefore.top >= 0 && rectBefore.bottom <= window.innerHeight;
    best.btn.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
    // Return viewport-relative center (after scroll). Need to re-read rect after scroll.
    const rectAfter = best.btn.getBoundingClientRect();
    return {
      found: true,
      label: best.label,
      candidates: strictCandidates.length + sameAirlineFallbackCandidates.length + crossAirlineFallbackCandidates.length,
      x: rectAfter.x + rectAfter.width / 2,
      y: rectAfter.y + rectAfter.height / 2,
      inViewportBefore,
      matchMode: strictCandidates[0]
        ? "strict"
        : sameAirlineFallbackCandidates[0]
          ? "fallback"
          : "cross_airline_fallback",
      matchReason: strictCandidates[0]
        ? "exact target fit"
        : sameAirlineFallbackCandidates[0]
          ? `same airline fallback timeDelta=${best.timeDelta ?? "?"} priceDelta=${best.priceDelta ?? "?"}`
          : `cross-airline fallback timeDelta=${best.timeDelta ?? "?"} priceDelta=${best.priceDelta ?? "?"}`,
      samples: [...strictCandidates, ...sameAirlineFallbackCandidates, ...crossAirlineFallbackCandidates].slice(0, 4).map(c => c.label),
    };
  }, legFlightTarget)
    .catch((err: Error) => ({
      found: false,
      label: "",
      candidates: 0,
      x: 0,
      y: 0,
      inViewportBefore: false,
      samples: [] as string[],
      matchMode: undefined,
      matchReason: undefined,
      evalError: err.message?.slice(0, 160) ?? "unknown evaluate error",
    }));

  if ("evalError" in found && found.evalError) {
    trace(`[flight-rpa] Flight-card DOM scan failed: ${found.evalError}`);
    trace("[flight-rpa] Trying locator fallback for flight-card scan");
    const fallback = await findExpediaFlightButtonWithLocatorFallback(page, legFlightTarget, trace);
    if (fallback.found) {
      trace(`[flight-rpa] Locator fallback matched flight card: "${fallback.label}"`);
      found = fallback;
    } else if (fallback.samples.length > 0) {
      found = {
        ...found,
        samples: fallback.samples,
        candidateSummaries: fallback.candidateSummaries,
      };
    }
  }

  const candidateSummaries = (
    found.candidateSummaries?.length
      ? found.candidateSummaries
      : (found.samples ?? []).map(sample => formatExpediaFlightCandidateEvidence(sample, legFlightTarget))
  ).slice(0, 4);
  if (candidateSummaries.length > 0) {
    trace(`[flight-rpa] Flight candidate evidence dump: ${candidateSummaries.map(summary => summary.slice(0, 220)).join(" || ")}`);
  }

  if (!found.found) {
    if (Array.isArray((found as { samples?: string[] }).samples) && (found as { samples?: string[] }).samples!.length > 0) {
      trace(`[flight-rpa] Visible select-button samples: ${(found as { samples: string[] }).samples.join(" | ")}`);
    }
    trace(`[flight-rpa] No matching flight button found (tried airline="${legTargetAirline}" price=$${legTargetPrice})`);
    return { reached_checkout: false, currentUrl: getUrl(), error: buildFlightInventoryDriftMessage(legLabel) };
  }
  const clickMode = found.clickMode ?? "coordinate";
  trace(`[flight-rpa] Flight match: "${found.label}" candidates=${found.candidates} inViewportBefore=${found.inViewportBefore} clickMode=${clickMode} → scrolled, clicking@(${Math.round(found.x)},${Math.round(found.y)})`);

  trace(`[flight-rpa] Match mode=${found.matchMode} reason="${found.matchReason}"`);
  trace(`[flight-rpa] Selected flight candidate evidence: ${formatExpediaFlightCandidateEvidence(found.label, legFlightTarget).slice(0, 260)}`);

  // Let the browser settle after scrollIntoView
  await new Promise(r => setTimeout(r, 700));
  await safeScreenshot("02-after-scroll-to-flight");

  // Real mouse click triggers React handlers reliably for off-screen scrolled elements.
  // Locator fallback is used when the runtime wrapper cannot expose coordinates.
  if (clickMode === "locator") {
    const locatorClick = await clickExpediaFlightButtonWithLocatorFallback(page, legFlightTarget);
    trace(
      `[flight-rpa] Locator flight click from matched fallback: clicked=${locatorClick.clicked} candidates=${locatorClick.candidates} ` +
      `mode=${locatorClick.matchMode ?? "none"} reason="${locatorClick.matchReason ?? locatorClick.error ?? "no match"}" label="${locatorClick.label.slice(0, 140)}"`
    );
  } else {
    await safeMouseClick(page, found.x, found.y);
  }
  await new Promise(r => setTimeout(r, 500));
  await safeScreenshot("03-after-flight-click");

  // ── Step 3: Wait for fare modal ("Select fare to <city>") then pick cheapest ─
  // The fare modal has a heading containing "Select fare to" and shows multiple fare tiers.
  const waitForFareModalOpen = async (): Promise<boolean> => {
    for (let i = 0; i < 20; i++) {   // up to 10s
      await new Promise(r => setTimeout(r, 500));
      const found = await page.evaluate(() => {
        const t = (document.body.textContent ?? "").toLowerCase();
        return t.includes("select fare to") || t.includes("select your fare");
      }).catch(() => false);
      if (found) return true;
    }
    return false;
  };

  trace("[flight-rpa] Waiting for fare selection modal...");
  let fareModalFound = await waitForFareModalOpen();
  if (!fareModalFound) {
    trace("[flight-rpa] Fare modal did not open after coordinate click - retrying selected flight via DOM rescan");
    await safeScreenshot("03b-flight-click-no-fare-modal");
    const domRetry = await clickExpediaFlightButtonWithDomRescan(page, legFlightTarget);
    trace(
      `[flight-rpa] DOM rescan flight click: clicked=${domRetry.clicked} candidates=${domRetry.candidates} ` +
      `mode=${domRetry.matchMode ?? "none"} reason="${domRetry.matchReason ?? domRetry.error ?? "no match"}" label="${domRetry.label.slice(0, 140)}"`
    );
    if (domRetry.candidateSummaries.length > 0) {
      trace(`[flight-rpa] DOM rescan candidate evidence: ${domRetry.candidateSummaries.map(summary => summary.slice(0, 220)).join(" || ")}`);
    }
    if (domRetry.clicked) {
      await new Promise(r => setTimeout(r, 700));
      await safeScreenshot("03c-after-dom-rescan-flight-click");
      fareModalFound = await waitForFareModalOpen();
    }
  }

  if (!fareModalFound) {
    trace("[flight-rpa] Fare modal still absent - retrying selected flight via Playwright locator fallback");
    const locatorRetry = await clickExpediaFlightButtonWithLocatorFallback(page, legFlightTarget);
    trace(
      `[flight-rpa] Locator flight click retry: clicked=${locatorRetry.clicked} candidates=${locatorRetry.candidates} ` +
      `mode=${locatorRetry.matchMode ?? "none"} reason="${locatorRetry.matchReason ?? locatorRetry.error ?? "no match"}" label="${locatorRetry.label.slice(0, 140)}"`
    );
    if (locatorRetry.candidateSummaries.length > 0) {
      trace(`[flight-rpa] Locator click candidate evidence: ${locatorRetry.candidateSummaries.map(summary => summary.slice(0, 220)).join(" || ")}`);
    }
    if (locatorRetry.clicked) {
      await new Promise(r => setTimeout(r, 700));
      await safeScreenshot("03d-after-locator-flight-click");
      fareModalFound = await waitForFareModalOpen();
    }
  }

  if (fareModalFound) {
    trace("[flight-rpa] Fare modal appeared — locating cheapest (leftmost) fare button");
    await safeScreenshot("04-fare-modal-open");

    const fareInfo = await page.evaluate(() => {
      // Step A — find the real dialog via ARIA attributes
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [aria-modal="true"], dialog'
      )).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height > 100;
      });

      let modal: HTMLElement | null = null;
      for (const cand of dialogs) {
        const t = (cand.textContent ?? "").toLowerCase();
        if (t.includes("select fare to") || t.includes("select your fare")) {
          modal = cand;
          break;
        }
      }

      // Step B — fallback: smallest ancestor containing the heading text
      if (!modal) {
        const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
        const candidates = allEls.filter(el => {
          const t = (el.textContent ?? "").toLowerCase();
          const r = el.getBoundingClientRect();
          return r.width > 200 && r.height > 200 &&
                 r.width < window.innerWidth * 0.95 &&
                 (t.includes("select fare to") || t.includes("select your fare")) &&
                 el.querySelectorAll("button").length >= 2;
        });
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (ra.width * ra.height) - (rb.width * rb.height);
        });
        modal = candidates[0] ?? null;
      }

      if (!modal) {
        return { found: false, reason: "modal not found", count: 0, modalSize: "", allButtonTexts: [] as string[], source: "none", x: 0, y: 0, btnTag: "", btnHtml: "" };
      }

      const modalRect = modal.getBoundingClientRect();
      const source = dialogs.includes(modal) ? "aria-dialog" : "text-fallback";

      const allBtnsInModal = Array.from(modal.querySelectorAll<HTMLElement>('button'))
        .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const allButtonTexts = allBtnsInModal.map(b => (b.textContent ?? "").trim().slice(0, 30));

      const selectBtns = allBtnsInModal
        .filter(b => (b.textContent ?? "").trim().toLowerCase() === "select")
        .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);

      if (selectBtns.length === 0) {
        return { found: false, reason: "no 'select' buttons inside modal", count: 0, modalSize: `${Math.round(modalRect.width)}x${Math.round(modalRect.height)}`, allButtonTexts, source, x: 0, y: 0, btnTag: "", btnHtml: "" };
      }

      const target = selectBtns[0];
      target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
      const r = target.getBoundingClientRect();
      return {
        found: true,
        reason: "ok",
        count: selectBtns.length,
        modalSize: `${Math.round(modalRect.width)}x${Math.round(modalRect.height)}`,
        allButtonTexts,
        source,
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        btnTag: target.tagName.toLowerCase() + (target.getAttribute("type") ? `[type=${target.getAttribute("type")}]` : ""),
        btnHtml: target.outerHTML.slice(0, 200),
      };
    }).catch((err: Error) => ({ found: false, reason: `evaluate error: ${err.message?.slice(0, 80)}`, count: 0, modalSize: "", allButtonTexts: [] as string[], source: "error", x: 0, y: 0, btnTag: "", btnHtml: "" }));

    trace(`[flight-rpa] Fare modal source=${fareInfo.source} size=${fareInfo.modalSize} selectCount=${fareInfo.count} reason=${fareInfo.reason}`);
    trace(`[flight-rpa] Fare modal buttons: ${fareInfo.allButtonTexts.slice(0, 12).join(" | ")}`);

    if (fareInfo.found) {
      trace(`[flight-rpa] Fare target: tag=${fareInfo.btnTag} initial coords=(${Math.round(fareInfo.x)},${Math.round(fareInfo.y)})`);
      trace(`[flight-rpa] Fare target html: ${fareInfo.btnHtml.slice(0, 150)}`);

      // Wait for any scroll-into-view animation to settle, then re-measure and verify
      await new Promise(r => setTimeout(r, 800));

      // Re-read position + sanity-check what's actually at that point
      const preClick = await page.evaluate((targetTotalPrice?: number) => {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; });
        let modal: HTMLElement | null = null;
        for (const cand of dialogs) {
          const t = (cand.textContent ?? "").toLowerCase();
          if (t.includes("select fare to") || t.includes("select your fare")) { modal = cand; break; }
        }
        if (!modal) return { x: 0, y: 0, reason: "no modal", elAtPoint: "", elText: "", modalRect: "" };

        const modalRect = modal.getBoundingClientRect();
        const selectBtns = Array.from(modal.querySelectorAll<HTMLElement>('button'))
          .filter(b => (b.textContent ?? "").trim().toLowerCase() === "select")
          .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });

        // Prefer the total price encoded in aria-label (e.g. "$237" for 2 travelers).
        // Nearby text often shows per-traveler pricing (e.g. "$119"), which is wrong
        // for selector matching and caused us to target the wrong button.
        const withPrices = selectBtns.map(btn => {
          let container: HTMLElement | null = btn.parentElement;
          let price = Infinity;
          for (let i = 0; i < 8 && container; i++) {
            const match = (container.textContent ?? "").match(/\$(\d{2,4})\b/);
            if (match) { price = parseInt(match[1], 10); break; }
            container = container.parentElement;
          }
          const ariaLabel = btn.getAttribute("aria-label") ?? "";
          // Handle both "$879" (no commas) and "$1,038" (thousands separator).
          // Old regex /\$(\d{2,4})\b/ failed on $1,038 because \d only matched
          // "1" before the comma breaks the digit run, then the 2-4 minimum
          // wasn't satisfied. Now we match a digit group with optional
          // thousands commas, then strip commas before parseInt.
          const ariaMatch = ariaLabel.match(/\$(\d{1,3}(?:,\d{3})+|\d+)/);
          const ariaPrice = ariaMatch ? parseInt(ariaMatch[1].replace(/,/g, ""), 10) : Infinity;
          const effectivePrice = Number.isFinite(ariaPrice) ? ariaPrice : price;
          return { btn, price, ariaPrice, effectivePrice };
        });
        withPrices.sort((a, b) => {
          const target = typeof targetTotalPrice === "number" && Number.isFinite(targetTotalPrice)
            ? targetTotalPrice
            : null;
          if (target !== null) {
            const da = Math.abs(a.effectivePrice - target);
            const db = Math.abs(b.effectivePrice - target);
            if (da !== db) return da - db;
          }
          if (a.effectivePrice !== b.effectivePrice) return a.effectivePrice - b.effectivePrice;
          return a.btn.getBoundingClientRect().x - b.btn.getBoundingClientRect().x;
        });
        const target = withPrices[0]?.btn ?? selectBtns[0];
        if (!target) return { x: 0, y: 0, reason: "no select btn", elAtPoint: "", elText: "", modalRect: "" };

        target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
        const r = target.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const elAtPoint = document.elementFromPoint(cx, cy) as HTMLElement | null;
        const elTag = elAtPoint ? elAtPoint.tagName.toLowerCase() : "null";
        const elText = elAtPoint ? (elAtPoint.textContent ?? "").trim().slice(0, 40) : "";
        // Walk up to find nearest button ancestor for sanity check
        let ancestorBtn: HTMLElement | null = elAtPoint;
        let ancestorText = "";
        while (ancestorBtn && ancestorBtn !== document.body) {
          if (ancestorBtn.tagName === "BUTTON" || ancestorBtn.getAttribute("role") === "button") {
            ancestorText = (ancestorBtn.textContent ?? "").trim().slice(0, 40);
            break;
          }
          ancestorBtn = ancestorBtn.parentElement;
        }
        return {
          x: cx,
          y: cy,
          reason: "ok",
          elAtPoint: elTag,
          elText,
          ancestorBtnText: ancestorText,
          pricesFound: withPrices.map(w => w.price).slice(0, 8),
          ariaPricesFound: withPrices.map(w => Number.isFinite(w.ariaPrice) ? w.ariaPrice : -1).slice(0, 8),
          chosenPrice: withPrices[0]?.effectivePrice ?? -1,
          modalRect: `${Math.round(modalRect.x)},${Math.round(modalRect.y)} ${Math.round(modalRect.width)}x${Math.round(modalRect.height)}`,
        };
      }, legTargetPrice).catch((err: Error) => ({
        x: 0, y: 0, reason: `err: ${err.message?.slice(0, 80)}`, elAtPoint: "", elText: "", ancestorBtnText: "",
        pricesFound: [] as number[], ariaPricesFound: [] as number[], chosenPrice: -1, modalRect: "",
      }));

      trace(
        `[flight-rpa] Pre-click verify: modalRect=${preClick.modalRect} coords=(${Math.round(preClick.x)},${Math.round(preClick.y)}) ` +
        `pricesFound=[${preClick.pricesFound?.join(",")}] ariaPrices=[${preClick.ariaPricesFound?.join(",")}] chosen=$${preClick.chosenPrice}`
      );
      trace(`[flight-rpa] Pre-click elementFromPoint: <${preClick.elAtPoint}> text="${preClick.elText}" ancestorBtn="${preClick.ancestorBtnText}"`);

      const chosenPrice = preClick.chosenPrice ?? 0;
      const initialUrl = getUrl();
      // Format the price the same way Expedia writes it in aria-label. For
      // prices >= 1,000 the aria-label uses a thousands separator ("for $1,038"),
      // so a substring match on "for $1038" would miss. Render the number with
      // commas when it's 4+ digits so the selector matches both outbound
      // single-leg totals and roundtrip combined totals on the return modal.
      const chosenPriceFormatted = chosenPrice >= 1000
        ? chosenPrice.toLocaleString("en-US")
        : String(chosenPrice);
      const selector = `button[data-stid="select-button"][aria-label*="for $${chosenPriceFormatted}"]`;

      const resolvePlayablePage = (): (Page & {
        mouse?: {
          move?: (x: number, y: number, opts?: { steps?: number }) => Promise<void>;
          down?: () => Promise<void>;
          up?: () => Promise<void>;
        };
        keyboard?: { press?: (key: string, opts?: { delay?: number }) => Promise<void> };
        page?: unknown;
        _page?: unknown;
        rawPage?: unknown;
      }) | null => {
        const seen = new Set<unknown>();
        let current: unknown = page;
        for (let depth = 0; depth < 5 && current && typeof current === "object" && !seen.has(current); depth++) {
          seen.add(current);
          const candidate = current as Page & {
            mouse?: {
              move?: (x: number, y: number, opts?: { steps?: number }) => Promise<void>;
              down?: () => Promise<void>;
              up?: () => Promise<void>;
            };
            keyboard?: { press?: (key: string, opts?: { delay?: number }) => Promise<void> };
            locator?: Page["locator"];
            page?: unknown;
            _page?: unknown;
            rawPage?: unknown;
          };
          if (typeof candidate.locator === "function" || candidate.mouse || candidate.keyboard) return candidate;
          current = candidate.page ?? candidate._page ?? candidate.rawPage;
        }
        return null;
      };

      const clickFareBySelector = async (): Promise<"locator-click" | "dom-click"> => {
        const clicked = await page.evaluate((sel: string) => {
          const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(sel))
            .filter(btn => {
              const r = btn.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && !btn.disabled;
            });
          const target = candidates[0];
          if (!target) return false;
          target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
          target.click();
          return true;
        }, selector).catch(() => false);

        if (clicked) return "dom-click";

        const playablePage = resolvePlayablePage();
        if (playablePage && typeof playablePage.locator === "function") {
          await playablePage.locator(selector).first().click({ delay: 120, timeout: 5000 });
          return "locator-click";
        }

        throw new Error(`selector fallback could not find ${selector}`);
      };

      const pressEnterOnFareButton = async (): Promise<"keyboard-press" | "stagehand-keypress" | "dom-enter"> => {
        const focused = await page.evaluate((sel: string) => {
          const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(sel))
            .filter(btn => {
              const r = btn.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && !btn.disabled;
            });
          const target = candidates[0];
          if (!target) return false;
          target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
          target.focus();
          return document.activeElement === target;
        }, selector).catch(() => false);

        if (!focused) throw new Error("could not focus fare button");

        const playablePage = resolvePlayablePage();
        if (playablePage?.keyboard?.press) {
          await playablePage.keyboard.press("Enter", { delay: 80 });
          return "keyboard-press";
        }

        const stagehandKeyPress = (page as unknown as {
          keyPress?: (key: string, opts?: { delay?: number }) => Promise<void>;
        }).keyPress;
        if (typeof stagehandKeyPress === "function") {
          await stagehandKeyPress("Enter", { delay: 80 });
          return "stagehand-keypress";
        }

        const fired = await page.evaluate((sel: string) => {
          const target = document.querySelector<HTMLElement>(sel);
          if (!target) return false;
          const opts = { key: "Enter", code: "Enter", bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent("keydown", opts));
          target.dispatchEvent(new KeyboardEvent("keypress", opts));
          target.dispatchEvent(new KeyboardEvent("keyup", opts));
          target.click?.();
          return true;
        }, selector).catch(() => false);

        if (!fired) throw new Error("could not synthesize Enter on fare button");
        return "dom-enter";
      };

      const runTrajectoryClick = async (x: number, y: number): Promise<"playwright-mouse" | "safe-mouse-click"> => {
        const playablePage = resolvePlayablePage();
        if (playablePage?.mouse?.move && playablePage?.mouse?.down && playablePage?.mouse?.up) {
          await playablePage.mouse.move(100, 500);
          await new Promise(r => setTimeout(r, 150));
          await playablePage.mouse.move(x - 60, y - 30, { steps: 18 });
          await new Promise(r => setTimeout(r, 120));
          await playablePage.mouse.move(x, y, { steps: 10 });
          await new Promise(r => setTimeout(r, 200));
          await playablePage.mouse.down();
          await new Promise(r => setTimeout(r, 90));
          await playablePage.mouse.up();
          return "playwright-mouse";
        }

        await page.evaluate(({ targetX, targetY }: { targetX: number; targetY: number }) => {
          const start = { x: 100, y: 500 };
          const mid = { x: targetX - 60, y: targetY - 30 };
          const end = { x: targetX, y: targetY };
          const points = [start, mid, end];
          const interpolate = (from: { x: number; y: number }, to: { x: number; y: number }, steps: number) => {
            const out: Array<{ x: number; y: number }> = [];
            for (let i = 1; i <= steps; i++) {
              out.push({
                x: from.x + ((to.x - from.x) * i) / steps,
                y: from.y + ((to.y - from.y) * i) / steps,
              });
            }
            return out;
          };
          const trail = [
            ...interpolate(points[0], points[1], 18),
            ...interpolate(points[1], points[2], 10),
          ];
          for (const point of trail) {
            const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
            if (!el) continue;
            const mouseOpts = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y };
            el.dispatchEvent(new PointerEvent("pointermove", { ...mouseOpts, pointerType: "mouse" }));
            el.dispatchEvent(new MouseEvent("mousemove", mouseOpts));
            el.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
          }
        }, { targetX: x, targetY: y }).catch(() => {});

        await safeMouseClick(page, x, y);
        return "safe-mouse-click";
      };

      const capabilityPage = resolvePlayablePage();
      trace(
        `[flight-rpa] Fare click env: locator=${typeof capabilityPage?.locator === "function"} ` +
        `keyboard=${!!capabilityPage?.keyboard?.press} mouse=${!!capabilityPage?.mouse} ` +
        `stagehandClick=${typeof (page as unknown as { click?: unknown }).click === "function"}`
      );

      // Helper: commit detection — URL leaves Flights-Search, OR gains
      // journeysContinuationId (= outbound just committed on a roundtrip),
      // OR a Review/Continue CTA appears, OR the bundle popup fires.
      const checkCommitted = async (): Promise<{ committed: boolean; url: string; reason: string }> => {
        const url = getUrl();
        const urlLc = url.toLowerCase();
        const initialLc = initialUrl.toLowerCase();
        const leftFlightsSearch = !urlLc.includes("flights-search");
        const gainedContinuationId =
          urlLc.includes("journeyscontinuationid") &&
          !initialLc.includes("journeyscontinuationid");
        const urlChanged =
          !!initialUrl &&
          urlLc !== initialLc &&
          (leftFlightsSearch || gainedContinuationId);
        const ctaVisible = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          const keywords = [
            "review your trip", "review trip", "continue to review",
            "continue to checkout", "next: review", "next: seats",
            "proceed to review", "confirm selection",
          ];
          return btns.some(b => {
            const t = (b.textContent ?? "").trim().toLowerCase();
            return keywords.some(kw => t === kw || t.includes(kw));
          });
        }).catch(() => false);
        const bundlePopupVisible = await page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 100 && r.height > 100;
            });
          return dialogs.some(el => {
            const text = (el.textContent ?? "").toLowerCase();
            return text.includes("car rental dates") ||
              text.includes("explore packages") ||
              (text.includes("bundle & save") && text.includes("includes your selected flight"));
          });
        }).catch(() => false);
        if (urlChanged) return { committed: true, url, reason: "url-changed" };
        if (ctaVisible) return { committed: true, url, reason: "cta-visible" };
        if (bundlePopupVisible) return { committed: true, url, reason: "bundle-popup" };
        return { committed: false, url, reason: "no-change" };
      };

      // Helper: ensure fare modal is open (re-click flight card if closed)
      const ensureFareModalOpen = async (): Promise<boolean> => {
        const isOpen = async () => page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'));
          return dialogs.some(d => {
            const t = (d.textContent ?? "").toLowerCase();
            const r = d.getBoundingClientRect();
            return r.width > 100 && r.height > 100 && (t.includes("select fare to") || t.includes("select your fare"));
          });
        }).catch(() => false);
        if (await isOpen()) return true;

        trace("[flight-rpa] Fare modal closed — re-clicking flight card to reopen");
        const reopen = await page.evaluate(({ airline }: { airline: string }) => {
          const airlineLower = airline.toLowerCase();
          const btns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
          const target = btns.find(b => {
            const label = ((b.getAttribute("aria-label") ?? "") + " " + (b.textContent ?? "")).toLowerCase();
            return label.includes("select") && label.includes("flight") && (airlineLower === "" || label.includes(airlineLower));
          });
          if (!target) return { found: false, x: 0, y: 0 };
          target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
          const r = target.getBoundingClientRect();
          return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, { airline: (legTargetAirline ?? "").toLowerCase() })
          .catch(() => ({ found: false, x: 0, y: 0 }));
        if (!reopen.found) return false;
        await new Promise(r => setTimeout(r, 400));
        await safeMouseClick(page, reopen.x, reopen.y);
        await new Promise(r => setTimeout(r, 2500));
        return await isOpen();
      };

      // Helper: re-measure cheapest-fare button coords in currently-open modal (for D)
      const recomputeFareCoords = async (): Promise<{ x: number; y: number; price: number }> => {
        return page.evaluate((targetTotalPrice?: number) => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; });
          let modal: HTMLElement | null = null;
          for (const cand of dialogs) {
            const t = (cand.textContent ?? "").toLowerCase();
            if (t.includes("select fare to") || t.includes("select your fare")) { modal = cand; break; }
          }
          if (!modal) return { x: 0, y: 0, price: 0 };
          const selectBtns = Array.from(modal.querySelectorAll<HTMLElement>('button'))
            .filter(b => (b.textContent ?? "").trim().toLowerCase() === "select")
            .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
          const withPrices = selectBtns.map(btn => {
            let container: HTMLElement | null = btn.parentElement;
            let price = Infinity;
            for (let i = 0; i < 8 && container; i++) {
              const match = (container.textContent ?? "").match(/\$(\d{2,4})\b/);
              if (match) { price = parseInt(match[1], 10); break; }
              container = container.parentElement;
            }
            const ariaLabel = btn.getAttribute("aria-label") ?? "";
            // Same comma-aware regex as the pre-click pass above — must handle
            // "$1,038" on the return-fare modal, not only "$879" outbound totals.
            const ariaMatch = ariaLabel.match(/\$(\d{1,3}(?:,\d{3})+|\d+)/);
            const ariaPrice = ariaMatch ? parseInt(ariaMatch[1].replace(/,/g, ""), 10) : Infinity;
            const effectivePrice = Number.isFinite(ariaPrice) ? ariaPrice : price;
            return { btn, price, ariaPrice, effectivePrice };
          }).sort((a, b) => {
            const target = typeof targetTotalPrice === "number" && Number.isFinite(targetTotalPrice)
              ? targetTotalPrice
              : null;
            if (target !== null) {
              const da = Math.abs(a.effectivePrice - target);
              const db = Math.abs(b.effectivePrice - target);
              if (da !== db) return da - db;
            }
            if (a.effectivePrice !== b.effectivePrice) return a.effectivePrice - b.effectivePrice;
            return a.btn.getBoundingClientRect().x - b.btn.getBoundingClientRect().x;
          });
          const target = withPrices[0]?.btn;
          if (!target) return { x: 0, y: 0, price: 0 };
          target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
          const r = target.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, price: withPrices[0]?.effectivePrice ?? 0 };
        }, legTargetPrice).catch(() => ({ x: 0, y: 0, price: 0 }));
      };

      let commitResult: { committed: boolean; url: string; reason: string } =
        { committed: false, url: initialUrl, reason: "not-attempted" };

      // ── Attempt A: locator click on the fare button ───────────────────────
      trace(`[flight-rpa] Attempt A: locator.click(${selector})`);
      try {
        const method = await clickFareBySelector();
        await new Promise(r => setTimeout(r, 2800));
        await safeScreenshot("05A-after-pw-click");
        commitResult = await checkCommitted();
        trace(`[flight-rpa] After A: method=${method} committed=${commitResult.committed} reason=${commitResult.reason} url=${commitResult.url.slice(0, 90)}`);
      } catch (err) {
        trace(`[flight-rpa] Attempt A failed: ${(err as Error).message?.slice(0, 100)}`);
      }

      // ── Attempt B: focus + Enter path ──────────────────────────────────────
      if (!commitResult.committed) {
        trace(`[flight-rpa] Attempt B: focus + Enter on ${selector}`);
        try {
          const method = await pressEnterOnFareButton();
          await new Promise(r => setTimeout(r, 2200));
          await safeScreenshot("05B-after-enter");
          commitResult = await checkCommitted();
          trace(`[flight-rpa] After B: method=${method} committed=${commitResult.committed} reason=${commitResult.reason} url=${commitResult.url.slice(0, 90)}`);
        } catch (err) {
          trace(`[flight-rpa] Attempt B failed: ${(err as Error).message?.slice(0, 100)}`);
        }
      }

      // ── Attempt C: Stagehand AI act ───────────────────────────────────────
      if (!commitResult.committed && stagehand) {
        const modalOpenForC = await ensureFareModalOpen();
        trace(`[flight-rpa] Attempt C prep: modalOpen=${modalOpenForC}`);
        if (modalOpenForC) {
          try {
            const STAGEHAND_ACT_TIMEOUT_MS = 20_000;
            await Promise.race([
              stagehand.act(
                `Click the Select button for the cheapest fare tier priced at $${chosenPrice} inside the fare selection drawer on the right side of the page`
              ),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`stagehand.act timed out after ${Math.round(STAGEHAND_ACT_TIMEOUT_MS / 1000)}s`)),
                  STAGEHAND_ACT_TIMEOUT_MS
                )
              ),
            ]);
            await new Promise(r => setTimeout(r, 3000));
            await safeScreenshot("05C-after-stagehand-act");
            commitResult = await checkCommitted();
            trace(`[flight-rpa] After C: committed=${commitResult.committed} reason=${commitResult.reason} url=${commitResult.url.slice(0, 90)}`);
          } catch (err) {
            trace(`[flight-rpa] Attempt C failed: ${(err as Error).message?.slice(0, 100)}`);
          }
        }
      } else if (!commitResult.committed && !stagehand) {
        trace("[flight-rpa] Attempt C skipped: stagehand not provided");
      }

      // ── Attempt D: Human-like mouse trajectory ──────────────────────────────
      if (!commitResult.committed) {
        const modalOpenForD = await ensureFareModalOpen();
        trace(`[flight-rpa] Attempt D prep: modalOpen=${modalOpenForD}`);
        if (modalOpenForD) {
          const coords = await recomputeFareCoords();
          trace(`[flight-rpa] Attempt D: mouse-trajectory click at (${Math.round(coords.x)},${Math.round(coords.y)}) price=$${coords.price}`);
          try {
            const method = await runTrajectoryClick(coords.x, coords.y);
            await new Promise(r => setTimeout(r, 2800));
            await safeScreenshot("05D-after-trajectory");
            commitResult = await checkCommitted();
            trace(`[flight-rpa] After D: method=${method} committed=${commitResult.committed} reason=${commitResult.reason} url=${commitResult.url.slice(0, 90)}`);
          } catch (err) {
            trace(`[flight-rpa] Attempt D failed: ${(err as Error).message?.slice(0, 100)}`);
          }
        }
      }

      // Final state snapshot (kept for downstream compat + visibility in logs)
      const fareModalStillOpen = await page.evaluate(() => {
        const t = (document.body.textContent ?? "").toLowerCase();
        return t.includes("select fare to") || t.includes("select your fare");
      }).catch(() => false);
      trace(`[flight-rpa] Fare cascade done: committed=${commitResult.committed} reason=${commitResult.reason} modalStillOpen=${fareModalStillOpen}`);
      trace(`[flight-rpa] URL after fare cascade: ${getUrl().slice(0, 100)}`);

      // ── Follow-up: look for "Review your trip" / "Continue" action ─────
      // On one-way flights (e.g. Delta), Expedia closes the modal and highlights
      // the card, but doesn't navigate — user must click a Review/Continue CTA.
      const postFareAction = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
          .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });

        const keywords = [
          "review your trip", "review trip", "continue to review", "continue to checkout",
          "continue to book", "next: review", "next: seats", "proceed to review",
          "go to review", "confirm selection", "continue",
        ];
        for (const kw of keywords) {
          const btn = allBtns.find(b => {
            const t = (b.textContent ?? "").trim().toLowerCase();
            return t === kw || t.startsWith(kw + " ") || t.includes(kw);
          });
          if (btn) {
            btn.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
            const r = btn.getBoundingClientRect();
            return {
              found: true,
              matchedKw: kw,
              text: (btn.textContent ?? "").trim().slice(0, 40),
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
              allText: [] as string[],
            };
          }
        }
        const allText = allBtns
          .map(b => {
            const r = b.getBoundingClientRect();
            return `"${(b.textContent ?? "").trim().slice(0, 30)}"@(${Math.round(r.x)},${Math.round(r.y)})`;
          })
          .filter(t => !t.startsWith('""'))
          .slice(0, 40);
        return { found: false, matchedKw: "", text: "", x: 0, y: 0, allText };
      }).catch(() => ({ found: false, matchedKw: "", text: "", x: 0, y: 0, allText: [] as string[] }));

      if (postFareAction.found) {
        trace(`[flight-rpa] Post-fare action found: kw="${postFareAction.matchedKw}" text="${postFareAction.text}" coords=(${Math.round(postFareAction.x)},${Math.round(postFareAction.y)})`);
        await new Promise(r => setTimeout(r, 400));
        await safeMouseClick(page, postFareAction.x, postFareAction.y);
        await new Promise(r => setTimeout(r, 2000));
        await safeScreenshot("05b-after-post-fare-click");
        trace(`[flight-rpa] URL after post-fare click: ${getUrl().slice(0, 100)}`);
      } else {
        trace(`[flight-rpa] No post-fare CTA found — all visible buttons (40 max):`);
        for (const t of postFareAction.allText) trace(`[flight-rpa]   btn: ${t}`);
      }
    }
  } else {
    trace(`[flight-rpa] Fare modal not detected for ${legLabel} leg — continuing`);
  }

  } // end of for-leg loop — both outbound and (optional) return committed

  // ── Step 4: Dismiss Bundle & Save popup ────────────────────────────────────
  // The real bundle popup contains "Car rental dates" or "Explore packages" button.
  // Wait up to 6s for it to appear after fare selection.
  let bundlePopupDetected = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    const detected = await isExpediaFlightBundlePopupVisible(activePage);
    if (detected) { bundlePopupDetected = true; break; }
  }

  let bundleDismissed = false;
  let bundleDiag: { reason: string; source: string; modalSize: string; noThanksText: string; btnHtml: string; href: string; x: number; y: number } = { reason: "", source: "", modalSize: "", noThanksText: "", btnHtml: "", href: "", x: 0, y: 0 };
  if (bundlePopupDetected) {
    await safeScreenshot("06-bundle-popup-open");
    const result = await activePage.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [aria-modal="true"], dialog'
      )).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height > 100;
      });

      let modal: HTMLElement | null = null;
      for (const cand of dialogs) {
        const t = (cand.textContent ?? "").toLowerCase();
        if (t.includes("car rental") || t.includes("explore packages") || t.includes("bundle")) {
          modal = cand;
          break;
        }
      }

      if (!modal) {
        const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
        const candidates = allEls.filter(el => {
          const t = (el.textContent ?? "").toLowerCase();
          const r = el.getBoundingClientRect();
          return r.width > 200 && r.height > 200 &&
                 r.width < window.innerWidth * 0.95 &&
                 (t.includes("car rental dates") || t.includes("explore packages") ||
                  (t.includes("bundle & save") && t.includes("includes your selected flight"))) &&
                 el.querySelectorAll("button, a").length >= 1;
        });
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (ra.width * ra.height) - (rb.width * rb.height);
        });
        modal = candidates[0] ?? null;
      }

      if (!modal) {
        return { found: false, reason: "modal not found", source: "none", modalSize: "", noThanksText: "", btnHtml: "", href: "", x: 0, y: 0 };
      }

      const modalRect = modal.getBoundingClientRect();
      const source = dialogs.includes(modal) ? "aria-dialog" : "text-fallback";
      const size = `${Math.round(modalRect.width)}x${Math.round(modalRect.height)}`;

      const candidates = Array.from(modal.querySelectorAll<HTMLElement>('button, a, [role="button"]'));
      const visibleText = (el: HTMLElement) => (el.innerText ?? "").trim().toLowerCase();
      const accessibleText = (el: HTMLElement) =>
        (((el.textContent ?? "").trim() + " " + (el.getAttribute("aria-label") ?? "") + " " + (el.getAttribute("title") ?? "")).trim().toLowerCase());
      const noThanks = candidates.find(el => {
        const t = visibleText(el);
        const r = el.getBoundingClientRect();
        return (t === "no thanks" || t === "no, thanks" || t.startsWith("no thanks") || t.startsWith("no, thanks")) &&
               r.width >= 80 && r.height >= 20;
      });

      const dismissBtn = noThanks ?? candidates.find(el => {
        const t = accessibleText(el);
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (
          t.includes("dismiss") ||
          t.includes("close") ||
          (el.id ?? "").toLowerCase().includes("dismiss")
        );
      });

      if (!dismissBtn) {
        return { found: false, reason: "no dismiss button in modal", source, modalSize: size, noThanksText: "", btnHtml: "", href: "", x: 0, y: 0 };
      }

      dismissBtn.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
      const clicked = (() => {
        try {
          dismissBtn.click();
          return true;
        } catch {
          return false;
        }
      })();
      const r = dismissBtn.getBoundingClientRect();
      const txt = ((dismissBtn.textContent ?? "").trim() || dismissBtn.getAttribute("aria-label") || dismissBtn.getAttribute("title") || "").slice(0, 40);
      return {
        found: true,
        reason: `${noThanks ? "no-thanks" : "dismiss"}:${clicked ? "dom-clicked" : "coords-fallback"}`,
        source,
        modalSize: size,
        noThanksText: txt,
        btnHtml: dismissBtn.outerHTML.slice(0, 200),
        href: dismissBtn instanceof HTMLAnchorElement ? dismissBtn.href : (dismissBtn.getAttribute("href") ?? ""),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    }).catch((err: Error) => ({ found: false, reason: `evaluate error: ${err.message?.slice(0, 80)}`, source: "error", modalSize: "", noThanksText: "", btnHtml: "", href: "", x: 0, y: 0 }));
    bundleDiag = { reason: result.reason, source: result.source, modalSize: result.modalSize, noThanksText: result.noThanksText, btnHtml: result.btnHtml, href: result.href, x: result.x, y: result.y };
    if (result.found) {
      trace(`[flight-rpa] Bundle dismiss located: ${bundleDiag.source} size=${bundleDiag.modalSize} text="${bundleDiag.noThanksText}" reason=${bundleDiag.reason} coords=(${Math.round(bundleDiag.x)},${Math.round(bundleDiag.y)})`);
      trace(`[flight-rpa] Bundle btn html: ${bundleDiag.btnHtml.slice(0, 150)}`);
      if (!bundleDiag.reason.endsWith("dom-clicked")) {
        await new Promise(r => setTimeout(r, 400));
        await safeMouseClick(activePage, bundleDiag.x, bundleDiag.y);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        await new Promise(r => setTimeout(r, 1500));
      }
      await safeScreenshot("07-after-bundle-click");

      // Verify dialog actually closed
      const bundleStillOpen = await isExpediaFlightBundlePopupVisible(activePage);
      trace(`[flight-rpa] Bundle dialog still open after click: ${bundleStillOpen}`);
      bundleDismissed = !bundleStillOpen;
      if (bundleStillOpen) {
        const closedPicker = await dismissForcedChoiceDatePicker();
        if (closedPicker) {
          const retried = await page.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
              .filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 100 && r.height > 100;
              });
            const modal = dialogs.find(el => {
              const text = (el.textContent ?? "").toLowerCase();
              return text.includes("car rental dates") ||
                text.includes("explore packages") ||
                (text.includes("bundle & save") && text.includes("includes your selected flight"));
            });
            if (!modal) return false;
            const target = Array.from(modal.querySelectorAll<HTMLElement>('button, a, [role="button"]'))
              .find(el => {
                const visible = (el.innerText ?? "").trim().toLowerCase();
                const text = (((el.textContent ?? "").trim() + " " + (el.getAttribute("aria-label") ?? "") + " " + (el.getAttribute("title") ?? "")).trim()).toLowerCase();
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 &&
                  ((visible.startsWith("no thanks") && r.width >= 80 && r.height >= 20) || text.includes("dismiss") || text.includes("close"));
              });
            if (!target) return false;
            target.click();
            return true;
          }).catch(() => false);
          trace(`[flight-rpa] Bundle dismiss retry after closing date picker: clicked=${retried}`);
          await new Promise(r => setTimeout(r, 1200));
          const bundleStillOpenAfterRetry = await isExpediaFlightBundlePopupVisible(activePage);
          trace(`[flight-rpa] Bundle dialog still open after retry: ${bundleStillOpenAfterRetry}`);
          bundleDismissed = !bundleStillOpenAfterRetry;
        }
      }

      if (bundleDismissed) {
        const fareModalStillOpenAfterBundle = await page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width > 100 && r.height > 100;
            });
          return dialogs.some(el => {
            const text = (el.textContent ?? "").toLowerCase();
            return text.includes("select fare to") || text.includes("select your fare");
          });
        }).catch(() => false);
        trace(`[flight-rpa] Fare modal still open after bundle dismiss: ${fareModalStillOpenAfterBundle}`);

        if (fareModalStillOpenAfterBundle) {
          const retriedFare = await page.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
              .filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 100 && r.height > 100;
              });
            const modal = dialogs.find(el => {
              const text = (el.textContent ?? "").toLowerCase();
              return text.includes("select fare to") || text.includes("select your fare");
            });
            if (!modal) return false;

            const selectBtns = Array.from(modal.querySelectorAll<HTMLButtonElement>('button'))
              .filter(btn => {
                const r = btn.getBoundingClientRect();
                return (btn.textContent ?? "").trim().toLowerCase() === "select" && r.width > 0 && r.height > 0 && !btn.disabled;
              });
            const withPrices = selectBtns.map(btn => {
              let container: HTMLElement | null = btn.parentElement;
              let price = Number.POSITIVE_INFINITY;
              for (let i = 0; i < 8 && container; i++) {
                const match = (container.textContent ?? "").match(/\$(\d{2,4})\b/);
                if (match) {
                  price = parseInt(match[1], 10);
                  break;
                }
                container = container.parentElement;
              }
              return { btn, price };
            }).sort((a, b) => a.price - b.price);

            const target = withPrices[0]?.btn;
            if (!target) return false;
            target.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
            target.click();
            return true;
          }).catch(() => false);
          trace(`[flight-rpa] Retried fare select after bundle dismiss: clicked=${retriedFare}`);
          if (retriedFare) {
            await new Promise(r => setTimeout(r, 2000));
            await safeScreenshot("07b-after-refare-click");

            const bundleReopened = await page.evaluate(() => {
              const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
                .filter(el => {
                  const r = el.getBoundingClientRect();
                  return r.width > 100 && r.height > 100;
                });
              return dialogs.some(el => {
                const text = (el.textContent ?? "").toLowerCase();
                return text.includes("car rental dates") ||
                  text.includes("explore packages") ||
                  (text.includes("bundle & save") && text.includes("includes your selected flight"));
              });
            }).catch(() => false);
            trace(`[flight-rpa] Bundle reopened after re-fare click: ${bundleReopened}`);

            if (bundleReopened) {
              const reDismissed = await page.evaluate(() => {
                const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog'))
                  .filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.width > 100 && r.height > 100;
                  });
                const modal = dialogs.find(el => {
                  const text = (el.textContent ?? "").toLowerCase();
                  return text.includes("car rental dates") ||
                    text.includes("explore packages") ||
                    (text.includes("bundle & save") && text.includes("includes your selected flight"));
                });
                if (!modal) return false;

                const controls = Array.from(modal.querySelectorAll<HTMLElement>('button, a, [role="button"]'));
                const noThanks = controls.find(el => {
                  const text = (el.innerText ?? "").trim().toLowerCase();
                  const r = el.getBoundingClientRect();
                  return r.width > 40 && r.height > 20 &&
                    (text === "no thanks" || text === "no, thanks" || text.startsWith("no thanks") || text.startsWith("no, thanks"));
                });
                const fallback = controls.find(el => {
                  const text = (((el.textContent ?? "").trim() + " " + (el.getAttribute("aria-label") ?? "") + " " + (el.getAttribute("title") ?? "")).trim()).toLowerCase();
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0 &&
                    (text.includes("dismiss") || text.includes("close") || (el.id ?? "").toLowerCase().includes("dismiss"));
                });
                const target = noThanks ?? fallback;
                if (!target) return false;
                target.click();
                return true;
              }).catch(() => false);
              trace(`[flight-rpa] Re-dismissed bundle after re-fare click: clicked=${reDismissed}`);
              await new Promise(r => setTimeout(r, 1500));
              await safeScreenshot("07c-after-redismiss");
            }
          }
        }
      }
    } else {
      trace(`[flight-rpa] Bundle primary dismiss failed: reason="${bundleDiag.reason}" source=${bundleDiag.source}; trying locator fallback`);
      const fallback = await dismissExpediaFlightBundlePopupWithLocator(activePage);
      bundleDiag = {
        reason: fallback.reason,
        source: fallback.source,
        modalSize: bundleDiag.modalSize,
        noThanksText: fallback.text,
        btnHtml: "",
        href: "",
        x: 0,
        y: 0,
      };
      if (fallback.found) {
        trace(`[flight-rpa] Bundle fallback dismiss attempted: source=${fallback.source} reason=${fallback.reason} text="${fallback.text}"`);
        await new Promise(r => setTimeout(r, 1500));
        await safeScreenshot("07-after-bundle-fallback-click");
        const bundleStillOpen = await isExpediaFlightBundlePopupVisible(activePage);
        trace(`[flight-rpa] Bundle dialog still open after fallback: ${bundleStillOpen}`);
        bundleDismissed = !bundleStillOpen;
      }
    }
  } else {
    trace("[flight-rpa] Bundle popup not detected (no car rental form) — skipping");
  }
  if (bundlePopupDetected && !bundleDismissed) {
    trace(`[flight-rpa] Bundle popup not fully dismissed; reason="${bundleDiag.reason}" source=${bundleDiag.source}`);
    await safeScreenshot("99-final-bundle-still-open");
    return {
      reached_checkout: false,
      currentUrl: getUrl(),
      activePage,
      error: `Expedia bundle upsell remained open after dismiss attempts (${bundleDiag.source}:${bundleDiag.reason}). Stop before checkout classification.`,
    };
    trace(`[flight-rpa] Bundle popup NOT fully dismissed — reason="${bundleDiag.reason}" source=${bundleDiag.source}`);
  }
  if (bundleDismissed) {
    trace(`[flight-rpa] Bundle popup dismissed via ${bundleDiag.source} size=${bundleDiag.modalSize} btn="${bundleDiag.noThanksText}"`);
    await new Promise(r => setTimeout(r, 2000));

    const currentUrlAfterBundle = getUrl();
    const bundleHref = bundleDiag.href?.trim();
    if (bundleHref && currentUrlAfterBundle.toLowerCase().includes("flights-search")) {
      try {
        const absoluteHref = new URL(bundleHref, currentUrlAfterBundle).toString();
        if (/flight-information|journeyContinuationId/i.test(absoluteHref)) {
          trace(`[flight-rpa] Bundle href detected — navigating directly to ${absoluteHref.slice(0, 140)}`);
          await activePage.goto(absoluteHref, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(async () => {
            await activePage.evaluate((href: string) => { window.location.href = href; }, absoluteHref);
          });
          await new Promise(r => setTimeout(r, 2500));
          await safeScreenshot("07d-after-bundle-href-nav");
        }
      } catch (err) {
        trace(`[flight-rpa] Bundle href navigation failed: ${(err as Error).message?.slice(0, 100)}`);
      }
    }

    // Expedia sometimes opens the Review page in a new tab after fare selection.
    // Check if any new page appeared and switch to it.
    if (getAllPages) {
      const allPages = getAllPages();
      trace(`[flight-rpa] Open pages after bundle dismiss: ${allPages.length}`);
      const newerPage = allPages.find(p => {
        if (p === page) return false;
        const url = (() => { try { return (p as unknown as { url: () => string }).url().toLowerCase(); } catch { return ""; } })();
        return url.includes("expedia.com") && !url.includes("flights-search");
      });
      if (newerPage) {
        trace(`[flight-rpa] Switching to new tab: ${((() => { try { return (newerPage as unknown as { url: () => string }).url(); } catch { return "?"; } })()).slice(0, 80)}`);
        activePage = newerPage;
      }
    }
    trace(`[flight-rpa] URL after bundle dismiss: ${getUrl().slice(0, 100)}`);
  }

  // ── Step 5: Click "Skip to Checkout" on Review page ───────────────────────
  // Wait for URL to change away from search, or for review page text to appear
  trace("[flight-rpa] Waiting for Review Your Trip page...");
  let reviewFound = false;
  for (let i = 0; i < 40; i++) {   // up to 20s
    await new Promise(r => setTimeout(r, 500));

    // Also check if a new tab opened mid-wait
    if (getAllPages && i % 4 === 0) {
      const allPages = getAllPages();
      const newerPage = allPages.find(p => {
        if (p === page) return false;
        const url = (() => { try { return (p as unknown as { url: () => string }).url().toLowerCase(); } catch { return ""; } })();
        return url.includes("expedia.com") && !url.includes("flights-search");
      });
      if (newerPage && newerPage !== activePage) {
        trace(`[flight-rpa] New tab detected during review wait — switching`);
        activePage = newerPage;
      }
    }

    const check = await activePage.evaluate(() => {
      const t = (document.body.textContent ?? "").toLowerCase();
      const url = document.location.href.toLowerCase();
      // Strict: require actionable button text OR URL change away from flights-search
      const hasActionBtn = t.includes("skip to checkout") || t.includes("next: seats") || t.includes("next: checkout");
      const urlChanged = !url.includes("flights-search");
      return {
        onReview: hasActionBtn || (urlChanged && t.includes("review your trip")),
        url: url.slice(0, 80),
      };
    }).catch(() => ({ onReview: false, url: "" }));
    if (check.onReview) {
      trace(`[flight-rpa] Review page detected at: ${check.url}`);
      reviewFound = true;
      break;
    }
    if (i === 10) trace(`[flight-rpa] Still waiting for review... current URL: ${check.url}`);
  }
  if (!reviewFound) trace("[flight-rpa] Review page not detected after 20s");
  await new Promise(r => setTimeout(r, 600));

  const skipResult = await clickExpediaFlightReviewCheckoutAction(activePage);

  if (skipResult.clicked) {
    trace(`[flight-rpa] Review page action clicked via ${skipResult.source}: "${skipResult.text}"`);
    await new Promise(r => setTimeout(r, 3500));
    await safeScreenshot("08-after-review-checkout-click");
  } else {
    trace(`[flight-rpa] Review page action: no checkout button clicked source=${skipResult.source} error=${skipResult.error ?? ""}`);
  }
  trace(`[flight-rpa] Visible buttons (40 max):`);
  for (const t of skipResult.visibleButtons.slice(0, 40)) trace(`[flight-rpa]   btn: ${t}`);

  // ── Step 6: Handle seat selection page ────────────────────────────────────
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const onSeats = await activePage.evaluate(() => {
      const t = (document.body.textContent ?? "").toLowerCase();
      const url = document.location.href.toLowerCase();
      return !url.includes("flight-information") &&
        !t.includes("review your trip") &&
        (t.includes("choose your seats") || url.includes("/seats"));
    }).catch(() => false);
    if (onSeats) break;
  }

  const onSeatPage = await activePage.evaluate(() => {
    const t = (document.body.textContent ?? "").toLowerCase();
    const url = document.location.href.toLowerCase();
    return !url.includes("flight-information") &&
      !t.includes("review your trip") &&
      (t.includes("choose your seats") || url.includes("/seats"));
  }).catch(() => false);

  if (onSeatPage) {
    trace("[flight-rpa] Seat selection page — clicking Next: Checkout");
    await activePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll<HTMLElement>('button, a'));
      const next = btns.find(b => {
        const t = (b.textContent ?? "").trim().toLowerCase();
        const r = b.getBoundingClientRect();
        return (t.includes("next: checkout") || t.includes("checkout") || t.includes("skip")) && r.width > 0;
      });
      if (next) next.click();
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
  }

  // ── Step 7: Check if we reached checkout ─────────────────────────────────
  const seatConfirm = await activePage.evaluate(() => {
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    const allButtons = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
    const continueBtn = allButtons.find(btn => {
      const text = (btn.textContent ?? "").trim().toLowerCase();
      const rect = btn.getBoundingClientRect();
      return text.includes("continue to checkout") && rect.width > 0 && rect.height > 0;
    });
    if (!continueBtn) {
      return {
        hasSeatConfirm: bodyText.includes("continue without choosing seats"),
        continueTarget: null as { x: number; y: number; text: string } | null,
      };
    }
    continueBtn.scrollIntoView({ block: "center", behavior: "auto" as ScrollBehavior });
    const rect = continueBtn.getBoundingClientRect();
    return {
      hasSeatConfirm:
        bodyText.includes("continue without choosing seats") ||
        (continueBtn.textContent ?? "").toLowerCase().includes("continue to checkout"),
      continueTarget: {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        text: (continueBtn.textContent ?? "").trim().slice(0, 40),
      },
    };
  }).catch(() => ({
    hasSeatConfirm: false,
    continueTarget: null as { x: number; y: number; text: string } | null,
  }));

  if (seatConfirm.hasSeatConfirm && seatConfirm.continueTarget) {
    trace(`[flight-rpa] Seat confirmation modal — clicking ${seatConfirm.continueTarget.text} @(${Math.round(seatConfirm.continueTarget.x)},${Math.round(seatConfirm.continueTarget.y)})`);
    await safeMouseClick(activePage, seatConfirm.continueTarget.x, seatConfirm.continueTarget.y);
    await new Promise(r => setTimeout(r, 2500));
    await safeScreenshot("08-after-seat-confirm");
  }

  const currentUrl = getUrl();
  const checkoutSignals = await activePage.evaluate(() => {
    const bodyText = document.body.textContent ?? "";
    const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter(input => {
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && input.type !== "hidden";
      })
      .map(input => [
        input.name ?? "",
        input.id ?? "",
        input.placeholder ?? "",
        input.getAttribute("aria-label") ?? "",
        input.getAttribute("autocomplete") ?? "",
      ].join(" ").toLowerCase());
    return { bodyText, visibleInputs };
  }).catch(() => ({ bodyText: "", visibleInputs: [] as string[] }));
  const checkoutState = classifyExpediaFlightCheckoutState({
    currentUrl,
    bodyText: checkoutSignals.bodyText,
    visibleInputDescriptions: checkoutSignals.visibleInputs,
  });
  trace(
    `[flight-rpa] Checkout state: onCheckout=${checkoutState.onCheckout} reason=${checkoutState.reason} ` +
    `stillOnSearch=${checkoutState.stillOnSearch} bundle=${checkoutState.bundlePopupVisible} ` +
    `travelerCopy=${checkoutState.hasTravelerCopy} travelerFields=${checkoutState.hasTravelerFields}`
  );

  if (!checkoutState.onCheckout) {
    const finalBoundary = await detectSafetyBoundary(activePage);
    if (finalBoundary) {
      trace(`[flight-rpa] Login/OTP/CAPTCHA boundary detected before checkout: ${finalBoundary}`);
      await safeScreenshot("99-final-safety-boundary");
      return {
        reached_checkout: false,
        currentUrl,
        error: `Expedia flight ${finalBoundary} reached. Stop for manual intervention; do not bypass login, OTP, or CAPTCHA.`,
      };
    }
    trace(`[flight-rpa] Did not reach checkout — currentUrl=${currentUrl.slice(0, 80)}`);
    await safeScreenshot("99-final-not-checkout");
    return { reached_checkout: false, currentUrl, error: `Could not navigate to checkout (${checkoutState.reason}). Please book manually.` };
  }

  trace("[flight-rpa] Reached checkout — handing off to AI form fill in executor");
  await safeScreenshot("99-final-checkout");
  return { reached_checkout: true, currentUrl: getUrl(), activePage };
}

export const expediaProvider: BrowserProvider = {
  id: "expedia",

  matchesUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("expedia.com") && !lower.includes("hotels.com");
  },

  async setup(_page: Page, context: unknown, trace: (msg: string) => void): Promise<void> {
    // Inject saved Expedia session cookies so the agent starts already logged in.
    // Cookies are saved via the "Connect Accounts" flow in the Permissions page.
    try {
      const cookiePath = path.join(process.cwd(), ".booking-cookies", "expedia.json");
      if (fs.existsSync(cookiePath)) {
        const { cookies } = JSON.parse(fs.readFileSync(cookiePath, "utf-8")) as { cookies: unknown[] };
        if (cookies?.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (context as any).addCookies(cookies);
          trace(`[expedia] setup: injected ${cookies.length} saved session cookies (logged-in state)`);
        }
      } else {
        trace("[expedia] setup: no saved cookies found — proceeding as guest");
      }
    } catch (err) {
      trace(`[expedia] setup: cookie injection failed (${err}) — proceeding as guest`);
    }
    trace("[expedia] setup: watching for external-site redirects (IHG, Marriott, Hilton, etc.)");
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    const searchResults =
      lowerUrl.includes("/hotel-search") ||
      lowerUrl.includes("/hotels");

    // Expedia hotel detail URL formats:
    //   /h/12345  (old format)
    //   .h12345.  (new: "City-Hotels-Name.h12345.Hotel-Information")
    const hotelDetail =
      /\/h\/\d+/.test(lowerUrl) ||
      /[./]h\d+[./]/.test(lowerUrl) ||
      (lowerUrl.includes("/hotel/") && !lowerUrl.includes("/checkout"));

    const isCheckout = lowerUrl.includes("/checkout");

    // /checkout/session/ is the Expedia payment step URL pattern (card fields in cross-origin iframe)
    // /checkout/info/ or /checkout/ root is the guest details step
    const isPaymentSessionUrl = lowerUrl.includes("/checkout/session");

    // Guest details step: on checkout and guest info fields are visible
    // NOTE: some Expedia hotels combine guest + payment on /checkout/session (single-page checkout)
    const guestDetailsStep = isCheckout && await page.evaluate(() => {
      const hasNameInput = !!document.querySelector('input[id*="firstName"], input[id*="lastName"], input[name*="firstName"], input[name*="lastName"], input[autocomplete*="given-name"], input[autocomplete*="family-name"]');
      const hasEmailInput = !!document.querySelector('input[type="email"], input[id*="email"], input[name*="email"]');
      return hasNameInput || hasEmailInput;
    }).catch(() => false);

    // Payment step: URL-based (most reliable) OR inline card input visible
    const paymentStep = isPaymentSessionUrl || (isCheckout && await page.evaluate(() => {
      const cardInput = document.querySelector<HTMLInputElement>(
        'input[id*="cardNumber"], input[name*="cardNumber"], input[id*="card-number"], ' +
        'input[autocomplete="cc-number"], input[placeholder*="Card number"], ' +
        'input[placeholder*="card number"]'
      );
      return !!(cardInput && cardInput.offsetParent !== null);
    }).catch(() => false));

    return {
      searchResults,
      hotelDetail,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: paymentStep as boolean,
    };
  },

  async fillGuestForm(page: Page, profile: unknown, _helpers: unknown, trace: (msg: string) => void): Promise<void> {
    await fillExpediaGuestForm(page, profile as ExpediaGroupProfile & { first_name?: string; last_name?: string; email?: string; phone?: string }, trace);
  },

  async fillPaymentForm(page: Page, profile: unknown, _helpers: unknown, trace: (msg: string) => void): Promise<void> {
    await fillExpediaGroupPaymentForm(page, profile as ExpediaGroupProfile, trace);
  },

  getBotPatterns(): string[] {
    return [
      "show us your human side",
      "bot or not",
      "we can't tell if you're a human",
      "please type the numbers you hear",
    ];
  },
};

// Register with the global provider registry
registerProvider(expediaProvider);
