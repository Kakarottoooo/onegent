import fs from "fs";
import path from "path";
import type { Frame, Locator, Page } from "playwright";
import { safePressEscape } from "../shared/playwright-safe";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";
import {
  evaluateLocatorElement,
  normalizeDigits as normalizeFieldDigits,
  normalizeLooseText,
} from "../shared/field-utils";

const BOOKING_COM_PAYMENT_IFRAME_SELECTORS = [
  'iframe[src*="paymentcomponent.booking.com"]',
  'iframe[title*="Payment"]',
  'iframe[name*="payment"]',
];

const BOOKING_COM_PAYMENT_IFRAME_SELECTOR = BOOKING_COM_PAYMENT_IFRAME_SELECTORS.join(", ");

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
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

function getBookingComPaymentFrames(rawPage: Page): Frame[] {
  return rawPage.frames().filter((frame) => {
    if (frame === rawPage.mainFrame()) return false;
    const url = getScopeUrl(frame).toLowerCase();
    return url.includes("paymentcomponent.booking.com") || url.includes("/payment");
  });
}

type PaymentScope = Page | Frame;
type PaymentFieldLocator = {
  isVisible: (options?: { timeout?: number }) => Promise<boolean>;
  inputValue: () => Promise<string>;
  fill: (value: string) => Promise<unknown>;
  click: (options?: { button?: "left" | "right" | "middle"; clickCount?: number }) => Promise<unknown>;
  count: () => Promise<number>;
  first: () => PaymentFieldLocator;
  nth: (index: number) => PaymentFieldLocator;
  textContent?: () => Promise<string | null>;
  innerText?: () => Promise<string>;
  type?: (text: string, options?: { delay?: number }) => Promise<unknown>;
  blur?: () => Promise<unknown>;
  pressSequentially?: (text: string, options?: { delay?: number }) => Promise<unknown>;
  evaluate?: <T>(pageFunction: (element: Element) => T) => Promise<T>;
};

function getBookingComPaymentScopes(rawPage: Page): PaymentScope[] {
  return [...getBookingComPaymentFrames(rawPage), rawPage];
}

function clipDiagnosticText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

export interface BookingComProfile {
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
}

export interface BookingComHelpers {
  normalizeText: (value: string) => string;
  normalizeLooseText: (value: string) => string;
  normalizeDigits: (value: string) => string;
  findVisibleField: (rawPage: Page, patterns: string[]) => Promise<Locator | null>;
  fillLocator: (locator: Locator, value: string) => Promise<boolean>;
  evaluateLocatorElement: <T>(
    locator: Locator,
    pageFunction: (element: Element, arg: string) => T,
    arg: string
  ) => Promise<T>;
  waitForEvaluateCondition: <TArg>(
    rawPage: Page,
    evaluator: (arg: TArg) => boolean,
    arg: TArg,
    timeoutMs?: number,
    intervalMs?: number
  ) => Promise<boolean>;
  safePressEscape: (rawPage: Page) => Promise<void>;
  safeMouseClick: (rawPage: Page, x: number, y: number) => Promise<void>;
  waitForPageSignals: (
    rawPage: Page,
    options: {
      fromUrl?: string;
      untilUrlIncludes?: string[];
      untilUrlExcludes?: string[];
      untilTextIncludes?: string[];
      untilTextExcludes?: string[];
      timeoutMs?: number;
    }
  ) => Promise<boolean>;
}

export interface BookingComEnteredValues {
  fullName: boolean;
  firstName: boolean;
  lastName: boolean;
  email: boolean;
  phone: boolean;
  cardNumber: boolean;
  cardExpiry: boolean;
}

export interface BookingComVerificationResult {
  pageHasIdentityFields: boolean;
  pageHasFullNameField: boolean;
  pageHasFirstNameField: boolean;
  pageHasLastNameField: boolean;
  pageHasEmailField: boolean;
  pageHasPhoneField: boolean;
  identityOk: boolean;
  cardOk: boolean;
  hasMinimumFilledProfile: boolean;
  visiblePaymentInputs: boolean;
  paymentSignalsVisible: boolean;
  cardTypeRequired: boolean;
  cardTypeSelected: boolean;
  readyForManualPaymentCompletion: boolean;
  paymentFieldVisibility: { cardholder: boolean; cardNumber: boolean; cardExpiry: boolean };
  paymentFieldVerification: { cardholder: boolean; cardNumber: boolean; cardExpiry: boolean };
}

export type BookingComHotelRuntimeBoundary =
  | "payment_manual_review_reached"
  | "guest_details_manual_review_reached"
  | "room_selection_manual_review_reached"
  | "login_or_captcha_boundary"
  | "provider_no_availability"
  | "provider_selector_drift"
  | "room_selection_drift"
  | "network_provider_failure"
  | "insufficient_evidence";

export interface BookingComHotelResultCandidate {
  index: number;
  title: string;
  href: string;
  cta: string;
  score: number;
  matchedTarget: boolean;
  visible: boolean;
  snippet: string;
}

export interface BookingComHotelResultCandidateCapture {
  targetHotelName: string;
  normalizedTarget: string;
  candidateCount: number;
  targetVisible: boolean;
  targetHref: string | null;
  candidates: BookingComHotelResultCandidate[];
  summary: string;
}

export interface BookingComRoomSelectionEvidence {
  roomSectionVisible: boolean;
  roomCardCount: number;
  roomQuantitySelectCount: number;
  selectedRoomCount: number;
  reserveControlVisible: boolean;
  guestDetailsVisible: boolean;
  paymentBoundaryVisible: boolean;
  loginOrCaptchaVisible: boolean;
  noAvailabilityVisible: boolean;
  selectorDriftLikely: boolean;
  summary: string;
}

export interface BookingComHotelRuntimeBoundaryClassification {
  state: BookingComHotelRuntimeBoundary;
  reason: string;
}

export interface BookingComHotelRuntimeBoundaryInput {
  currentUrl?: string | null;
  pageText?: string | null;
  resultCandidates?: BookingComHotelResultCandidateCapture | null;
  roomEvidence?: BookingComRoomSelectionEvidence | null;
}

export interface BookingComStayParamsEvidence {
  checkin: string | null;
  checkout: string | null;
  adults: number | null;
  rooms: number | null;
  summary: string;
}

export interface BookingComSoftSignInPromptResult {
  dismissed: boolean;
  reason: string;
  clickedText?: string;
}

type BookingComGuestFieldKey =
  | "full_name"
  | "first_name"
  | "last_name"
  | "email"
  | "address_line1"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "phone";

type BookingComGuestFieldScan = {
  locator: Locator;
  key: BookingComGuestFieldKey | null;
  label: string;
  normalizedLabel: string;
  required: boolean;
  optional: boolean;
  empty: boolean;
  tagName: string;
  inputType: string;
  value: string;
  options: string[];
  ariaInvalid: boolean;
};

const BOOKING_COM_OPTIONAL_GUEST_FIELD_PATTERNS = [
  "optional",
  "special requests",
  "arrival time",
  "estimated arrival time",
  "traveling for work",
  "travelling for work",
  "booking for someone else",
  "main guest",
  "paperless confirmation",
  "travel protection",
  "trip protection",
  "insurance",
  "crib",
  "extra bed",
  "add to your stay",
  "airport taxi",
  "renting a car",
  "flight for my trip",
  "promo code",
];

const BOOKING_COM_HOTEL_RUNTIME_IGNORED_TOKENS = new Set([
  "hotel",
  "hotels",
  "the",
  "by",
  "and",
  "a",
  "an",
]);

function normalizeHotelRuntimeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBookingComHotelTargetTokens(targetHotelName: string): string[] {
  return normalizeHotelRuntimeText(targetHotelName)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !BOOKING_COM_HOTEL_RUNTIME_IGNORED_TOKENS.has(token));
}

export function summarizeBookingComHotelResultCandidateCapture(
  capture: BookingComHotelResultCandidateCapture,
): string {
  const top = capture.candidates.slice(0, 3).map((candidate) => {
    const title = clipDiagnosticText(candidate.title || candidate.snippet || "(untitled)", 80);
    return `${title} score=${candidate.score}${candidate.matchedTarget ? " target" : ""}`;
  });
  return [
    `candidates=${capture.candidateCount}`,
    `targetVisible=${capture.targetVisible}`,
    capture.targetHref ? `targetHref=${clipDiagnosticText(capture.targetHref, 120)}` : "targetHref=none",
    top.length > 0 ? `top=${top.join(" | ")}` : "top=none",
  ].join("; ");
}

export function summarizeBookingComRoomSelectionEvidence(
  evidence: Omit<BookingComRoomSelectionEvidence, "summary">,
): string {
  return [
    `roomSectionVisible=${evidence.roomSectionVisible}`,
    `roomCardCount=${evidence.roomCardCount}`,
    `roomQuantitySelectCount=${evidence.roomQuantitySelectCount}`,
    `selectedRoomCount=${evidence.selectedRoomCount}`,
    `reserveControlVisible=${evidence.reserveControlVisible}`,
    `guestDetailsVisible=${evidence.guestDetailsVisible}`,
    `paymentBoundaryVisible=${evidence.paymentBoundaryVisible}`,
    `loginOrCaptchaVisible=${evidence.loginOrCaptchaVisible}`,
    `noAvailabilityVisible=${evidence.noAvailabilityVisible}`,
    `selectorDriftLikely=${evidence.selectorDriftLikely}`,
  ].join("; ");
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateFromBookingComSplitParams(params: URLSearchParams, prefix: "checkin" | "checkout"): string | null {
  const year = params.get(`${prefix}_year`);
  const month = params.get(`${prefix}_month`);
  const day = params.get(`${prefix}_monthday`);
  if (!year || !month || !day) return null;
  if (!/^\d{4}$/.test(year)) return null;
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

export function extractBookingComStayParamsFromUrl(url: string): BookingComStayParamsEvidence {
  const empty: BookingComStayParamsEvidence = {
    checkin: null,
    checkout: null,
    adults: null,
    rooms: null,
    summary: "checkin=unknown; checkout=unknown; adults=unknown; rooms=unknown",
  };

  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const checkin = params.get("checkin") ?? dateFromBookingComSplitParams(params, "checkin");
    const checkout = params.get("checkout") ?? dateFromBookingComSplitParams(params, "checkout");
    const adults = parsePositiveInteger(params.get("group_adults"));
    const rooms = parsePositiveInteger(params.get("no_rooms"));
    const evidence: BookingComStayParamsEvidence = {
      checkin,
      checkout,
      adults,
      rooms,
      summary: [
        `checkin=${checkin ?? "unknown"}`,
        `checkout=${checkout ?? "unknown"}`,
        `adults=${adults ?? "unknown"}`,
        `rooms=${rooms ?? "unknown"}`,
      ].join("; "),
    };
    return evidence;
  } catch {
    return empty;
  }
}

export function shouldStopBookingComBeforePaymentAutomation(task: string): boolean {
  const normalized = task.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  if (/\bstop\s+before\s+(payment|cvv|cvc|security code|final|confirmation|complete booking)\b/.test(normalized)) {
    return true;
  }

  const manualReviewIntent = containsAny(normalized, [
    "manual hotel booking review",
    "manual hotel booking",
    "manual-review boundary",
    "manual review boundary",
    "safe manual-review boundary",
    "safe manual review boundary",
    "public booking.com pages",
    "public search/detail/room-selection pages",
  ]);

  const paymentHardStopIntent =
    containsAny(normalized, [
      "do not enter payment",
      "do not enter card",
      "do not click any final reserve",
      "do not click any final reserve, confirm",
      "do not click any final",
      "payment submission control",
      "card entry",
      "cvv/cvc/security code",
      "cvv/security code",
      "billing details",
      "final reserve",
      "complete booking",
      "final booking confirmation",
      "hard stop immediately",
      "if it is unclear whether a button is final",
    ]) ||
    /hard stop.{0,220}(payment|card entry|cvv|cvc|security code|billing|final reserve|complete booking|purchase|pay|submit)/.test(normalized);

  const completionStopIntent =
    /\bdo not complete (the )?booking\b/.test(normalized) ||
    /\bstop at the first safe manual[-\s]review boundary\b/.test(normalized);

  return manualReviewIntent && (paymentHardStopIntent || completionStopIntent);
}

export async function dismissBookingComSoftSignInPrompt(
  rawPage: Page,
  traceLog: (msg: string) => void = () => {},
): Promise<BookingComSoftSignInPromptResult> {
  const result: BookingComSoftSignInPromptResult = await rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const jsdomLike =
        rect.width === 0 &&
        rect.height === 0 &&
        window.navigator.userAgent.toLowerCase().includes("jsdom");
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.hidden &&
        (rect.width > 0 && rect.height > 0 || jsdomLike)
      );
    };

    const bodyText = normalize(document.body?.innerText ?? document.body?.textContent ?? "");
    const accountSensitiveSignals = [
      "sign in to continue",
      "log in to continue",
      "login required",
      "sign in required",
      "account verification",
      "verify your account",
      "verification code",
      "enter your password",
      "password",
      "otp",
      "sms code",
      "captcha",
      "human verification",
      "phone verification",
      "verify you are human",
    ];
    if (accountSensitiveSignals.some((signal) => bodyText.includes(signal))) {
      return { dismissed: false, reason: "account-sensitive boundary visible" };
    }

    const optionalSignals = [
      "sign in and save",
      "sign in, save money",
      "sign in to save",
      "save money",
      "member prices",
      "genius",
      "unlock",
      "create an account to",
      "log in for member prices",
      "one click away from cheaper prices",
    ];
    const hasOptionalPrompt = optionalSignals.some((signal) => bodyText.includes(signal));
    if (!hasOptionalPrompt) {
      return { dismissed: false, reason: "no optional sign-in prompt visible" };
    }

    const promptScopes = Array.from(
      document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true'], div, section")
    )
      .filter((element) => isVisible(element))
      .filter((element) => {
        const text = normalize(element.textContent ?? "");
        return optionalSignals.some((signal) => text.includes(signal));
      })
      .sort((left, right) => {
        const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height;
        const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height;
        return leftArea - rightArea;
      });

    const scopes = promptScopes.length > 0 ? promptScopes : [document.body as HTMLElement];
    const closeTextExact = new Set(["close", "dismiss", "no thanks", "not now", "maybe later", "skip", "x", "×"]);
    const unsafeActionSignals = ["sign in", "log in", "register", "create account", "create an account", "join", "unlock"];

    for (const scope of scopes) {
      const controls = Array.from(scope.querySelectorAll<HTMLElement>("button, [role='button'], a"));
      for (const control of controls) {
        if (!isVisible(control)) continue;
        const visibleText = normalize(control.textContent ?? "");
        const ariaLabel = normalize(control.getAttribute("aria-label") ?? "");
        const title = normalize(control.getAttribute("title") ?? "");
        const combined = [visibleText, ariaLabel, title].filter(Boolean).join(" ");
        if (!combined) continue;
        if (unsafeActionSignals.some((signal) => combined.includes(signal))) continue;
        const isCloseControl =
          closeTextExact.has(visibleText) ||
          closeTextExact.has(ariaLabel) ||
          closeTextExact.has(title) ||
          ariaLabel.includes("close") ||
          title.includes("close") ||
          visibleText.includes("no thanks") ||
          visibleText.includes("not now") ||
          visibleText.includes("maybe later") ||
          visibleText.includes("dismiss");
        if (!isCloseControl) continue;
        control.click();
        return {
          dismissed: true,
          reason: "dismissed optional sign-in/member prompt",
          clickedText: visibleText || ariaLabel || title,
        };
      }
    }

    return { dismissed: false, reason: "optional sign-in prompt visible but no safe close control found" };
  }).catch(() => ({ dismissed: false, reason: "soft sign-in prompt check failed" }));

  if (result.dismissed) {
    const waitForTimeout = (rawPage as { waitForTimeout?: (timeout: number) => Promise<unknown> }).waitForTimeout;
    if (typeof waitForTimeout === "function") {
      await waitForTimeout.call(rawPage, 300).catch(() => {});
    }
    traceLog(`Booking.com sign-in prompt: ${result.reason}${result.clickedText ? ` via "${result.clickedText}"` : ""}.`);
  }

  return result;
}

export function classifyBookingComHotelRuntimeBoundary(
  input: BookingComHotelRuntimeBoundaryInput,
): BookingComHotelRuntimeBoundaryClassification {
  const currentUrl = (input.currentUrl ?? "").toLowerCase();
  const pageText = (input.pageText ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const resultCandidates = input.resultCandidates ?? null;
  const roomEvidence = input.roomEvidence ?? null;

  if (
    roomEvidence?.loginOrCaptchaVisible ||
    /\b(captcha|otp|phone verification|two[-\s]?factor|2fa)\b/.test(pageText) ||
    /\b(sign in|log in|login)\b.{0,80}\b(required|to continue|wall|prompt)\b/.test(pageText) ||
    /\b(bot detection|security check|verify you are human|are you a robot|automated access)\b/.test(pageText)
  ) {
    return {
      state: "login_or_captcha_boundary",
      reason: "Login, OTP, CAPTCHA, phone verification, or bot-check boundary is visible.",
    };
  }

  if (
    roomEvidence?.paymentBoundaryVisible ||
    (isBookingComCheckoutUrl(currentUrl) && containsAny(pageText, [
      "your payment details",
      "payment method",
      "credit or debit card",
      "card number",
      "security code",
      "cvv",
      "complete booking",
      "confirm and pay",
    ]))
  ) {
    return {
      state: "payment_manual_review_reached",
      reason: "Payment or final confirmation controls are visible; stop for manual review before CVV, payment, or final confirmation.",
    };
  }

  if (
    roomEvidence?.guestDetailsVisible ||
    (isBookingComCheckoutUrl(currentUrl) && containsAny(pageText, [
      "enter your details",
      "your details",
      "first name",
      "last name",
      "email address",
      "phone number",
      "next: final details",
    ]))
  ) {
    return {
      state: "guest_details_manual_review_reached",
      reason: "Guest-details step is visible before payment/final confirmation.",
    };
  }

  if (
    roomEvidence?.noAvailabilityVisible ||
    containsAny(pageText, [
      "sold out",
      "fully booked",
      "no rooms available",
      "no availability",
      "no rates available",
      "unavailable for your dates",
      "no properties match",
      "no available properties",
    ]) ||
    (resultCandidates && resultCandidates.candidateCount === 0 && isBookingComSearchResultsUrl(currentUrl))
  ) {
    return {
      state: "provider_no_availability",
      reason: "Booking.com shows no matching available inventory for the approved hotel/dates.",
    };
  }

  if (resultCandidates?.targetVisible) {
    return {
      state: "provider_selector_drift",
      reason: "Target hotel candidate is visible but runtime did not reach the property detail page.",
    };
  }

  if (roomEvidence?.roomSectionVisible && (
    roomEvidence.roomCardCount > 0 ||
    roomEvidence.roomQuantitySelectCount > 0 ||
    roomEvidence.selectedRoomCount > 0 ||
    roomEvidence.reserveControlVisible
  )) {
    return {
      state: "room_selection_manual_review_reached",
      reason: "Room inventory or reserve controls are visible on the hotel detail page.",
    };
  }

  if (
    roomEvidence?.selectorDriftLikely ||
    (currentUrl.includes("booking.com/hotel/") && !currentUrl.includes("booking.com/book") && containsAny(pageText, [
      "room type",
      "select rooms",
      "reserve",
      "availability",
    ]))
  ) {
    return {
      state: "room_selection_drift",
      reason: "Hotel detail page is present but room/card controls were not selectable.",
    };
  }

  if (/\b(500|502|503|504|gateway timeout|temporarily unavailable|something went wrong|net::err_)\b/i.test(pageText)) {
    return {
      state: "network_provider_failure",
      reason: "Booking.com or the browser reported a degraded provider/network response.",
    };
  }

  return {
    state: "insufficient_evidence",
    reason: "No known Booking.com hotel runtime boundary was visible in the captured evidence.",
  };
}

function isBookingComCheckoutUrl(currentUrl: string): boolean {
  return currentUrl.includes("secure.booking.com/book") || currentUrl.includes("booking.com/book");
}

export function isBookingComUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("booking.com") || lower.includes("secure.booking.com");
}

export function isBookingComSearchResultsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("booking.com/searchresults");
}

function inferBookingComCardBrand(cardNumber?: string): string | null {
  const digits = (cardNumber ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (/^4/.test(digits)) return "visa";
  if (/^(34|37)/.test(digits)) return "american express";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "mastercard";
  if (/^(6011|65|64[4-9])/.test(digits)) return "discover";
  if (/^(352[89]|35[3-8]\d)/.test(digits)) return "jcb";
  if (/^(30[0-5]|36|38|39)/.test(digits)) return "diners club";
  return null;
}

export function looksLikeBookingComGuestDetailsStep(pageText: string, currentUrl: string): boolean {
  if (!isBookingComCheckoutUrl(currentUrl)) return false;

  const normalized = pageText.toLowerCase();
  const hasGuestStepSignals = containsAny(normalized, [
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

  const hasFinalPaymentSignals = containsAny(normalized, [
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

export function looksLikeBookingComHotelDetailPage(pageText: string, currentUrl: string): boolean {
  const isBookingComHotelUrl =
    currentUrl.includes("booking.com/hotel/") &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");
  if (!isBookingComHotelUrl) return false;

  const normalized = pageText.toLowerCase();
  const hasRoomSelectionSignals = containsAny(normalized, [
    "select a room type and the number of rooms you want to reserve",
    "select rooms",
    "room type",
    "today's price",
    "your options",
    "i'll reserve",
    "i will reserve",
    "sleeps:",
  ]);

  const hasDetailTabs = containsAny(normalized, [
    "overview",
    "prices",
    "amenities",
    "house rules",
    "important and legal info",
    "guest reviews",
  ]);

  const hasHotelDetailSignals = containsAny(normalized, [
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

  const hasRealCheckoutSignals = containsAny(normalized, [
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

export async function getBookingComStageSignals(
  rawPage: Page,
  currentUrl: string,
  pageText: string,
  visibleCheckoutFields: boolean
): Promise<{
  isBookingCom: boolean;
  searchResults: boolean;
  hotelDetailPage: boolean;
  hotelDetailUrl: boolean;
  nonCheckoutUrl: boolean;
  guestDetailsStep: boolean;
  finalPaymentState: boolean;
}> {
  const finalPaymentState = await isBookingComFinalPaymentDomState(rawPage, currentUrl);
  const guestDetailsDomState =
    !finalPaymentState &&
    await isBookingComGuestDetailsDomState(rawPage, currentUrl);
  const guestDetailsStep =
    !finalPaymentState &&
    (looksLikeBookingComGuestDetailsStep(pageText, currentUrl) || guestDetailsDomState);
  const searchResults = isBookingComSearchResultsUrl(currentUrl);
  const hotelDetailPage = looksLikeBookingComHotelDetailPage(pageText, currentUrl);
  const hotelDetailUrl =
    currentUrl.includes("booking.com/hotel/") &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");
  const nonCheckoutUrl =
    isBookingComUrl(currentUrl) &&
    !currentUrl.includes("secure.booking.com") &&
    !currentUrl.includes("booking.com/book");

  return {
    isBookingCom: isBookingComUrl(currentUrl),
    searchResults,
    hotelDetailPage,
    hotelDetailUrl,
    nonCheckoutUrl,
    guestDetailsStep: guestDetailsStep && !visibleCheckoutFields ? guestDetailsStep : guestDetailsStep,
    finalPaymentState,
  };
}

export async function isBookingComGuestDetailsDomState(rawPage: Page, currentUrl: string): Promise<boolean> {
  if (!isBookingComCheckoutUrl(currentUrl)) return false;

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

export async function isBookingComFinalPaymentDomState(rawPage: Page, currentUrl: string): Promise<boolean> {
  if (!isBookingComCheckoutUrl(currentUrl)) return false;

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

    // Guard: if "Next: Final details" button is still visible, we are NOT on the
    // final payment page — some hotels show "payment will be handled by the property"
    // text on the guest-details step, which would otherwise cause a false positive.
    const hasNextFinalDetailsButton = Array.from(
      document.querySelectorAll<HTMLElement>("button, a, [role='button']")
    ).some((el) => {
      if (!isVisible(el)) return false;
      return /next[:\s]*final\s*details/i.test(el.textContent ?? "");
    });
    if (hasNextFinalDetailsButton) return false;

    return (hasPaymentTextSignals && hasVisiblePaymentControls) || cardLikeInputs;
  }).catch(() => false);
}

export async function captureBookingComHotelResultCandidates(
  rawPage: Page,
  targetHotelName: string,
): Promise<BookingComHotelResultCandidateCapture> {
  const normalizedTarget = normalizeHotelRuntimeText(targetHotelName);
  const targetTokens = getBookingComHotelTargetTokens(targetHotelName);

  const candidates = await rawPage.evaluate(
    ({ normalizedTarget, targetTokens }) => {
      const titleSelector = [
        "[data-testid='titleLink']",
        "a[data-testid='titleLink']",
        "a[data-testid*='title-link']",
        "[data-testid='title']",
        "[data-testid*='title']",
        "a[href*='/hotel/']",
        "div[role='heading']",
        "span[role='heading']",
        "h1",
        "h2",
        "h3",
      ].join(", ");
      const cardSelector = [
        "[data-testid='card']",
        "[data-testid='property-card']",
        "[data-testid*='property-card']",
        "[data-testid='search-card']",
        "[data-testid*='search-card']",
        ".sr_property_block",
        "[data-testid='property-card-desktop']",
      ].join(", ");
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const cleanTitle = (value: string) =>
        normalize(
          value
            .replace(/opens in new window/gi, " ")
            .replace(/\(\s*hotel\s*\)/gi, " ")
            .replace(/\bfeatured\b/gi, " "),
        );
      const scoreText = (value: string) => {
        const normalized = cleanTitle(value);
        if (!normalized || !normalizedTarget || targetTokens.length === 0) return 0;
        if (normalized === normalizedTarget) return 5000;
        if (normalized.startsWith(`${normalizedTarget} `)) return 4200;
        if (normalized.endsWith(` ${normalizedTarget}`)) return 4000;
        const words = normalized.split(" ").filter(Boolean);
        const matched = targetTokens.filter((token) => words.includes(token)).length;
        if (matched < targetTokens.length) return 0;
        const targetWordSet = new Set(targetTokens);
        const genericExtras = new Set([
          "hotel",
          "hotels",
          "the",
          "by",
          "and",
          "a",
          "an",
          "new",
          "window",
          "open",
          "opens",
          "in",
          "featured",
          "deal",
          "deals",
          "property",
          "properties",
          "us",
        ]);
        const hasMeaningfulExtras = words
          .filter((token) => !targetWordSet.has(token))
          .some((token) => !genericExtras.has(token));
        return hasMeaningfulExtras ? 0 : 1500;
      };
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const jsdomLike =
          rect.width === 0 &&
          rect.height === 0 &&
          window.navigator.userAgent.toLowerCase().includes("jsdom");
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !element.hidden &&
          (rect.width > 0 && rect.height > 0 || jsdomLike)
        );
      };
      const getNearestHref = (element: Element | null) => {
        if (!element) return "";
        const directAnchor =
          element instanceof HTMLAnchorElement
            ? element
            : (element.closest("a[href]") as HTMLAnchorElement | null);
        return directAnchor?.href ?? "";
      };
      const getCtaText = (container: Element) => Array.from(container.querySelectorAll("button, a, [role='button']"))
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" | ");

      const seen = new Set<string>();
      const containers = Array.from(document.querySelectorAll(`${cardSelector}, a[href*='/hotel/']`));
      return containers
        .map((container, index) => {
          if (!isVisible(container)) return null;
          const titleNode =
            container.querySelector(titleSelector) ??
            (container.matches(titleSelector) ? container : null) ??
            container.querySelector("a[href*='/hotel/'], a, h1, h2, h3");
          const title = (titleNode?.textContent ?? container.textContent ?? "").replace(/\s+/g, " ").trim();
          const snippet = (container.textContent ?? title).replace(/\s+/g, " ").trim().slice(0, 220);
          const href = getNearestHref(titleNode ?? container);
          const cta = getCtaText(container);
          const score = Math.max(scoreText(title), scoreText(snippet));
          const key = `${cleanTitle(title)}|${href}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return {
            index,
            title: title.slice(0, 180),
            href,
            cta: cta.slice(0, 120),
            score,
            matchedTarget: score >= 1500,
            visible: true,
            snippet,
          };
        })
        .filter((value): value is BookingComHotelResultCandidate => Boolean(value))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 12);
    },
    { normalizedTarget, targetTokens },
  ).catch(() => [] as BookingComHotelResultCandidate[]);

  const target = candidates.find((candidate) => candidate.matchedTarget) ?? null;
  const capture: BookingComHotelResultCandidateCapture = {
    targetHotelName,
    normalizedTarget,
    candidateCount: candidates.length,
    targetVisible: Boolean(target),
    targetHref: target?.href || null,
    candidates,
    summary: "",
  };
  capture.summary = summarizeBookingComHotelResultCandidateCapture(capture);
  return capture;
}

export async function captureBookingComRoomSelectionEvidence(
  rawPage: Page,
): Promise<BookingComRoomSelectionEvidence> {
  const rawEvidence = await rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const jsdomLike =
        rect.width === 0 &&
        rect.height === 0 &&
        window.navigator.userAgent.toLowerCase().includes("jsdom");
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.hidden &&
        (rect.width > 0 && rect.height > 0 || jsdomLike)
      );
    };
    const bodyText = normalize(document.body?.innerText ?? document.body?.textContent ?? "");
    const roomRoot =
      document.querySelector("#hp_availability_tempcontainer") ||
      document.querySelector(".hprt-table") ||
      document.querySelector("[data-testid*='rooms']") ||
      document.querySelector("[class*='room-list']") ||
      document.querySelector("[class*='roomType']");
    const roomSectionVisible = Boolean(roomRoot && isVisible(roomRoot)) ||
      bodyText.includes("select a room type") ||
      bodyText.includes("select rooms") ||
      bodyText.includes("room type");
    const roomCardCount = Array.from(document.querySelectorAll([
      "#hp_availability_tempcontainer tr",
      ".hprt-table tr",
      "[data-testid*='room']",
      "[class*='room']",
      "[class*='hprt']",
    ].join(", ")))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.textContent ?? "");
        return (
          text.includes("room") ||
          text.includes("sleeps") ||
          text.includes("bed") ||
          text.includes("reserve") ||
          /\$\s*\d/.test(element.textContent ?? "")
        );
      })
      .length;
    const roomSelects = Array.from(document.querySelectorAll("select"))
      .filter((select): select is HTMLSelectElement => {
        if (!(select instanceof HTMLSelectElement) || !isVisible(select)) return false;
        const values = Array.from(select.options).map((option) => option.value);
        return values.includes("0") && values.includes("1");
      });
    const selectedRoomCount = roomSelects.filter((select) => select.value && select.value !== "0").length;
    const reserveControlVisible = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .some((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(element.textContent ?? "");
        return (
          text === "reserve" ||
          text.includes("i'll reserve") ||
          text.includes("i will reserve") ||
          text.includes("reserve now") ||
          text.includes("show prices") ||
          text.includes("select your room") ||
          text.includes("check availability") ||
          text.includes("see availability")
        );
      });
    const guestDetailsVisible = [
      "enter your details",
      "your details",
      "first name",
      "last name",
      "email address",
      "phone number",
      "next: final details",
    ].some((signal) => bodyText.includes(signal));
    const paymentBoundaryVisible = [
      "your payment details",
      "payment method",
      "credit or debit card",
      "card number",
      "security code",
      "cvv",
      "complete booking",
      "confirm and pay",
    ].some((signal) => bodyText.includes(signal));
    const loginOrCaptchaVisible = [
      "captcha",
      "otp",
      "phone verification",
      "verify you are human",
      "are you a robot",
      "security check",
      "bot detection",
      "sign in to continue",
      "log in to continue",
    ].some((signal) => bodyText.includes(signal));
    const noAvailabilityVisible = [
      "sold out",
      "fully booked",
      "no rooms available",
      "no availability",
      "no rates available",
      "unavailable for your dates",
      "no properties match",
      "no available properties",
    ].some((signal) => bodyText.includes(signal));
    const selectorDriftLikely =
      roomSectionVisible &&
      roomSelects.length === 0 &&
      !reserveControlVisible &&
      !guestDetailsVisible &&
      !paymentBoundaryVisible &&
      !loginOrCaptchaVisible &&
      !noAvailabilityVisible;

    return {
      roomSectionVisible,
      roomCardCount,
      roomQuantitySelectCount: roomSelects.length,
      selectedRoomCount,
      reserveControlVisible,
      guestDetailsVisible,
      paymentBoundaryVisible,
      loginOrCaptchaVisible,
      noAvailabilityVisible,
      selectorDriftLikely,
    };
  }).catch(() => ({
    roomSectionVisible: false,
    roomCardCount: 0,
    roomQuantitySelectCount: 0,
    selectedRoomCount: 0,
    reserveControlVisible: false,
    guestDetailsVisible: false,
    paymentBoundaryVisible: false,
    loginOrCaptchaVisible: false,
    noAvailabilityVisible: false,
    selectorDriftLikely: false,
  }));

  return {
    ...rawEvidence,
    summary: summarizeBookingComRoomSelectionEvidence(rawEvidence),
  };
}

async function markBookingComPaymentFieldsInScope(
  scope: PaymentScope
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  return scope.evaluate(() => {
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

async function isEditablePaymentField(locator: PaymentFieldLocator): Promise<boolean> {
  const visible = await locator.isVisible({ timeout: 800 }).catch(() => false);
  if (!visible) return false;

  if (typeof (locator as PaymentFieldLocator).evaluate !== "function") {
    return true;
  }

  const evaluate = locator.evaluate!;
  return evaluate((element) => {
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

async function getPaymentLocatorText(locator: PaymentFieldLocator): Promise<string> {
  if (typeof (locator as PaymentFieldLocator).evaluate !== "function") {
    const parts = await Promise.all([
      typeof locator.textContent === "function" ? locator.textContent().catch(() => "") : Promise.resolve(""),
      typeof locator.innerText === "function" ? locator.innerText().catch(() => "") : Promise.resolve(""),
      locator.inputValue().catch(() => ""),
    ]);
    return parts.filter(Boolean).join(" ");
  }

  const evaluate = locator.evaluate!;
  return evaluate((element) => {
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
    const containerText = htmlElement.closest("label, fieldset, section, form, div")?.textContent ?? "";

    return [labels.join(" "), ariaLabel, placeholder, name, id, autocomplete, title, value, textContent, containerText]
      .filter(Boolean)
      .join(" ");
  }).catch(() => "");
}

async function findVisibleFieldInScope(
  scope: PaymentScope,
  patterns: string[]
): Promise<Locator | null> {
  const fields = scope.locator([
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="month"]',
    'input[type="date"]',
    "textarea",
    "select",
  ].join(", "));
  const count = Math.min(await fields.count().catch(() => 0), 80);

  for (let index = 0; index < count; index += 1) {
    const candidate = fields.nth(index);
    if (!await isEditablePaymentField(candidate)) continue;
    const candidateText = (await getPaymentLocatorText(candidate)).toLowerCase().replace(/\s+/g, " ").trim();
    if (!candidateText) continue;
    for (const pattern of patterns) {
      if (candidateText.includes(pattern.toLowerCase().replace(/\s+/g, " ").trim())) {
        return candidate;
      }
    }
  }

  return null;
}

function getBookingComPaymentFrameLocators(
  rawPage: Page
): Array<ReturnType<Page["frameLocator"]>> {
  return BOOKING_COM_PAYMENT_IFRAME_SELECTORS.map((selector) => rawPage.frameLocator(selector));
}

async function findVisibleFieldInFrameLocator(
  frameLocator: ReturnType<Page["frameLocator"]>,
  patterns: string[]
): Promise<PaymentFieldLocator | null> {
  const fields = frameLocator.locator([
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="search"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="month"]',
    'input[type="date"]',
    "textarea",
    "select",
  ].join(", "));
  const count = Math.min(await fields.count().catch(() => 0), 80);

  for (let index = 0; index < count; index += 1) {
    const candidate = fields.nth(index);
    if (!await isEditablePaymentField(candidate)) continue;
    const candidateText = (await getPaymentLocatorText(candidate)).toLowerCase().replace(/\s+/g, " ").trim();
    if (!candidateText) continue;
    for (const pattern of patterns) {
      if (candidateText.includes(pattern.toLowerCase().replace(/\s+/g, " ").trim())) {
        return candidate;
      }
    }
  }

  return null;
}

function getBookingComPaymentFieldIndex(
  markerKey: "cardholder" | "card-number" | "card-expiry"
): number {
  switch (markerKey) {
    case "cardholder":
      return 0;
    case "card-number":
      return 1;
    case "card-expiry":
      return 2;
  }
}

async function getMarkedPaymentFieldInScope(
  scope: PaymentScope,
  markerKey: "cardholder" | "card-number" | "card-expiry"
): Promise<PaymentFieldLocator | null> {
  const locator = scope.locator(`[data-codex-booking-payment-field="${markerKey}"]`).first();
  if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
    return locator;
  }
  return null;
}

async function findBookingComPaymentField(
  rawPage: Page,
  markerKey: "cardholder" | "card-number" | "card-expiry",
  patterns: string[],
  helpers: BookingComHelpers
): Promise<PaymentFieldLocator | null> {
  const paymentScopes = getBookingComPaymentScopes(rawPage);

  for (const scope of paymentScopes) {
    const marked = await getMarkedPaymentFieldInScope(scope, markerKey);
    if (marked) {
      return marked;
    }
  }

  for (const scope of paymentScopes) {
    if (scope === rawPage) {
      const found = await helpers.findVisibleField(rawPage, patterns);
      if (found) {
        return found;
      }
      continue;
    }

    const found = await findVisibleFieldInScope(scope, patterns);
    if (found) {
      return found;
    }
  }

  for (const frameLocator of getBookingComPaymentFrameLocators(rawPage)) {
    const locator = frameLocator.locator(`[data-codex-booking-payment-field="${markerKey}"]`).first();
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      return locator;
    }
  }

  for (const frameLocator of getBookingComPaymentFrameLocators(rawPage)) {
    const found = await findVisibleFieldInFrameLocator(frameLocator, patterns);
    if (found) {
      return found;
    }
  }

  for (const frameLocator of getBookingComPaymentFrameLocators(rawPage)) {
    const fields = frameLocator.locator([
      'input:not([type])',
      'input[type="text"]',
      'input[type="email"]',
      'input[type="tel"]',
      'input[type="search"]',
      'input[type="number"]',
      'input[type="password"]',
      'input[type="month"]',
      'input[type="date"]',
      "textarea",
      "select",
    ].join(", "));
    const count = await fields.count().catch(() => 0);
    const targetIndex = getBookingComPaymentFieldIndex(markerKey);
    if (count > targetIndex) {
      const candidate = fields.nth(targetIndex);
      if (await candidate.isVisible({ timeout: 800 }).catch(() => false)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function markBookingComPaymentFields(
  rawPage: Page
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  const combined = { cardholder: false, cardNumber: false, cardExpiry: false };
  for (const scope of getBookingComPaymentScopes(rawPage)) {
    const marked = await markBookingComPaymentFieldsInScope(scope);
    combined.cardholder ||= marked.cardholder;
    combined.cardNumber ||= marked.cardNumber;
    combined.cardExpiry ||= marked.cardExpiry;
  }
  return combined;
}

export async function getBookingComPaymentFieldVisibility(
  rawPage: Page,
  currentUrl: string
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  if (!isBookingComCheckoutUrl(currentUrl)) {
    return { cardholder: false, cardNumber: false, cardExpiry: false };
  }

  return markBookingComPaymentFields(rawPage);
}

async function traceBookingComPaymentDiagnostics(
  rawPage: Page,
  traceLog: (msg: string) => void
): Promise<void> {
  const mainDocDiagnostics = await rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && !element.hidden && rect.width > 0 && rect.height > 0;
    };

    const visibleInputs = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter((element) => isVisible(element))
      .slice(0, 12)
      .map((element) => {
        const html = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const labels =
          "labels" in html && html.labels
            ? Array.from(html.labels).map((label) => label.textContent ?? "").join(" ")
            : "";
        return normalize([
          element.tagName,
          element.getAttribute("type") ?? "",
          element.getAttribute("name") ?? "",
          element.getAttribute("id") ?? "",
          element.getAttribute("placeholder") ?? "",
          element.getAttribute("aria-label") ?? "",
          labels,
          element.parentElement?.textContent ?? "",
        ].join(" "));
      });

    const paymentLabels = Array.from(document.querySelectorAll("label, div, span, h2, h3, p"))
      .filter((element) => isVisible(element))
      .map((element) => normalize(element.textContent ?? ""))
      .filter((text) =>
        text.length <= 140 && (
          text.includes("cardholder") ||
          text.includes("name on card") ||
          text.includes("card number") ||
          text.includes("expiration date") ||
          text.includes("expiry date") ||
          text.includes("mm/yy") ||
          text.includes("cvc")
        )
      )
      .slice(0, 8);

    const iframes = Array.from(document.querySelectorAll("iframe"))
      .filter((element) => isVisible(element))
      .map((element) => ({
        src: element.getAttribute("src") ?? "",
        title: element.getAttribute("title") ?? "",
        name: element.getAttribute("name") ?? "",
      }))
      .slice(0, 10);

    return {
      visibleInputCount: visibleInputs.length,
      visibleInputs,
      paymentLabels,
      iframeCount: iframes.length,
      iframes,
    };
  }).catch(() => null);

  if (!mainDocDiagnostics) {
    traceLog("Booking.com payment diagnostics: failed to inspect main document.");
    return;
  }

  traceLog(
    `Booking.com payment diagnostics: mainDoc visibleInputs=${mainDocDiagnostics.visibleInputCount}, paymentLabels=${mainDocDiagnostics.paymentLabels.length}, iframes=${mainDocDiagnostics.iframeCount}.`
  );

  if (mainDocDiagnostics.paymentLabels.length > 0) {
    traceLog(`Booking.com payment diagnostics: payment labels -> ${mainDocDiagnostics.paymentLabels.map((label) => clipDiagnosticText(label, 120)).join(" || ")}`);
  }

  if (mainDocDiagnostics.visibleInputs.length > 0) {
    traceLog(`Booking.com payment diagnostics: visible inputs -> ${mainDocDiagnostics.visibleInputs.map((text) => clipDiagnosticText(text, 140)).join(" || ")}`);
  }

  if (mainDocDiagnostics.iframes.length > 0) {
    traceLog(
      `Booking.com payment diagnostics: visible iframes -> ${mainDocDiagnostics.iframes
        .map((frame) => [frame.title, frame.name, frame.src].filter(Boolean).join(" | ").slice(0, 180))
        .join(" || ")}`
    );
  }

  const frameLocatorCandidates = await rawPage.locator(BOOKING_COM_PAYMENT_IFRAME_SELECTOR).count().catch(() => 0);
  traceLog(`Booking.com payment diagnostics: payment iframe locator candidates=${frameLocatorCandidates}.`);

  if (frameLocatorCandidates > 0) {
    const frameFieldCounts: string[] = [];
    for (const selector of BOOKING_COM_PAYMENT_IFRAME_SELECTORS) {
      const selectorCount = await rawPage.locator(selector).count().catch(() => 0);
      if (selectorCount < 1) continue;
      const frameLocator = rawPage.frameLocator(selector);
      const count = await frameLocator
        .locator('input:not([type]), input[type="text"], input[type="tel"], input[type="number"], input[type="password"], input[type="month"], input[type="date"], textarea, select')
        .count()
        .catch(() => 0);
      frameFieldCounts.push(`${selector} fields=${count}`);
    }
    traceLog(`Booking.com payment diagnostics: frame locator field counts -> ${frameFieldCounts.join(" || ")}`);
  }

  const frameDiagnostics = rawPage.frames()
    .filter((frame) => frame !== rawPage.mainFrame())
    .map((frame) => getScopeUrl(frame))
    .filter(Boolean)
    .slice(0, 10);
  if (frameDiagnostics.length > 0) {
    traceLog(`Booking.com payment diagnostics: playwright frames -> ${frameDiagnostics.join(" || ")}`);
  }

  const paymentFrames = getBookingComPaymentFrames(rawPage);
  if (paymentFrames.length > 0) {
    traceLog(
      `Booking.com payment diagnostics: detected ${paymentFrames.length} payment iframe(s), so card fields are likely not in the main document.`
    );
  }
}

export async function verifyBookingComPaymentFieldValues(
  rawPage: Page,
  currentUrl: string,
  p: BookingComProfile
): Promise<{ cardholder: boolean; cardNumber: boolean; cardExpiry: boolean }> {
  if (!isBookingComCheckoutUrl(currentUrl)) {
    return { cardholder: false, cardNumber: false, cardExpiry: false };
  }

  await markBookingComPaymentFields(rawPage);
  const expected = {
    cardholder: p.card_name || p.full_name || "",
    cardNumber: p.card_number ?? "",
    cardExpiry: p.card_expiry ?? "",
  };

  const combined = { cardholder: false, cardNumber: false, cardExpiry: false };
  for (const scope of getBookingComPaymentScopes(rawPage)) {
    const verified = await scope.evaluate((scopeExpected) => {
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
          scopeExpected.cardholder &&
          (
            meta.includes("cardholder's name") ||
            meta.includes("cardholder name") ||
            meta.includes("name on card") ||
            meta.includes("cardholder")
          ) &&
          normalizedValue.includes(normalize(scopeExpected.cardholder))
        ) {
          result.cardholder = true;
        }

        if (
          scopeExpected.cardNumber &&
          (meta.includes("card number") || meta.includes("credit card number") || meta.includes("cc-number"))
        ) {
          const expectedDigits = normalizeDigitsLocal(scopeExpected.cardNumber);
          if (
            digitValue === expectedDigits ||
            (expectedDigits.length >= 4 && digitValue.endsWith(expectedDigits.slice(-4)))
          ) {
            result.cardNumber = true;
          }
        }

        if (
          scopeExpected.cardExpiry &&
          (
            meta.includes("expiration date") ||
            meta.includes("expiry date") ||
            meta.includes("expiry") ||
            meta.includes("expiration") ||
            meta.includes("mm/yy") ||
            meta.includes("mm / yy")
          )
        ) {
          const compactValue    = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
          const compactExpected = scopeExpected.cardExpiry.replace(/\s+/g, "").replace(/-/g, "/");
          const expiryDigits    = compactExpected.replace(/\D/g, "");
          const rawDigits       = rawValue.replace(/\D/g, "");
          if (
            compactValue.includes(compactExpected) ||
            (expiryDigits.length >= 4 && rawDigits.includes(expiryDigits))
          ) {
            result.cardExpiry = true;
          }
        }
      }

      return result;
    }, expected).catch(() => ({ cardholder: false, cardNumber: false, cardExpiry: false }));

    combined.cardholder ||= verified.cardholder;
    combined.cardNumber ||= verified.cardNumber;
    combined.cardExpiry ||= verified.cardExpiry;
  }

  const verifyLocatorValue = async (
    markerKey: "cardholder" | "card-number" | "card-expiry",
    patterns: string[],
    value: string,
    kind: "text" | "digits" | "expiry"
  ): Promise<boolean> => {
    if (!value) return false;
    const locator = await findBookingComPaymentField(rawPage, markerKey, patterns, {
      normalizeText: (input) => input.toLowerCase().replace(/\s+/g, " ").trim(),
      normalizeLooseText: (input) => input.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(),
      normalizeDigits: (input) => input.replace(/\D/g, ""),
      findVisibleField: async (pageArg, candidatePatterns) => findVisibleFieldInScope(pageArg, candidatePatterns),
      fillLocator: async () => false,
      evaluateLocatorElement: async () => false as never,
      waitForEvaluateCondition: async () => false,
      safePressEscape: async () => undefined,
      safeMouseClick: async () => undefined,
      waitForPageSignals: async () => false,
    });
    if (!locator) return false;

    const rawValue = await locator.inputValue().catch(() => "");
    if (kind === "digits") {
      const digits = rawValue.replace(/\D/g, "");
      const expectedDigits = value.replace(/\D/g, "");
      return digits === expectedDigits || (expectedDigits.length >= 4 && digits.endsWith(expectedDigits.slice(-4)));
    }
    if (kind === "expiry") {
      const compact         = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
      const expectedCompact = value.replace(/\s+/g, "").replace(/-/g, "/");
      if (compact.includes(expectedCompact)) return true;
      // Fallback: some iframe fields return digits-only (e.g. "1228" vs "12/28")
      const expiryDigits = expectedCompact.replace(/\D/g, "");
      const rawDigits    = rawValue.replace(/\D/g, "");
      return expiryDigits.length >= 4 && rawDigits.includes(expiryDigits);
    }
    return rawValue.toLowerCase().replace(/\s+/g, " ").trim().includes(value.toLowerCase().replace(/\s+/g, " ").trim());
  };

  combined.cardholder ||= await verifyLocatorValue(
    "cardholder",
    ["cardholder's name", "cardholder name", "name on card", "cardholder", "card holder"],
    expected.cardholder,
    "text"
  );
  combined.cardNumber ||= await verifyLocatorValue(
    "card-number",
    ["card number", "credit card number", "cc-number", "cc number"],
    expected.cardNumber,
    "digits"
  );
  combined.cardExpiry ||= await verifyLocatorValue(
    "card-expiry",
    ["expiration date", "expiry date", "expiry", "expiration", "mm/yy", "mm / yy"],
    expected.cardExpiry,
    "expiry"
  );

  return combined;
}

export async function evaluateBookingComVerification(
  rawPage: Page,
  currentUrl: string,
  pageText: string,
  p: BookingComProfile,
  entered: BookingComEnteredValues,
  finalPaymentState: boolean
): Promise<BookingComVerificationResult> {
  const normalized = pageText.toLowerCase();
  const paymentFieldVisibility = await getBookingComPaymentFieldVisibility(rawPage, currentUrl);
  const paymentFieldVerification = await verifyBookingComPaymentFieldValues(rawPage, currentUrl, p);
  const cardTypeState = await rawPage.evaluate(() => {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const placeholderSignals = [
      "select your card type",
      "select a card type",
      "select card type",
      "choose card type",
    ];
    const brandSignals = [
      "visa",
      "mastercard",
      "master card",
      "american express",
      "amex",
      "discover",
      "jcb",
      "diners club",
    ];

    const visibleSelects = Array.from(document.querySelectorAll("select")).filter((element) => isVisible(element));
    for (const element of visibleSelects) {
      const select = element as HTMLSelectElement;
      const labelText = (select.labels?.[0]?.textContent ?? "").trim();
      const optionTexts = Array.from(select.options).map((option) => normalize(option.textContent ?? ""));
      const meta = normalize([
        labelText,
        select.getAttribute("aria-label") ?? "",
        select.getAttribute("name") ?? "",
        select.getAttribute("id") ?? "",
        select.getAttribute("placeholder") ?? "",
        optionTexts.slice(0, 10).join(" "),
      ].join(" "));

      const isCardTypeSelect =
        meta.includes("card type") ||
        meta.includes("select your card type") ||
        meta.includes("select a card type") ||
        brandSignals.some((signal) => optionTexts.some((text) => text.includes(signal)));

      if (!isCardTypeSelect) continue;

      const selectedOption = select.options[select.selectedIndex] ?? null;
      const selectedValue = normalize(select.value ?? "");
      const selectedText = normalize(selectedOption?.textContent ?? "");
      const selected = Boolean(selectedValue) && !placeholderSignals.some((signal) => selectedText.includes(signal));

      return {
        required: Boolean(select.required) || meta.includes("card type"),
        selected,
      };
    }

    return { required: false, selected: false };
  }).catch(() => ({ required: false, selected: false }));

  const pageHasIdentityFields = containsAny(normalized, [
    "first name", "last name", "full name", "your name",
    "email", "e-mail", "phone", "mobile", "contact",
  ]);
  const pageHasFullNameField = containsAny(normalized, ["full name", "your name"]);
  const pageHasFirstNameField = containsAny(normalized, ["first name", "given name"]);
  const pageHasLastNameField = containsAny(normalized, ["last name", "family name", "surname"]);
  const pageHasEmailField = containsAny(normalized, ["email", "e-mail"]);
  const pageHasPhoneField = containsAny(normalized, ["phone number", "phone", "mobile", "telephone"]);

  const identityChecks: boolean[] = [];
  if (pageHasFullNameField) {
    identityChecks.push(entered.fullName || (entered.firstName && entered.lastName));
  } else {
    if (pageHasFirstNameField) identityChecks.push(entered.firstName);
    if (pageHasLastNameField) identityChecks.push(entered.lastName);
  }
  if (pageHasEmailField) identityChecks.push(entered.email);
  if (pageHasPhoneField) identityChecks.push(entered.phone);

  const identityOk = pageHasIdentityFields
    ? identityChecks.length > 0 && identityChecks.every(Boolean)
    : true;

  const visiblePaymentInputs =
    paymentFieldVisibility.cardholder ||
    paymentFieldVisibility.cardNumber ||
    paymentFieldVisibility.cardExpiry;

  const cardNumberOk =
    !p.card_number ||
    entered.cardNumber ||
    paymentFieldVerification.cardNumber;
  const cardExpiryOk =
    !p.card_expiry ||
    entered.cardExpiry ||
    paymentFieldVerification.cardExpiry;
  const paymentSignalsVisible =
    finalPaymentState ||
    containsAny(normalized, [
      "your payment details",
      "card number",
      "expiration date",
      "expiry date",
      "credit or debit card",
      "complete booking",
    ]);
  const readyForManualPaymentCompletion =
    paymentSignalsVisible &&
    identityOk &&
    cardNumberOk &&
    cardExpiryOk;

  const cardOk = visiblePaymentInputs
    ? cardNumberOk && cardExpiryOk
    : paymentSignalsVisible
      ? cardNumberOk && cardExpiryOk
      : !pageHasIdentityFields
        ? true
        : (!p.card_number || entered.cardNumber) && (!p.card_expiry || entered.cardExpiry);

  return {
    pageHasIdentityFields,
    pageHasFullNameField,
    pageHasFirstNameField,
    pageHasLastNameField,
    pageHasEmailField,
    pageHasPhoneField,
    identityOk,
    cardOk,
    hasMinimumFilledProfile: identityOk && cardOk,
    visiblePaymentInputs,
    paymentSignalsVisible,
    cardTypeRequired: cardTypeState.required,
    cardTypeSelected: cardTypeState.selected,
    readyForManualPaymentCompletion,
    paymentFieldVisibility,
    paymentFieldVerification,
  };
}

export async function fillBookingComPaymentForm(
  rawPage: Page,
  p: BookingComProfile,
  helpers: BookingComHelpers,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const pageUrl = rawPage.url();
  if (!isBookingComCheckoutUrl(pageUrl)) {
    traceLog(`fillBookingComPaymentForm: skipped - not on checkout page (${pageUrl.slice(0, 80)})`);
    return;
  }

  await Promise.allSettled([
    rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
    helpers.waitForEvaluateCondition(
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
  const paymentScopes = getBookingComPaymentScopes(rawPage);
  const paymentFrameLocatorCount = await rawPage.locator(BOOKING_COM_PAYMENT_IFRAME_SELECTOR).count().catch(() => 0);
  traceLog(
    `Booking.com payment: field discovery cardholder=${discovered.cardholder} cardNumber=${discovered.cardNumber} cardExpiry=${discovered.cardExpiry} across ${paymentScopes.length} scope(s), iframeLocators=${paymentFrameLocatorCount}.`
  );
  if (!discovered.cardholder && !discovered.cardNumber && !discovered.cardExpiry) {
    await traceBookingComPaymentDiagnostics(rawPage, traceLog);
  }

  const fillPaymentField = async (
    markerKey: "cardholder" | "card-number" | "card-expiry",
    patterns: string[],
    value: string,
    label: string,
    kind: "text" | "digits" | "expiry"
  ): Promise<boolean> => {
    if (!value) return false;

    const locator = await findBookingComPaymentField(rawPage, markerKey, patterns, helpers);
    if (!locator) {
      traceLog(`Booking.com payment: could not find ${label} field`);
      return false;
    }

    const normalizedDigits = helpers.normalizeDigits(value);
    const normalizedExpiry = value.replace(/\s+/g, "").replace(/-/g, "/");

    const verify = async () => {
      const rawValue = await locator.inputValue().catch(() => "");
      const normalizedTextValue = helpers.normalizeText(rawValue);
      const normalizedDigitValue = helpers.normalizeDigits(rawValue);
      if (kind === "digits") {
        if (normalizedDigitValue === normalizedDigits) return true;
        if (normalizedDigits.length >= 4 && normalizedDigitValue.endsWith(normalizedDigits.slice(-4))) return true;
        return false;
      }
      if (kind === "expiry") {
        const compact = rawValue.replace(/\s+/g, "").replace(/-/g, "/");
        if (compact.includes(normalizedExpiry)) return true;
        // Some payment iframes return digits-only (e.g. "1228" instead of "12/28").
        // Compare without separators as a fallback.
        const expiryDigits = normalizedExpiry.replace(/\D/g, "");
        const rawDigits    = rawValue.replace(/\D/g, "");
        return expiryDigits.length >= 4 && rawDigits.includes(expiryDigits);
      }
      return normalizedTextValue.includes(helpers.normalizeText(value));
    };

    await locator.fill(value).catch(async () => {
      if (typeof locator.type === "function") {
        await locator.click().catch(() => {});
        await locator.type(value, { delay: kind === "digits" ? 35 : 45 }).catch(() => {});
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await verify()) {
      traceLog(`Booking.com payment: filled ${label} via locator.fill().`);
      return true;
    }

    if (typeof locator.evaluate === "function") {
      await helpers.evaluateLocatorElement(locator as Locator, (element, fieldValue) => {
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
        return true;
      }, value).catch(() => false);

      await new Promise((resolve) => setTimeout(resolve, 200));
      if (await verify()) {
        traceLog(`Booking.com payment: filled ${label} via DOM fallback.`);
        return true;
      }
    }

    if (kind !== "text") {
      await locator.click().catch(() => {});
      if (typeof locator.pressSequentially === "function") {
        await locator.pressSequentially(value, { delay: kind === "digits" ? 40 : 55 }).catch(() => {});
      } else if (typeof locator.type === "function") {
        await locator.type(value, { delay: kind === "digits" ? 40 : 55 }).catch(() => {});
      }
      if (typeof locator.blur === "function") {
        await locator.blur().catch(() => {});
      }
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
      helpers.normalizeDigits(p.card_number),
      "Card number",
      "digits"
    );
  }

  const inferredCardBrand = inferBookingComCardBrand(p.card_number);
  if (inferredCardBrand) {
    const cardTypeSelection = await rawPage.evaluate((brand) => {
      const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const aliases = (() => {
        switch (brand) {
          case "visa":
            return ["visa"];
          case "mastercard":
            return ["mastercard", "master card", "mc"];
          case "american express":
            return ["american express", "amex"];
          case "discover":
            return ["discover"];
          case "jcb":
            return ["jcb"];
          case "diners club":
            return ["diners club", "diners"];
          default:
            return [brand];
        }
      })();
      const placeholderSignals = [
        "select your card type",
        "select a card type",
        "select card type",
        "choose card type",
      ];

      const visibleSelects = Array.from(document.querySelectorAll("select")).filter((element) => isVisible(element));
      for (const element of visibleSelects) {
        const select = element as HTMLSelectElement;
        const labelText = (select.labels?.[0]?.textContent ?? "").trim();
        const options = Array.from(select.options);
        const optionTexts = options.map((option) => normalize(option.textContent ?? ""));
        const meta = normalize([
          labelText,
          select.getAttribute("aria-label") ?? "",
          select.getAttribute("name") ?? "",
          select.getAttribute("id") ?? "",
          optionTexts.slice(0, 12).join(" "),
        ].join(" "));

        const isCardTypeSelect =
          meta.includes("card type") ||
          meta.includes("select your card type") ||
          meta.includes("select a card type") ||
          aliases.some((alias) => optionTexts.some((text) => text.includes(alias)));
        if (!isCardTypeSelect) continue;

        const selectedOption = select.options[select.selectedIndex] ?? null;
        const selectedText = normalize(selectedOption?.textContent ?? "");
        if (selectedText && !placeholderSignals.some((signal) => selectedText.includes(signal))) {
          return {
            found: true,
            selected: true,
            alreadySelected: true,
            optionText: selectedOption?.textContent?.trim() ?? selectedText,
          };
        }

        const targetOption = options.find((option) => {
          const text = normalize(option.textContent ?? "");
          const value = normalize(option.value ?? "");
          return aliases.some((alias) => text.includes(alias) || value.includes(alias));
        });
        if (!targetOption) {
          return { found: true, selected: false, alreadySelected: false, optionText: "" };
        }

        select.value = targetOption.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          found: true,
          selected: true,
          alreadySelected: false,
          optionText: targetOption.textContent?.trim() ?? targetOption.value,
        };
      }

      return { found: false, selected: false, alreadySelected: false, optionText: "" };
    }, inferredCardBrand).catch(() => ({ found: false, selected: false, alreadySelected: false, optionText: "" }));

    if (cardTypeSelection.found) {
      if (cardTypeSelection.selected && cardTypeSelection.alreadySelected) {
        traceLog(`Booking.com payment: Card type already selected as ${cardTypeSelection.optionText || inferredCardBrand}.`);
      } else if (cardTypeSelection.selected) {
        traceLog(`Booking.com payment: selected Card type = ${cardTypeSelection.optionText || inferredCardBrand}.`);
      } else {
        traceLog(`Booking.com payment: found Card type field but could not match ${inferredCardBrand}.`);
      }
    }
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

export async function fillBookingComGuestForm(
  rawPage: Page,
  p: BookingComProfile,
  helpers: BookingComHelpers,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const pageUrl = rawPage.url();
  const isCheckoutPage = pageUrl.includes("secure.booking.com") || pageUrl.includes("booking.com/book");
  if (!isCheckoutPage) {
    traceLog(`fillBookingComGuestForm: skipped - not on checkout page (${pageUrl.slice(0, 80)})`);
    return;
  }

  async function fillInput(loc: Locator, value: string): Promise<boolean> {
    const normalizedExpected = normalizeLooseText(value);
    const digitExpected = normalizeFieldDigits(value);

    try {
      await loc.fill(value);
      await loc.blur().catch(() => {});
    } catch {
      // Fall through to DOM setter fallback below.
    }

    const verifyFilledValue = async () => {
      const currentValue = await loc.inputValue().catch(() => "");
      const normalizedCurrent = normalizeLooseText(currentValue);
      const digitCurrent = normalizeFieldDigits(currentValue);
      if (normalizedExpected && normalizedCurrent === normalizedExpected) return true;
      return digitExpected.length >= 4 && digitCurrent.endsWith(digitExpected);
    };

    if (await verifyFilledValue()) {
      return true;
    }

    try {
      await helpers.evaluateLocatorElement(
        loc,
        (element, nextValue) => {
          const control = element as HTMLInputElement | HTMLTextAreaElement;
          const prototype =
            element instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          control.focus();
          if (nativeSetter) {
            nativeSetter.call(control, nextValue);
          } else {
            control.value = nextValue;
          }
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
          control.blur();
        },
        value
      );
    } catch {
      // Ignore DOM setter fallback failures.
    }

    return verifyFilledValue();
  }

  async function fillBySelector(selectors: string[], value: string, label: string): Promise<boolean> {
    for (const sel of selectors) {
      try {
        const loc = rawPage.locator(sel).first();
        if (!await loc.isVisible({ timeout: 800 }).catch(() => false)) continue;
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "select") continue;
        const nameAttr = await loc.getAttribute("name").catch(() => "");
        if (nameAttr === "ss") continue;
        if (!await fillInput(loc, value)) continue;
        traceLog(`Booking.com: filled ${label} via selector "${sel}" = "${value}"`);
        return true;
      } catch {
        // Try next selector.
      }
    }
    return false;
  }

  async function fillByLabelText(labelTexts: string[], value: string, label: string): Promise<boolean> {
    for (const text of labelTexts) {
      try {
        const loc = rawPage.getByLabel(text, { exact: false }).first();
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
          const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
          if (tag === "select") continue;
          const nameAttr = await loc.getAttribute("name").catch(() => "");
          if (nameAttr === "ss") continue;
          if (!await fillInput(loc, value)) continue;
          traceLog(`Booking.com: filled ${label} via getByLabel("${text}") = "${value}"`);
          return true;
        }
      } catch {
        // Try next strategy.
      }
      try {
        const labelEl = rawPage.locator("label").filter({ hasText: text }).first();
        if (!await labelEl.isVisible({ timeout: 600 }).catch(() => false)) continue;
        const forId = await labelEl.getAttribute("for").catch(() => null);
        if (!forId) continue;
        const inp = rawPage.locator(`#${CSS.escape(forId)}`);
        if (!await inp.isVisible({ timeout: 600 }).catch(() => false)) continue;
        if (!await fillInput(inp, value)) continue;
        traceLog(`Booking.com: filled ${label} via label[for="${forId}"] = "${value}"`);
        return true;
      } catch {
        // Try next label.
      }
    }
    return false;
  }

  async function scanGuestFields(): Promise<BookingComGuestFieldScan[]> {
    const markers = await rawPage.evaluate((optionalPatterns) => {
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const classify = (label: string, tagName: string, inputType: string, options: string[]) => {
        const normalizedLabel = normalize(label);
        if (!normalizedLabel) return null;
        if (optionalPatterns.some((pattern) => normalizedLabel.includes(pattern))) return null;

        const has = (...patterns: string[]) => patterns.some((pattern) => normalizedLabel.includes(pattern));
        const hasCountryOption =
          tagName === "select" &&
          options.some((option) => {
            const normalizedOption = normalize(option);
            return normalizedOption === "united states" || normalizedOption === "us" || normalizedOption === "usa";
          });

        if (has("email", "e mail")) return "email";
        if (inputType === "tel" || has("phone", "mobile", "telephone", "tel")) return "phone";
        if (has("first name", "given name", "firstname")) return "first_name";
        if (has("last name", "family name", "surname", "lastname")) return "last_name";
        if (has("full name", "guest name")) return "full_name";
        if (has("country region", "country", "region country") || hasCountryOption) return "country";
        if (has("zip", "postal code", "postcode")) return "zip";
        if (has("state", "province", "state province", "province state")) return "state";
        if (has("city", "town")) return "city";
        if (has("street address", "address line 1", "address 1", "street", "billing address", "address") && !has("email address")) {
          return "address_line1";
        }
        return null;
      };

      document
        .querySelectorAll("[data-codex-booking-guest-field-index]")
        .forEach((element) => {
          element.removeAttribute("data-codex-booking-guest-field-index");
          element.removeAttribute("data-codex-booking-guest-field-key");
        });

      const candidates = Array.from(document.querySelectorAll("input, textarea, select")).filter((element) => {
        if (!isVisible(element)) return false;
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
          return false;
        }
        const inputType = element instanceof HTMLInputElement ? (element.type || "text").toLowerCase() : element.tagName.toLowerCase();
        return !["hidden", "checkbox", "radio", "button", "submit"].includes(inputType);
      }) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

      return candidates.map((element, index) => {
        const tagName = element.tagName.toLowerCase();
        const inputType = element instanceof HTMLInputElement ? (element.type || "text").toLowerCase() : tagName;
        const labels =
          "labels" in element && element.labels
            ? Array.from(element.labels).map((item) => item.textContent ?? "")
            : [];
        const forLabel = element.id ? Array.from(document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)).map((item) => item.textContent ?? "") : [];
        const placeholder = "placeholder" in element ? element.placeholder ?? "" : "";
        const options =
          element instanceof HTMLSelectElement
            ? Array.from(element.options).map((option) => option.textContent ?? option.value ?? "")
            : [];
        const nearbyText = [
          element.closest("label")?.textContent ?? "",
          element.parentElement?.textContent ?? "",
          element.closest("div, section, fieldset")?.textContent ?? "",
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("name") ?? "",
          element.getAttribute("id") ?? "",
          element.getAttribute("autocomplete") ?? "",
          placeholder,
        ]
          .filter(Boolean)
          .join(" ");
        const label = [labels.join(" "), forLabel.join(" "), nearbyText].join(" ").trim();
        const normalizedLabel = normalize(label);
        const optional = /\(\s*optional\s*\)|\boptional\b/i.test(label) || optionalPatterns.some((pattern) => normalizedLabel.includes(pattern));
        const required =
          !optional &&
          (
            element.hasAttribute("required") ||
            element.getAttribute("aria-required") === "true" ||
            /\*/.test(label)
          );
        const value =
          element instanceof HTMLSelectElement
            ? element.selectedOptions?.[0]?.textContent ?? element.value ?? ""
            : element.value ?? "";
        const key = classify(label, tagName, inputType, options);

        element.setAttribute("data-codex-booking-guest-field-index", String(index));
        if (key) {
          element.setAttribute("data-codex-booking-guest-field-key", key);
        }

        return {
          index,
          key,
          label,
          normalizedLabel,
          required,
          optional,
          empty: !normalize(value),
          tagName,
          inputType,
          value,
          options,
          ariaInvalid: element.getAttribute("aria-invalid") === "true",
        };
      });
    }, BOOKING_COM_OPTIONAL_GUEST_FIELD_PATTERNS).catch(() => [] as Array<{
      index: number;
      key: BookingComGuestFieldKey | null;
      label: string;
      normalizedLabel: string;
      required: boolean;
      optional: boolean;
      empty: boolean;
      tagName: string;
      inputType: string;
      value: string;
      options: string[];
      ariaInvalid: boolean;
    }>);

    return markers.map((marker) => ({
      locator: rawPage.locator(`[data-codex-booking-guest-field-index="${marker.index}"]`).first(),
      key: marker.key as BookingComGuestFieldKey | null,
      label: marker.label,
      normalizedLabel: marker.normalizedLabel,
      required: marker.required,
      optional: marker.optional,
      empty: marker.empty,
      tagName: marker.tagName,
      inputType: marker.inputType,
      value: marker.value,
      options: marker.options,
      ariaInvalid: marker.ariaInvalid,
    }));
  }

  async function fillSelectField(field: BookingComGuestFieldScan, value: string, label: string): Promise<boolean> {
    const desired = value.trim();
    const normalizedDesired = normalizeLooseText(desired);
    if (!desired) return false;

    try {
      const optionValue = await evaluateLocatorElement(
        field.locator,
        (element, requested) => {
          if (!(element instanceof HTMLSelectElement)) return "";
          const normalize = (input: string) =>
            input.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
          const requestedNormalized = normalize(requested);
          const aliases = new Set([requestedNormalized]);

          if (requestedNormalized === "us" || requestedNormalized === "usa" || requestedNormalized === "united states") {
            aliases.add("united states");
            aliases.add("us");
            aliases.add("usa");
            aliases.add("united states of america");
          }

          const options = Array.from(element.options);
          const exact =
            options.find((option) => aliases.has(normalize(option.textContent ?? ""))) ??
            options.find((option) => aliases.has(normalize(option.value ?? "")));
          if (exact) return exact.value;

          const loose =
            options.find((option) => {
              const optionText = normalize(option.textContent ?? "");
              const optionValue = normalize(option.value ?? "");
              return Array.from(aliases).some((alias) => optionText.includes(alias) || optionValue.includes(alias));
            }) ?? null;

          return loose?.value ?? "";
        },
        desired
      );

      if (!optionValue) return false;
      await field.locator.selectOption(optionValue).catch(() => {});

      const selectedText = await field.locator.inputValue().catch(() => "");
      if (normalizeLooseText(selectedText) === normalizedDesired || normalizeLooseText(selectedText).includes(normalizedDesired)) {
        traceLog(`Booking.com: filled ${label} via detected select field = "${desired}"`);
        return true;
      }

      const selectedByDom = await evaluateLocatorElement(
        field.locator,
        (element, chosenValue) => {
          if (!(element instanceof HTMLSelectElement)) return "";
          element.value = chosenValue;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return element.selectedOptions?.[0]?.textContent ?? element.value ?? "";
        },
        optionValue
      ).catch(() => "");

      if (normalizeLooseText(selectedByDom) === normalizedDesired || normalizeLooseText(selectedByDom).includes(normalizedDesired)) {
        traceLog(`Booking.com: filled ${label} via detected select field = "${desired}"`);
        return true;
      }
    } catch {
      // Ignore and report failure.
    }

    return false;
  }

  async function fillDetectedGuestField(field: BookingComGuestFieldScan, value: string, label: string): Promise<boolean> {
    if (!value.trim()) return false;
    if (field.tagName === "select") {
      return fillSelectField(field, value, label);
    }
    const ok = await fillInput(field.locator, value);
    if (ok) {
      traceLog(`Booking.com: filled ${label} via detected guest field = "${value}"`);
    }
    return ok;
  }

  function summarizeGuestFields(fields: BookingComGuestFieldScan[]): string {
    return fields
      .slice(0, 12)
      .map((field) => {
        const key = field.key ?? "unclassified";
        const req = field.required ? "required" : field.optional ? "optional" : "plain";
        const state = field.empty ? "empty" : "filled";
        const label = clipDiagnosticText(field.label || field.normalizedLabel || key, 70);
        return `${key}/${field.tagName}/${req}/${state}: ${label}`;
      })
      .join(" || ");
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
        await rawPage.waitForTimeout(120).catch(() => {});
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
          text.includes("电话") ||
          text.includes("手机号码") ||
          text.includes("手机") ||
          text.includes("電話號碼") ||
          text.includes("手機號碼")
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

    await rawPage.waitForTimeout(150).catch(() => {});
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

    await rawPage.waitForTimeout(150).catch(() => {});
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

    await rawPage.waitForTimeout(150).catch(() => {});
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

  let givenName = p.first_name ?? "";
  let familyName = p.last_name ?? "";
  if (p.full_name && p.full_name.trim().includes(" ")) {
    const parts = p.full_name.trim().split(/\s+/);
    givenName = parts.slice(0, parts.length - 1).join(" ");
    familyName = parts[parts.length - 1];
    traceLog(`Booking.com: name split "${p.full_name}" → given="${givenName}" family="${familyName}"`);
  }

  let scannedGuestFields = await scanGuestFields();
  if (scannedGuestFields.length > 0) {
    traceLog(`Booking.com guest form diagnostics: visible fields -> ${summarizeGuestFields(scannedGuestFields)}`);
  } else {
    traceLog("Booking.com guest form diagnostics: no visible editable fields detected.");
  }
  const requiredKeys = Array.from(
    new Set(
      scannedGuestFields
        .filter((field) => field.required && field.key)
        .map((field) => field.key as BookingComGuestFieldKey)
    )
  );
  if (requiredKeys.length > 0) {
    traceLog(`Booking.com guest form: detected required fields -> ${requiredKeys.join(", ")}`);
  }

  const preferredCountry = (p.country ?? "").trim() || "United States";
  const profileValues = new Map<BookingComGuestFieldKey, string>([
    ["full_name", p.full_name ?? ""],
    ["first_name", givenName],
    ["last_name", familyName],
    ["email", p.email ?? ""],
    ["address_line1", p.address_line1 ?? ""],
    ["city", p.city ?? ""],
    ["state", p.state ?? ""],
    ["zip", p.zip ?? ""],
    ["country", preferredCountry],
  ]);
  const profileCoverage = Array.from(profileValues.entries())
    .filter(([, value]) => !!value.trim())
    .map(([key]) => key)
    .join(", ");
  traceLog(`Booking.com guest form diagnostics: available profile fields -> ${profileCoverage || "none"}`);

  const fillOrder: BookingComGuestFieldKey[] = [
    "full_name",
    "first_name",
    "last_name",
    "email",
    "address_line1",
    "city",
    "state",
    "zip",
    "country",
  ];

  for (const key of fillOrder) {
    const value = profileValues.get(key)?.trim() ?? "";
    if (!value) continue;

    const matchingFields = scannedGuestFields.filter((field) => field.key === key && !field.optional);
    for (const field of matchingFields) {
      if (!field.empty) continue;
      await fillDetectedGuestField(field, value, key.replace(/_/g, " "));
    }

    if (matchingFields.length > 0) {
      await rawPage.waitForTimeout(150).catch(() => {});
    }
  }

  scannedGuestFields = await scanGuestFields();
  if (scannedGuestFields.length > 0) {
    traceLog(`Booking.com guest form diagnostics: fields after fill pass -> ${summarizeGuestFields(scannedGuestFields)}`);
  }

  if (givenName) {
    const ok =
      await fillBySelector(['input[autocomplete="given-name"]', 'input[name*="first" i]', 'input[id*="first" i]'], givenName, "First name") ||
      await fillByLabelText(["First name", "Given name", "鍚?", "鍚?(鎷奸煶/鑻辫)"], givenName, "First name");
    if (!ok) traceLog("Booking.com: could not find First name field");
  }

  await rawPage.waitForTimeout(200).catch(() => {});

  if (familyName) {
    const ok =
      await fillBySelector(['input[autocomplete="family-name"]', 'input[name*="last" i]', 'input[id*="last" i]'], familyName, "Last name") ||
      await fillByLabelText(["Last name", "Family name", "Surname", "姓", "姓（拼音/英语）"], familyName, "Last name");
    if (!ok) traceLog("Booking.com: could not find Last name field");
  }

  await rawPage.waitForTimeout(200).catch(() => {});

  if (p.email) {
    const ok =
      await fillBySelector(['input[autocomplete="email"]', 'input[type="email"]', 'input[name*="email" i]'], p.email, "Email") ||
      await fillByLabelText(["Email address", "Email", "E-mail", "电子邮箱地址"], p.email, "Email");
    if (!ok) traceLog("Booking.com: could not find Email field");
  }

  await rawPage.waitForTimeout(300).catch(() => {});

  try {
    const countrySelectors = [
      'select[autocomplete="country"]',
      'select[name*="country" i]',
      'select[id*="country" i]',
      'select[name="cc1"]',
    ];
    let countrySet = false;
    for (const sel of countrySelectors) {
      try {
        const el = rawPage.locator(sel).first();
        if (!await el.isVisible({ timeout: 600 }).catch(() => false)) continue;
        const set = await el.evaluate((s: HTMLSelectElement) => {
          const opt = Array.from(s.options).find((o) => {
            const text = o.text.toLowerCase();
            const val = o.value.toLowerCase();
            return (
              text.includes("united states") ||
              text === "美国" ||
              text === "美國" ||
              val === "us" ||
              val === "usa" ||
              val === "united states" ||
              val === "united_states"
            );
          });
          if (!opt) return false;
          s.value = opt.value;
          s.dispatchEvent(new Event("change", { bubbles: true }));
          s.dispatchEvent(new Event("input", { bubbles: true }));
          s.dispatchEvent(new Event("blur", { bubbles: true }));
          return true;
        });
        if (set) {
          countrySet = true;
          traceLog(`Booking.com: set Country via "${sel}"`);
          break;
        }
      } catch {
        // Try next selector.
      }
    }
    if (!countrySet) {
      // Last-resort: scan ALL visible <select> elements for one whose options
      // include a US-like entry (Chinese 美国 / English / value=us). This rescues
      // localized Booking.com pages where neither autocomplete=country nor
      // name=cc1 nor a country label was findable.
      try {
        const setViaScan = await rawPage.evaluate(() => {
          const isVisible = (el: HTMLElement) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              !el.hidden &&
              (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
            );
          };
          for (const s of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
            if (!isVisible(s)) continue;
            // Skip selects that are clearly phone country codes (option text "+1" pattern)
            if (s.options.length > 0 && /\+\d{1,4}\b/.test(s.options[0].text || "")) continue;
            const opt = Array.from(s.options).find((o) => {
              const text = (o.text || "").toLowerCase();
              const val = (o.value || "").toLowerCase();
              return (
                text.includes("united states") ||
                text === "美国" ||
                text === "美國" ||
                val === "us" ||
                val === "usa"
              );
            });
            if (!opt) continue;
            s.value = opt.value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
            s.dispatchEvent(new Event("input", { bubbles: true }));
            s.dispatchEvent(new Event("blur", { bubbles: true }));
            return true;
          }
          return false;
        }).catch(() => false);
        if (setViaScan) {
          countrySet = true;
          traceLog("Booking.com: set Country via visible-select option scan (US match)");
        }
      } catch {
        // Non-fatal.
      }
    }
    if (!countrySet) {
      for (const labelText of ["Country/Region", "Country", "国家/地区", "国家", "地区", "國家/地區", "國家"]) {
        try {
          const sel = rawPage.getByLabel(labelText, { exact: false }).first();
          const tag = await sel.evaluate((e) => e.tagName.toLowerCase()).catch(() => "");
          if (tag !== "select") continue;
          if (!await sel.isVisible({ timeout: 600 }).catch(() => false)) continue;
          await sel.selectOption({ label: "United States" }).catch(() =>
            sel.selectOption({ label: "美国" }).catch(() =>
              sel.selectOption({ value: "us" })
            )
          ).catch(() => {});
          traceLog(`Booking.com: set Country/Region via getByLabel("${labelText}")`);
          countrySet = true;
          break;
        } catch {
          // Try next label.
        }
      }
    }
    if (!countrySet) traceLog("Booking.com: could not find Country dropdown");
  } catch {
    // Non-fatal.
  }

  await rawPage.waitForTimeout(300).catch(() => {});

  if (p.phone) {
    const digitsOnly = p.phone.replace(/\D/g, "").replace(/^1/, "");

    try {
      const phoneLabel = rawPage.locator("label").filter({ hasText: /Phone\s*number|Mobile\s*number|电话号码|手机号码|电话|手机|電話號碼|手機號碼/i }).first();
      if (await phoneLabel.isVisible({ timeout: 800 }).catch(() => false)) {
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
    } catch {
      // Non-fatal.
    }

    await rawPage.waitForTimeout(300).catch(() => {});

    const ok =
      await fillPhoneFieldInPhoneSection(digitsOnly) ||
      await fillBySelector(['input[type="tel"]', 'input[autocomplete*="tel"]', 'input[name*="phone" i]', 'input[id*="phone" i]'], digitsOnly, "Phone") ||
      await fillByLabelText(["Phone number", "Mobile number", "电话号码", "手机号码", "电话", "手机", "電話號碼", "手機號碼"], digitsOnly, "Phone");
    if (!ok) traceLog("Booking.com: could not find Phone number input");
    await rawPage.waitForTimeout(300).catch(() => {});
  }

  scannedGuestFields = await scanGuestFields();

  await rawPage.waitForTimeout(400).catch(() => {});
  try {
    const noThanksBtn = rawPage.locator("button, label, span, div").filter({
      hasText: /^No thanks$|^No, thanks$|^涓嶉渶瑕?|^涓嶏紝璋㈣阿$/i,
    }).first();
    if (await noThanksBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await noThanksBtn.scrollIntoViewIfNeeded().catch(() => {});
      await noThanksBtn.click({ force: true });
      traceLog("Booking.com: declined travel protection ('No thanks').");
      await rawPage.waitForTimeout(400).catch(() => {});
    }
  } catch {
    // Non-fatal.
  }

  scannedGuestFields = await scanGuestFields();
  if (scannedGuestFields.length > 0) {
    traceLog(`Booking.com guest form diagnostics: final pre-submit fields -> ${summarizeGuestFields(scannedGuestFields)}`);
  }

  const blockingGuestFields = scannedGuestFields.filter((field) => field.required && field.empty);
  const invalidGuestFields = scannedGuestFields.filter((field) => field.ariaInvalid);
  const blockingLabels = Array.from(
    new Set(
      blockingGuestFields.map((field) => field.key ?? clipDiagnosticText(field.label || field.normalizedLabel, 60))
    )
  );
  const invalidLabels = Array.from(
    new Set(
      invalidGuestFields.map((field) => field.key ?? clipDiagnosticText(field.label || field.normalizedLabel, 60))
    )
  );

  if (blockingLabels.length > 0) {
    traceLog(`Booking.com guest form: required fields still empty before final-details submit -> ${blockingLabels.join(", ")}`);
    return;
  }

  if (invalidLabels.length > 0) {
    traceLog(`Booking.com guest form: some fields still look invalid before submit -> ${invalidLabels.join(", ")}`);
    return;
  }

  await rawPage.waitForTimeout(200).catch(() => {});
  try {
    const beforeUrl = rawPage.url();
    await helpers.safePressEscape(rawPage);
    await rawPage.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    }).catch(() => {});
    await rawPage.waitForTimeout(100).catch(() => {});

    let nextClicked = false;
    const nextButtonPattern = /next.*final\s*details|next.*detail|continue|涓嬩竴姝缁х画|瀹屾垚/i;

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

    if (!nextClicked) {
      const nextBtnCandidates = [
        rawPage.locator("button").filter({ hasText: /Next.*Final\s*details/i }).first(),
        rawPage.locator("button").filter({ hasText: /Next.*detail/i }).first(),
        rawPage.locator("button").filter({ hasText: /涓嬩竴姝?/i }).first(),
        rawPage.locator("button").filter({ hasText: /瀹屾垚棰勮姝ラ/i }).first(),
      ];
      for (const btn of nextBtnCandidates) {
        if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await rawPage.waitForTimeout(120).catch(() => {});
          await btn.click({ force: true });
          traceLog("Booking.com guest form: clicked 'Next: Final details' (strategy 1) to advance to payment page.");
          nextClicked = true;
          break;
        }
      }
    }

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
        await helpers.safeMouseClick(rawPage, box.x, box.y);
        traceLog("Booking.com guest form: mouse-clicked lower-right 'Next: Final details' CTA (strategy 2).");
        nextClicked = true;
      }
    }

    if (!nextClicked) {
      await rawPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await rawPage.waitForTimeout(150).catch(() => {});
      const jsClicked = await rawPage.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button[type='submit'], button[data-testid*='next'], button[data-testid*='submit']"));
        const btn = btns.find((b) => {
          const t = (b.textContent ?? "").toLowerCase();
          return t.includes("next") || t.includes("final") || t.includes("detail") || t.includes("涓嬩竴姝?");
        }) as HTMLButtonElement | undefined;
        if (btn) {
          btn.scrollIntoView({ block: "center" });
          btn.click();
          return true;
        }
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
        helpers.waitForPageSignals(rawPage, {
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
            helpers.waitForPageSignals(rawPage, {
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
      traceLog("Booking.com guest form: 'Next: Final details' button not found - recovery loop will handle navigation.");
    }
  } catch (error) {
    traceLog(`Booking.com guest form: failed while trying to advance to final details: ${error}`);
  }
}

export async function revealBookingComRoomSelection(
  rawPage: Page,
  helpers: BookingComHelpers,
  traceLog: (msg: string) => void = () => {}
): Promise<void> {
  const beforeUrl = rawPage.url();

  await helpers.safePressEscape(rawPage);

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
        text === "info & prices" ||
        text === "prices" ||
        text === "reserve" ||
        text === "see availability" ||
        text === "check availability" ||
        text === "view prices"
      );
    }) as HTMLElement[];

    const preferred =
      topCandidates.find((element) => normalize(element.textContent ?? "") === "info & prices") ??
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
    helpers.waitForPageSignals(rawPage, {
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

  const expandedRoomPrices = await rawPage.evaluate(() => {
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

    const showPriceButtons = Array.from(
      document.querySelectorAll("button, a, [role='button']")
    ).filter((element) => {
      if (!isVisible(element)) return false;
      const text = normalize(element.textContent ?? "");
      return text === "show prices" || text === "view prices";
    }) as HTMLElement[];

    const preferred = showPriceButtons.sort((left, right) => {
      const l = left.getBoundingClientRect();
      const r = right.getBoundingClientRect();
      return (l.top - r.top) || (r.left - l.left);
    })[0];

    if (!preferred) return "";
    preferred.scrollIntoView({ block: "center", behavior: "instant" });
    preferred.click();
    return normalize(preferred.textContent ?? "");
  }).catch(() => "");

  if (expandedRoomPrices) {
    traceLog(`Booking.com room selection: clicked "${expandedRoomPrices}" to expand a room offer.`);
    await Promise.allSettled([
      rawPage.waitForLoadState("domcontentloaded", { timeout: 4000 }),
      helpers.waitForPageSignals(rawPage, {
        fromUrl: beforeUrl,
        untilTextIncludes: [
          "reserve",
          "i'll reserve",
          "i will reserve",
          "select your room",
          "show prices",
        ],
        timeoutMs: 4000,
      }),
    ]);
  }
}

export async function setBookingComRoomQuantity(rawPage: Page): Promise<{
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
        return { select, index, price };
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

    // Diagnostic: describe the visible selects so we can understand what's on the page
    const selectDiag = allSelects.slice(0, 6).map((s) => {
      const values = Array.from(s.options).map((o) => o.value).slice(0, 5).join(",");
      return `id=${s.id || "-"} name=${s.name || "-"} val=${s.value} opts=[${values}]`;
    }).join(" | ");
    return {
      ok: false,
      summary: `no room quantity dropdown found (visible selects: ${allSelects.length}) | ${selectDiag}`,
    };
  }).catch(() => ({ ok: false, summary: "DOM room quantity strategy failed" }));
}

export async function clickBookingComListingTarget(
  rawPage: Page,
  targetHotelName: string,
  helpers: BookingComHelpers,
  traceLog: (msg: string) => void = () => {}
): Promise<boolean> {
  const normalizedTarget = helpers.normalizeLooseText(targetHotelName);
  if (!normalizedTarget) return false;

  const ignoredTokens = new Set(["hotel", "hotels", "the", "by", "and", "a", "an"]);
  const targetTokens = normalizedTarget
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ignoredTokens.has(token));

  await helpers.safePressEscape(rawPage);
  await rawPage.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
  }).catch(() => {});
  await rawPage.waitForTimeout(100).catch(() => {});

  // Wait for real hotel listing cards using Playwright's native waitForSelector (most reliable).
  // This is more efficient than polling with waitForEvaluateCondition because Playwright uses
  // a MutationObserver internally and resolves the moment the element appears.
  // We try the most common card selector first, then fall back to country-specific hotel links.
  const cardSelector = [
    "[data-testid='property-card']",
    "[data-testid='property-card-desktop']",
    "[data-testid='search-card']",
    ".sr_property_block",
  ].join(", ");

  const cardAppeared = await rawPage
    .waitForSelector(cardSelector, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  if (!cardAppeared) {
    // Fallback: also accept country-specific hotel detail links (e.g. /hotel/us/name.html)
    traceLog(`Booking.com listing: property-card selector did not appear within 20s — checking for hotel detail links…`);
  }

  let clickPlan: {
    kind: "availability" | "title";
    text: string;
    title: string;
    href: string;
    x: number;
    y: number;
  } | null = null;

  for (const scrollTarget of [0, 0.2, 0.45, 0.65, 0.85]) {
    if (scrollTarget > 0) {
      await rawPage.evaluate((position) => {
        const maxScroll = Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0
        );
        window.scrollTo(0, Math.floor(maxScroll * position));
      }, scrollTarget).catch(() => {});
      await rawPage.waitForTimeout(500).catch(() => {});
    }

    clickPlan = await rawPage.evaluate(
      ({ normalizedTarget, targetTokens, ignoredTokens }) => {
      const titleSelector = [
        "[data-testid='titleLink']",
        "a[data-testid='titleLink']",
        "a[data-testid*='title-link']",
        "[data-testid='title']",
        "[data-testid*='title']",
        "a[href*='/hotel/']",
        "div[role='heading']",
        "span[role='heading']",
        "h1",
        "h2",
        "h3",
      ].join(", ");
      const cardSelector = [
        "[data-testid='card']",
        "[data-testid='property-card']",
        "[data-testid*='property-card']",
        "[data-testid='search-card']",
        "[data-testid*='search-card']",
        ".sr_property_block",
        "[data-testid='property-card-desktop']",
      ].join(", ");
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

        const scoreTitleText = (text: string) => {
          const normalized = cleanTitle(text);
          if (!normalized) return 0;

          const normalizedWords = normalized.split(" ").filter(Boolean);
          const ignoredTokenSet = new Set(ignoredTokens);
          const normalizedCoreWords = normalizedWords.filter((token) => !ignoredTokenSet.has(token));
          const normalizedCore = normalizedCoreWords.join(" ");
          const targetCore = targetTokens.join(" ");
          const targetWordCount = normalizedTarget.split(" ").filter(Boolean).length;
          const targetWordSet = new Set(targetTokens);
          const genericExtraTokens = new Set([
            "the",
            "by",
            "and",
            "a",
            "an",
            "hotel",
            "hotels",
            "new",
            "window",
            "open",
            "opens",
            "in",
            "featured",
            "deal",
            "deals",
            "property",
            "properties",
            "us",
          ]);

          if (normalizedCore && targetCore && normalizedCore === targetCore) return 4900;
          if (normalizedCore && targetCore && normalizedCore.startsWith(`${targetCore} `)) {
            return 3700;
          }
          if (normalizedCore && targetCore && normalizedCore.endsWith(` ${targetCore}`)) {
            return 3700;
          }

          const extraTokens = normalizedWords.filter((token) => !targetWordSet.has(token));
          const hasMeaningfulExtras = extraTokens.some((token) => !genericExtraTokens.has(token));

          if (normalized === normalizedTarget) return 5000;
          if (normalized.startsWith(`${normalizedTarget} `)) {
            const suffixTokens = normalizedWords.slice(targetWordCount);
            const hasMeaningfulSuffixExtras = suffixTokens.some((token) => !genericExtraTokens.has(token));
            return hasMeaningfulSuffixExtras ? 3600 : 4200;
          }
          if (normalized.endsWith(` ${normalizedTarget}`)) {
            const prefixTokens = normalizedWords.slice(0, Math.max(0, normalizedWords.length - targetWordCount));
            const hasMeaningfulPrefixExtras = prefixTokens.some((token) => !genericExtraTokens.has(token));
            return hasMeaningfulPrefixExtras ? 0 : 4000;
          }

          const matchedTokens = targetTokens.filter((token) => normalizedWords.includes(token)).length;
          if (matchedTokens < targetTokens.length) return 0;

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

      const getAvailabilityAction = (container: Element) => {
        return Array.from(container.querySelectorAll("button, a, [role='button']")).find((element) => {
          if (!isVisible(element)) return false;
          const actionText = normalize(element.textContent ?? "");
          return (
            actionText.includes("see availability") ||
            actionText.includes("check availability") ||
            actionText.includes("view deal") ||
            actionText.includes("select your room")
          );
        }) as HTMLElement | undefined;
      };

      const cardCandidates = Array.from(document.querySelectorAll(cardSelector))
        .map((container) => {
          if (!isVisible(container)) return null;
          const titleNode =
            container.querySelector(titleSelector) ??
            container.querySelector("a[href*='/hotel/']") ??
            container.querySelector("a");
          const titleText = (titleNode?.textContent ?? "").trim();
          const cardText = (container.textContent ?? "").trim();
          const titleScore = scoreTitleText(titleText);
          const cardScore = scoreTitleText(cardText);
          const bestScore = Math.max(titleScore, cardScore);
          if (bestScore <= 0) return null;

          const actionElement = getAvailabilityAction(container);
          const anchorElement = (container.querySelector("a[href*='/hotel/']") ?? titleNode) as HTMLElement | null;
          const clickElement = actionElement ?? anchorElement ?? (container as HTMLElement);
          if (!(clickElement instanceof HTMLElement)) return null;

          const rect = clickElement.getBoundingClientRect();
          return {
            kind: actionElement ? "availability" as const : "title" as const,
            score: bestScore + (actionElement ? 120 : 20),
            text: (actionElement?.textContent ?? titleText ?? cardText).trim().slice(0, 180),
            title: (titleText || cardText).trim().slice(0, 180),
            href: getNearestHref(anchorElement ?? clickElement),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        })
        .filter((value): value is {
          kind: "availability" | "title";
          score: number;
          text: string;
          title: string;
          href: string;
          x: number;
          y: number;
        } => Boolean(value))
        .sort((a, b) => b.score - a.score);

      if (cardCandidates.length > 0 && cardCandidates[0].score >= 1500) {
        return cardCandidates[0];
      }

      const buttonCandidates = Array.from(document.querySelectorAll("button, a, [role='button']"))
        .map((element) => {
          if (!isVisible(element)) return null;
          const actionText = normalize(element.textContent ?? "");
          const isAvailabilityAction =
            actionText.includes("see availability") ||
            actionText.includes("check availability") ||
            actionText.includes("view deal") ||
            actionText.includes("select your room");
          if (!isAvailabilityAction) return null;

          let container: Element | null = element;
          let bestScore = 0;
          let bestTitle = "";
          let bestHref = "";
          for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
            const titleNode =
              container.querySelector(titleSelector) ??
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
        const elements = Array.from(document.querySelectorAll("button, a, [role='button']")).filter((element) => {
          if (!isVisible(element)) return false;
          const actionText = normalize(element.textContent ?? "");
          const isAvailabilityAction =
            actionText.includes("see availability") ||
            actionText.includes("check availability") ||
            actionText.includes("view deal") ||
            actionText.includes("select your room");
          if (!isAvailabilityAction) return false;

          let container: Element | null = element;
          let bestScore = 0;
          for (let depth = 0; depth < 7 && container; depth += 1, container = container.parentElement) {
            const titleNode =
              container.querySelector(titleSelector) ??
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

      const titleCandidates = Array.from(document.querySelectorAll(`${titleSelector}, a, button, [role='button']`))
        .map((element) => {
          if (!isVisible(element)) return null;
          const text = (element.textContent ?? "").trim();
          const score = scoreTitleText(text);
          if (score <= 0) return null;
          return { element: element as HTMLElement, score, text };
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
    { normalizedTarget, targetTokens, ignoredTokens: Array.from(ignoredTokens) }
    ).catch(() => null);

    if (clickPlan) break;
  }

  if (!clickPlan) {
    const candidateSummary = await rawPage.evaluate(
      ({ normalizedTarget, targetTokens }) => {
        const titleSelector = [
          "[data-testid='titleLink']",
          "a[data-testid='titleLink']",
          "a[data-testid*='title-link']",
          "[data-testid='title']",
          "[data-testid*='title']",
          "a[href*='/hotel/']",
          "div[role='heading']",
          "span[role='heading']",
          "h1",
          "h2",
          "h3",
        ].join(", ");
        const cardSelector = [
          "[data-testid='card']",
          "[data-testid='property-card']",
          "[data-testid*='property-card']",
          "[data-testid='search-card']",
          "[data-testid*='search-card']",
          ".sr_property_block",
          "[data-testid='property-card-desktop']",
        ].join(", ");
        const normalize = (value: string) =>
          value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };

        const scored = Array.from(document.querySelectorAll(`${titleSelector}, ${cardSelector}`))
          .map((element) => {
            if (!isVisible(element)) return null;
            const text = (element.textContent ?? "").trim();
            const normalized = cleanTitle(text);
            if (!normalized) return null;
            const words = normalized.split(" ").filter(Boolean);
            const overlap = targetTokens.filter((token) => words.includes(token)).length;
            const exact = normalized === normalizedTarget;
            const starts = normalized.startsWith(`${normalizedTarget} `);
            const ends = normalized.endsWith(` ${normalizedTarget}`);
            const anchor = element.closest("a[href]") as HTMLAnchorElement | null;
            const cta = Array.from(element.querySelectorAll("button, a, [role='button']"))
              .map((item) => (item.textContent ?? "").trim())
              .filter(Boolean)
              .slice(0, 2)
              .join(" | ");
            return {
              text: text.slice(0, 120),
              overlap,
              exact,
              starts,
              ends,
              href: anchor?.href ?? "",
              cta,
            };
          })
          .filter((value): value is { text: string; overlap: number; exact: boolean; starts: boolean; ends: boolean; href: string; cta: string } => Boolean(value))
          .sort((left, right) => {
            if (right.overlap !== left.overlap) return right.overlap - left.overlap;
            return left.text.length - right.text.length;
          })
          .slice(0, 5)
          .map((candidate) => `${candidate.text} [overlap=${candidate.overlap}/${targetTokens.length}${candidate.exact ? ",exact" : ""}${candidate.starts ? ",starts" : ""}${candidate.ends ? ",ends" : ""}${candidate.cta ? `,cta=${candidate.cta.slice(0, 50)}` : ""}${candidate.href ? `,href=${candidate.href.slice(0, 80)}` : ""}]`);

        return scored;
      },
      { normalizedTarget, targetTokens }
    ).catch(() => [] as string[]);

    // Check whether the page has any real hotel listing cards at all.
    // Exclude nav/footer links like /hotel/index.html — only count country-specific hotel pages.
    const hasAnyHotelCards = await rawPage.evaluate(() => {
      const isVisible = (el: Element) => {
        if (!(el instanceof HTMLElement)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Specific property card elements (most reliable)
      const hasCard = Array.from(document.querySelectorAll(
        "[data-testid='card'], [data-testid='property-card'], [data-testid*='property-card'], .sr_property_block"
      )).some(isVisible);
      if (hasCard) return true;
      // Hotel detail links: /hotel/{2-letter-country}/ (not /hotel/index.html or /hotel/us.html)
      return Array.from(document.querySelectorAll("a[href*='/hotel/']")).some((el) => {
        if (!isVisible(el)) return false;
        return /\/hotel\/[a-z]{2}\//.test((el as HTMLAnchorElement).href ?? "");
      });
    }).catch(() => false);

    if (!hasAnyHotelCards) {
      // Check if the page looks like a CAPTCHA / bot-detection block.
      const pageText = await rawPage.evaluate(() => (document.body?.innerText ?? "").toLowerCase()).catch(() => "");
      const botSignals = [
        "security check", "verify you are human", "are you a robot", "captcha",
        "unusual traffic", "automated access", "access denied",
        "robot or human", "just a moment", "checking your browser",
      ];
      const isBotBlock = botSignals.some((s) => pageText.includes(s));
      if (isBotBlock) {
        traceLog(`Booking.com listing: bot-detection/CAPTCHA page detected — no hotel cards visible. User must open the link manually.`);
      } else {
        traceLog(`Booking.com listing: no hotel cards on page for "${targetHotelName}" — hotel unavailable for selected dates (no search results).`);
      }
    } else if (candidateSummary.length > 0) {
      traceLog(`Booking.com listing: could not match "${targetHotelName}" — page has hotels but none matched (hotel may be sold out or listed under a different name).`);
      traceLog(`Booking.com listing diagnostics: top title candidates -> ${candidateSummary.join(" || ")}`);
    } else {
      traceLog(`Booking.com listing: could not match a listing card for "${targetHotelName}".`);
      traceLog("Booking.com listing diagnostics: no visible title candidates found with current selectors.");
    }
    return false;
  }

  const beforeUrl = rawPage.url();
  await helpers.safeMouseClick(rawPage, clickPlan.x, clickPlan.y);
  traceLog(
    clickPlan.kind === "availability"
      ? `Booking.com listing: opened matched hotel "${clickPlan.title || targetHotelName}" via "${clickPlan.text || "See availability"}".`
      : `Booking.com listing: opened matched hotel title "${clickPlan.title || targetHotelName}".`
  );
  await Promise.allSettled([
    rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
    helpers.waitForPageSignals(rawPage, {
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

  const currentUrlAfterClick = rawPage.url();
  const appearsToHaveLeftResults =
    currentUrlAfterClick !== beforeUrl &&
    !currentUrlAfterClick.includes("searchresults");

  if (!appearsToHaveLeftResults && clickPlan.href) {
    await rawPage.goto(clickPlan.href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await Promise.allSettled([
      rawPage.waitForLoadState("domcontentloaded", { timeout: 5000 }),
      helpers.waitForPageSignals(rawPage, {
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
  }
  return true;
}

// ─── BrowserProvider wrapper ───────────────────────────────────────────────

/**
 * Bug 5a+5b (P1, observed live): the existing fillBookingComGuestForm contains
 * mojibake-corrupted Chinese label patterns (bytes that look like "鐢佃瘽鍙风爜",
 * "鍥藉/鍦板尯", "濮?", etc — GBK-decoded UTF-8). Real zh-CN Booking.com pages
 * never match these, so on the Chinese checkout the Country select and Phone
 * input stay empty — blocking the submit-readiness check from clicking
 * "下一步：最终信息". These detectors use clean UTF-8 patterns plus traditional
 * Chinese variants and are exported for unit testing.
 */
const PHONE_LABEL_RE = /(phone\s*number|mobile\s*number|telephone|tel\b|手机号码|手機號碼|手机|手機|电话号码|電話號碼|电话|電話)/i;
const COUNTRY_LABEL_RE = /(country\s*\/\s*region|country|region|国家\s*\/\s*地区|国家|地区|國家\s*\/\s*地區|國家|地區)/i;

export function bookingComLabelLooksLikePhone(text: string): boolean {
  if (!text) return false;
  return PHONE_LABEL_RE.test(text);
}

export function bookingComLabelLooksLikeCountry(text: string): boolean {
  if (!text) return false;
  return COUNTRY_LABEL_RE.test(text);
}

/**
 * Bug 4 (P1, observed live): Booking.com's checkout flow has TWO sequential
 * pages under the same /book.html URL — Step 2 (个人信息: 姓/名/email/phone/
 * address) and Step 3 (payment: card iframe). assessBookingStage classifies
 * both as `payment_gate` because the URL matches /book.html, so the executor's
 * `payment_gate` branch runs fillPaymentForm — which finds no card iframe on
 * Step 2 — and SKIPS fillGuestForm entirely because that path is gated on
 * stage === "checkout_form". Result: user lands on the 个人信息 form with
 * every field still empty.
 *
 * The discriminator is the presence of the Booking.com payment iframe
 * (paymentcomponent.booking.com). Step 2 has no such iframe; Step 3 does.
 * When stage=payment_gate but no payment iframe is present, the executor
 * should run fillGuestForm before (or instead of) fillPaymentForm.
 */
export function shouldRunBookingComGuestFormDespitePaymentGate(input: {
  providerId: string | null | undefined;
  stage: string;
  hasPaymentIframe: boolean;
}): boolean {
  return (
    input.providerId === "booking-com" &&
    input.stage === "payment_gate" &&
    input.hasPaymentIframe === false
  );
}

export const bookingComProvider: BrowserProvider = {
  id: "booking-com",

  matchesUrl(url: string): boolean {
    return isBookingComUrl(url);
  },

  async setup(page: Page, context: unknown, trace: (msg: string) => void): Promise<void> {
    // Bug 7: force-English language cookies are independent of the saved
    // session cookies. Apply them ALWAYS so Booking.com renders in English
    // regardless of whether a session JSON exists. (Previous code only
    // applied them inside the `.booking-cookies.json` exists branch, so on
    // every fresh QA run the page came up in zh-CN per Accept-Language.)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (context as any).addCookies([
        { name: "bk_lang",      value: "en-us", domain: ".booking.com", path: "/" },
        { name: "lang",         value: "en-us", domain: ".booking.com", path: "/" },
        { name: "selectedLang", value: "en-us", domain: ".booking.com", path: "/" },
      ]);
      trace("Booking.com: force-English language cookies injected (bk_lang/lang/selectedLang=en-us)");
    } catch (err) {
      trace(`Booking.com: language cookie injection failed: ${err} — page may render in default locale.`);
    }

    // Also send Accept-Language header so the very first request that
    // sets cookies on the response side picks English.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctxAny = context as any;
      if (typeof ctxAny.setExtraHTTPHeaders === "function") {
        await ctxAny.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
        trace("Booking.com: Accept-Language=en-US header set on context.");
      }
    } catch {
      // Non-fatal.
    }

    // Cookie injection — inject saved Booking.com session cookies into the browser context
    try {
      const cookiesPath = path.join(process.cwd(), ".booking-cookies.json");
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf-8")) as unknown[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (context as any).addCookies(cookies);
        trace(`Injected ${cookies.length} Booking.com session cookies from .booking-cookies.json`);
      } else {
        trace("No .booking-cookies.json found — run: node scripts/save-booking-cookies.mjs");
      }
    } catch (err) {
      trace(`Cookie injection failed: ${err} — proceeding without saved session.`);
    }

    // Search-bar-disable logic — inject initScript to prevent agent from typing into the search bar
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const browserCtx = (context as any).browserContext ?? (context as any).context ?? null;
      const addInitTarget = browserCtx ?? page;
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
          el.addEventListener("focus",     (e) => { e.stopPropagation(); (e.target as HTMLElement).blur(); }, true);
          el.addEventListener("mousedown",  (e) => { e.preventDefault(); e.stopPropagation(); }, true);
          el.addEventListener("keydown",    (e) => { e.preventDefault(); e.stopPropagation(); }, true);
          el.addEventListener("beforeinput",(e) => { e.preventDefault(); e.stopPropagation(); }, true);
        }
        function disableBookingSearchBar() {
          if (!location.hostname.includes("booking.com")) return;
          if (location.pathname.includes("/book") || location.pathname.includes("/checkout")) return;
          const searchBarSelectors = [
            "input[name='ss']", "input[placeholder*='\u76ee\u7684\u5730']",
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

      // Also disable search bar immediately on current page and press Escape
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await page.evaluate(() => {
          const searchBarSelectors = [
            "input[name='ss']",
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
        await safePressEscape(page);
        trace("Booking.com: disabled top search bar inputs and scrolled to room list.");
      } catch { /* ignore — non-fatal */ }
    } catch { /* ignore */ }
  },

  async getStageSignals(page: Page, url: string, text: string): Promise<ProviderStageSignals> {
    const signals = await getBookingComStageSignals(page, url, text, false);
    return {
      searchResults: signals.searchResults,
      hotelDetail: signals.hotelDetailPage || signals.hotelDetailUrl,
      guestDetailsStep: signals.guestDetailsStep,
      paymentStep: signals.finalPaymentState,
    };
  },

  async fillGuestForm(page: Page, profile: unknown, helpers: unknown, trace: (msg: string) => void): Promise<void> {
    await fillBookingComGuestForm(page, profile as BookingComProfile, helpers as BookingComHelpers, trace);
  },

  async fillPaymentForm(page: Page, profile: unknown, helpers: unknown, trace: (msg: string) => void): Promise<void> {
    await fillBookingComPaymentForm(page, profile as BookingComProfile, helpers as BookingComHelpers, trace);
  },

  getBotPatterns(): string[] {
    return [
      "something went wrong",
      "access denied",
      "checking your browser",
      "show us your human side",
      "bot or not",
      "we can't tell if you're a human",
      "please type the numbers you hear",
    ];
  },
};

// Register with the global provider registry
registerProvider(bookingComProvider);
