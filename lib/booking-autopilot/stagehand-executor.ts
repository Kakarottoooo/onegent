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
const DATE_SELECTION_ADVANCE_BUTTONS = [/^next$/i, /^continue$/i, /^check availability$/i, /^show rooms$/i];
const ROOM_SELECTION_ADVANCE_BUTTONS = [
  /^select$/i,
  /^select room$/i,
  /^proceed to payment$/i,
  /^continue$/i,
  /^reserve$/i,
  /^next$/i,
];
const INTERMEDIATE_GATE_ADVANCE_BUTTONS = [/^book now$/i, /^reserve now$/i, /^reserve$/i];

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

function normalizeDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

function extractRequestedStayDates(task: string): RequestedStayDates {
  // Match both "check-in: YYYY-MM-DD" and "checking in YYYY-MM-DD" patterns.
  const checkin = task.match(/check(?:ing)?-?\s*in(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  const checkout = task.match(/check(?:ing)?-?\s*out(?:\s+date)?[:\s]+(\d{4}-\d{2}-\d{2})/i)?.[1];
  return { checkin, checkout };
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
  const texts = await Promise.all(
    getInteractionScopes(rawPage).map(async (scope) => {
      try {
        return await scope.evaluate(() =>
          (document.body?.innerText ?? "").toLowerCase().slice(0, 12000)
        ) as string;
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
    try {
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
  requestedDates: RequestedStayDates
): boolean {
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
  ]);

  const hasDeeperCheckoutSignals = containsAny(pageText, [
    "review and pay",
    "guest details",
    "card number",
    "credit card",
    "cvv",
  ]);

  return hasRoomSignals && !hasDeeperCheckoutSignals;
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

/** Dismiss any "coupon/promo code invalid" popups inside booking widget iframes.
 *  These appear when the Namastay widget loads with a stale or invalid promo code
 *  in its session state. The popup blocks the booking flow; clicking "Ok" clears it. */
async function dismissCouponErrorPopups(rawPage: Page): Promise<boolean> {
  let dismissed = false;
  for (const scope of getInteractionScopes(rawPage)) {
    try {
      // Look for buttons labelled "Ok" near coupon error text
      const buttons = scope.locator('button');
      const count = Math.min(await buttons.count().catch(() => 0), 20);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible({ timeout: 400 }).catch(() => false))) continue;
        const text = normalizeText(
          await evaluateLocatorElement(btn, (el) =>
            (el as HTMLElement).innerText || (el as HTMLElement).textContent || ""
          ).catch(async () => await getLocatorText(btn))
        );
        if (!/^ok$|^close$|^dismiss$/i.test(text)) continue;
        // Check if parent context contains coupon/promo error text
        const parentText = normalizeText(
          await evaluateLocatorElement(btn, (el) => {
            const root = el.closest("dialog, [role='dialog'], .modal, section, div") as HTMLElement | null;
            return root?.textContent ?? el.parentElement?.textContent ?? "";
          }).catch(() => "")
        );
        if (!containsAny(parentText, ["invalid", "coupon", "promo", "code", "couldn't find"])) continue;
        await btn.click({ force: true }).catch(() => {});
        dismissed = true;
      }
    } catch { /* continue */ }
  }
  return dismissed;
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
  const stalledAtDateSelection = looksLikeDateSelectionGate(pageText, requestedDates);
  const stalledAtRoomSelection = looksLikeRoomSelectionGate(pageText);
  const hitPaymentUrl = isPaymentUrl(currentUrl);

  const listingSignals =
    pageText.includes("select dates to continue") ||
    pageText.includes("select check-in and check-out") ||
    pageText.includes("enter your dates") ||
    pageText.includes("add dates for prices") ||
    pageText.includes("select dates to see pricing") ||
    pageText.includes("select dates for prices") ||
    pageText.includes("check availability") ||
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

  const hitPaymentGate =
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
  } else if (effectiveStalledAtIntermediateBookNow) {
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
      success: false,
      error: "Browser automation requires a cloud browser on Vercel. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in your Vercel environment variables, or deploy the worker service to Railway.",
      sessionUrl: undefined,
      log: [],
      paused: false,
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
  });

  trace(`Executor starting — model: ${modelName}, browser: ${useCloud ? "Browserbase" : "local"}, proxies: ${process.env.BROWSERBASE_USE_PROXIES === "true"}`);

  try {
    await stagehand.init();
    // v3 API: get active page from context (resolvePage is private)
    const page = stagehand.context.activePage() ?? await stagehand.context.newPage();

    // Navigate to the starting URL
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });

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
- Calendar month wrong → click ‹/› arrow to navigate; verify header before clicking a date.
- IHG/single-date calendar (shows per-night price on each cell, has Stay duration +/− control) → click check-in date ONLY, then use + button to set nights, then CONTINUE.
- If hotel detail page shows wrong dates → update the date picker first, then View Prices.
- "Book Now" at a consent/review summary (no name/email/card fields visible yet) → check terms checkbox, then click it to open the actual form.
- Terms/privacy checkboxes → always check before clicking booking buttons.
- Fill guest fields one at a time; only fill on the actual checkout form page.
- Browser/CORS/reCAPTCHA console errors → ignore, keep going.

The user will enter CVV and confirm payment themselves.`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await agent.execute({ instruction, maxSteps: 25 }) as any;
    const raw = getRawPage(page);

    // Check ALL open pages ― booking sites often open a new tab for the
    // checkout flow, so activePage() may still point to the original hotel
    // homepage while the real booking progress is in another tab.
    const agentMessage = (result.message ?? "").toLowerCase();
    let currentUrl = await resolveCurrentUrl(raw, stagehand, input.startUrl);
    const sessionUrl = useCloud ? stagehand.browserbaseSessionURL : undefined;

    const p = buildEffectiveProfile(input.profile, input.task);
    const hasProfile = !!(p.full_name || p.first_name || p.last_name || p.email || p.phone);
    const requestedDates = extractRequestedStayDates(input.task);
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
      switch (stage) {
        case "date_selection": {
          const clicked = await clickAllowedAdvanceButton(raw, DATE_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" to advance the date-selection gate.`);
            return true;
          }
          trace("No deterministic date-selection advance button was found, so a stage-specific agent recovery pass is running.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 8 } as any);
          return true;
        }
        case "room_selection": {
          const clicked = await clickAllowedAdvanceButton(raw, ROOM_SELECTION_ADVANCE_BUTTONS);
          if (clicked) {
            trace(`Stage recovery clicked "${clicked}" on the room-selection stage.`);
            return true;
          }
          trace("No deterministic room-selection advance button was found, so a stage-specific agent recovery pass is running.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 10 } as any);
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
          trace("No deterministic intermediate booking button was found, so a stage-specific agent recovery pass is running.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await agent.execute({ instruction: buildStageRecoveryInstruction(stage), maxSteps: 8 } as any);
          return true;
        }
        default:
          return false;
      }
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      trace(`Stage assessment ${attempt + 1}: ${assessment.stage} — ${assessment.reason}`);
      if (!["date_selection", "room_selection", "intermediate_gate"].includes(assessment.stage)) {
        break;
      }

      const acted = await attemptStageRecovery(assessment.stage);
      if (!acted) break;

      await new Promise((resolve) => setTimeout(resolve, 2500));
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
    const onGuestForm =
      hasProfile &&
      assessment.stage !== "intermediate_gate" &&
      visibleCheckoutFields;

    if (onGuestForm) {
      trace("Detected guest/payment form and started direct field-fill verification.");
      // Check whether the form is already filled (profile email visible in input values)
      let alreadyFilled = false;
      if (p.email) {
        alreadyFilled = await hasValueInScopes(raw, p.email);
      }

      if (!alreadyFilled) {
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
      } else {
        trace("Guest/payment fields already contained profile data, so direct fill fallback was skipped.");
      }
    }

    const screenshotBase64 = `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`;

    // ── Determine final outcome ───────────────────────────────────────────
    const msg = agentMessage;
    const hasEnteredFullName = p.full_name ? await hasValueInScopes(raw, p.full_name) : false;
    const hasEnteredEmail = p.email ? await hasValueInScopes(raw, p.email) : false;
    const hasEnteredPhone = p.phone ? await hasValueInScopes(raw, p.phone) : false;
    const hasEnteredCardNumber = p.card_number ? await hasValueInScopes(raw, p.card_number) : false;
    const hasEnteredCardExpiry = p.card_expiry ? await hasValueInScopes(raw, p.card_expiry) : false;
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
    const identityOk = pageHasIdentityFields
      ? hasEnteredFullName || hasEnteredEmail || hasEnteredPhone
      : true; // card-only form — no identity fields to verify

    // For card fields in cross-origin iframes, hasValueInScopes always returns false.
    // When identity fields are absent (card-only form) we also trust the agent filled them.
    const cardOk = !pageHasIdentityFields
      ? true  // cross-origin card-only form — trust the agent
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
    const hitPaymentGate =
      assessment.hitPaymentGate ||
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
      `fullName=${hasEnteredFullName}; email=${hasEnteredEmail}; phone=${hasEnteredPhone}; ` +
      `cardNumber=${hasEnteredCardNumber}; cardExpiry=${hasEnteredCardExpiry}; ` +
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
      trace(
        stalledAtDateSelection
          ? "Final state check shows the run still stopped at the booking widget date-selection gate."
          : "Final state check shows the run still stopped at room selection before checkout."
      );
      return {
        status: "error",
        screenshotBase64,
        handoffUrl: currentUrl,
        sessionUrl,
        summary: "The agent stopped before reaching the checkout form.",
        error: stalledAtDateSelection
          ? "Stalled at date selection — booking widget did not advance after selecting dates."
          : "Stalled at room selection — checkout form was not reached.",
        debugTrace,
      };
    }

    if (!selectedDatesMatchRequest) {
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

    if (hitPaymentGate && !hasMinimumFilledProfile) {
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
    await stagehand.close().catch(() => {});
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
- If you are on a booking.com or Expedia HOTEL DETAIL page: scroll down to find the room list, select the cheapest available room, and click "Reserve" or "I'll reserve".
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
2. Hotel detail page → verify/set dates → scroll to room list → choose cheapest room → click "Reserve" / "I'll reserve"
3. Guest details form → fill name, email, phone, address
4. Payment page → choose "Credit or debit card" → fill card number and expiry
5. STOP before CVV and before "Complete booking" / "Pay now" button

EXPEDIA SPECIFIC FLOW:
1. Search results → click correct hotel → "Select room"
2. Room selection → choose room → "Reserve"
3. Trip summary / checkout form → fill guest info and card
4. STOP before final "Complete booking" button

Booking widget navigation rules:
- The booking calendar and room selection are inside an IFRAME on the page.
- After selecting dates, click ONLY the "Next" button that is INSIDE the booking widget iframe to advance to room selection. DO NOT click "Next Slide", "Previous Slide", photo carousel arrows, or any other button outside the booking iframe.
- If you clicked a "Next Slide" button by mistake (it navigates a photo gallery), that is the wrong button — look for the Next/Continue button inside the booking iframe instead.
- If a dialog or popup appears saying "This code is invalid", "coupon code", "promo code not found", or similar — click the "Ok" or "Close" button immediately to dismiss it. Do NOT enter any coupon code.

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
}): Pick<BrowserTaskInput, "task" | "profile"> {
  return {
    profile: params.profile,
    task: `Find ${params.hotelName} hotel in ${params.city} and book the cheapest available room for ${params.adults} adult(s), checking in ${params.checkin} and checking out ${params.checkout}. Fill in the guest information completely.`,
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
