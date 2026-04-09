import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { BookingStage, BookingStageAssessment, RequestedStayDates } from "./stages";
import { containsAny, looksLikeDateSelectionGate, looksLikeIntermediateBookNowGate, looksLikeRoomSelectionGate } from "./stage-signals";
import { perceiveAndDecide } from "../ai-loop/perceive";
import type { BookingStage as AIBookingStage } from "../ai-loop/types";

export interface StageAssessmentDependencies {
  getVisibleFieldCategoryKeys: (rawPage: Page) => Promise<Set<string>>;
  readCombinedText: (rawPage: Page) => Promise<string>;
  getBookingComStageSignals: (
    rawPage: Page,
    currentUrl: string,
    pageText: string,
    visibleCheckoutFields: boolean
  ) => Promise<{
    isBookingCom: boolean;
    searchResults: boolean;
    hotelDetailPage: boolean;
    hotelDetailUrl: boolean;
    nonCheckoutUrl: boolean;
    guestDetailsStep: boolean;
    finalPaymentState: boolean;
  }>;
  getScopeUrl: (scope: unknown) => string;
  getRawPage: (stagehandPage: unknown) => Page;
  getInteractionScopes: (rawPage: Page) => Array<Page | ReturnType<Page["mainFrame"]>>;
  evaluateLocatorElement: <T>(locator: ReturnType<Page["locator"]>, pageFunction: (element: Element) => T) => Promise<T>;
  getLocatorText: (locator: ReturnType<Page["locator"]>) => Promise<string>;
  normalizeText: (value: string) => string;
}

const PAYMENT_URL_PATTERNS = [
  "/checkout",
  "/payment",
  "/billing",
  "/reserve/confirm",
  "/book/confirm",
  "/finalize",
  "/pay",
  "/purchase",
  "secure.booking.com/book",
  "secure.booking.com/s/",
];

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
const MODAL_CLOSE_LABELS = /^(ok|okay|close|dismiss|got it|no thanks|no,? thanks|skip|maybe later|脳|鉁晐x)$/i;
const MODAL_CONFIRM_LABELS = /^(ok|okay|got it|continue|accept|confirm)$/i;

function isPaymentUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PAYMENT_URL_PATTERNS.some((p) => lower.includes(p));
}

function classifyModal(text: string): ModalKind | null {
  const t = text.toLowerCase();
  if (MODAL_AD_PHRASES.some((p) => t.includes(p))) return "ad";
  if (MODAL_ERROR_PHRASES.some((p) => t.includes(p))) return "error";
  return null;
}

export async function hasVisibleCheckoutFields(
  rawPage: Page,
  deps: StageAssessmentDependencies
): Promise<boolean> {
  const categoryKeys = await deps.getVisibleFieldCategoryKeys(rawPage);
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
  buttonNames: RegExp[],
  deps: StageAssessmentDependencies
): Promise<boolean> {
  for (const scope of deps.getInteractionScopes(rawPage)) {
    try {
      const buttons = scope.locator('button, [role="button"], input[type="submit"], a');
      const count = Math.min(await buttons.count().catch(() => 0), 40);

      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const visible = await button.isVisible({ timeout: 500 }).catch(() => false);
        if (!visible) continue;

        const primaryText = deps.normalizeText(
          await deps.evaluateLocatorElement(button, (element) => {
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
        const fullText = deps.normalizeText(await deps.getLocatorText(button));
        if (buttonNames.some((buttonName) => buttonName.test(primaryText) || buttonName.test(fullText))) {
          return true;
        }
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function looksLikeIntermediateBookNowGateState(
  rawPage: Page,
  pageText: string,
  deps: StageAssessmentDependencies
): Promise<boolean> {
  const hasGateSignals = looksLikeIntermediateBookNowGate(pageText);
  if (!hasGateSignals) return false;

  const hasBookNowButton =
    (await hasVisibleAdvanceButton(rawPage, [/^book now$/i, /^reserve now$/i], deps)) ||
    containsAny(pageText, ["book now", "reserve now"]);
  if (!hasBookNowButton) return false;

  const hasCheckoutFields = await hasVisibleCheckoutFields(rawPage, deps);
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

export async function dismissBlockingModals(
  rawPage: Page,
  deps: StageAssessmentDependencies
): Promise<string> {
  const dismissed: string[] = [];
  for (const scope of deps.getInteractionScopes(rawPage)) {
    try {
      const buttons = scope.locator('button, [role="button"], a[href="#"]');
      const count = Math.min(await buttons.count().catch(() => 0), 40);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (!(await btn.isVisible({ timeout: 400 }).catch(() => false))) continue;

        const btnText = deps.normalizeText(
          await deps.evaluateLocatorElement(btn, (el) =>
            (el as HTMLElement).innerText || (el as HTMLElement).textContent || ""
          ).catch(async () => await deps.getLocatorText(btn))
        );

        const isCloseLabel = MODAL_CLOSE_LABELS.test(btnText) || MODAL_CONFIRM_LABELS.test(btnText);
        if (!isCloseLabel) continue;

        const { inDialog, dialogText } = await deps.evaluateLocatorElement(btn, (el) => {
          // Check for explicit dialog/modal containers first
          const dialog = el.closest("dialog, [role='dialog'], [aria-modal='true']") as HTMLElement | null;
          if (dialog) {
            const style = window.getComputedStyle(dialog);
            if (style.display !== "none" && style.visibility !== "hidden") {
              return { inDialog: true, dialogText: dialog.textContent ?? "" };
            }
          }
          // Check for high-z-index containers (Expedia uses z-index ~6-10 for info modals)
          // Also check aria-modal attribute on any ancestor
          let el2: HTMLElement | null = el.parentElement;
          while (el2 && el2 !== document.body) {
            const s = window.getComputedStyle(el2);
            const z = parseInt(s.zIndex, 10);
            if (!isNaN(z) && z > 5 && s.position !== "static") {
              return { inDialog: true, dialogText: el2.textContent ?? "" };
            }
            if (el2.getAttribute("aria-modal") === "true") {
              return { inDialog: true, dialogText: el2.textContent ?? "" };
            }
            el2 = el2.parentElement;
          }
          // Not in a standard dialog — return parent container text for content-based matching
          const container = el.closest("section, aside, [class*='card'], [class*='panel'], div") as HTMLElement | null;
          return { inDialog: false, dialogText: container?.textContent ?? "" };
        }).catch(() => ({ inDialog: false, dialogText: "" }));

        // Allow known Expedia/OTA info modal patterns even without a standard dialog container.
        // These are identified by button text + nearby content.
        const isKnownInfoModal = !inDialog && (
          dialogText.toLowerCase().includes("include taxes") ||
          dialogText.toLowerCase().includes("not like the others") ||
          dialogText.toLowerCase().includes("fee-inclusive") ||
          dialogText.toLowerCase().includes("we include fees")
        );
        if (!inDialog && !isKnownInfoModal) continue;

        const kind: ModalKind = classifyModal(dialogText) ?? "blocker";
        await btn.click({ force: true }).catch(() => {});
        dismissed.push(`${kind}: "${dialogText.trim().slice(0, 60)}"`);
      }
    } catch {
      // continue to next frame
    }
  }
  return dismissed.join("; ");
}

export async function resolveCurrentUrl(
  rawPage: Page,
  stagehand: Stagehand,
  startUrl: string,
  deps: Pick<StageAssessmentDependencies, "getScopeUrl" | "getRawPage">
): Promise<string> {
  let currentUrl = deps.getScopeUrl(rawPage);

  try {
    const candidateUrls = new Set<string>([
      currentUrl,
      ...rawPage.frames().map((frame) => deps.getScopeUrl(frame)),
    ]);

    for (const page of stagehand.context.pages()) {
      candidateUrls.add(deps.getScopeUrl(page));
      const rawChildPage = deps.getRawPage(page);
      for (const frame of rawChildPage.frames()) {
        candidateUrls.add(deps.getScopeUrl(frame));
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

export async function assessBookingStage(params: {
  rawPage: Page;
  stagehand: Stagehand;
  startUrl: string;
  requestedDates: RequestedStayDates;
  agentMessage?: string;
  deps: StageAssessmentDependencies;
}): Promise<BookingStageAssessment> {
  const { rawPage, stagehand, startUrl, requestedDates, agentMessage = "", deps } = params;

  await dismissBlockingModals(rawPage, deps).catch(() => {});
  const currentUrl = await resolveCurrentUrl(rawPage, stagehand, startUrl, deps);
  const pageText = await deps.readCombinedText(rawPage);
  const visibleCheckoutFields = await hasVisibleCheckoutFields(rawPage, deps);
  const stalledAtIntermediateBookNow = await looksLikeIntermediateBookNowGateState(rawPage, pageText, deps);
  const stalledAtDateSelection = looksLikeDateSelectionGate(pageText, requestedDates, currentUrl);
  const stalledAtRoomSelection = looksLikeRoomSelectionGate(pageText);
  const bookingComSignals = await deps.getBookingComStageSignals(
    rawPage,
    currentUrl,
    pageText,
    visibleCheckoutFields
  );
  const bookingComFinalPaymentState = bookingComSignals.finalPaymentState;
  const bookingComGuestDetailsStep = bookingComSignals.guestDetailsStep;
  const bookingComSearchResults = bookingComSignals.searchResults;
  const bookingComHotelDetailPage = bookingComSignals.hotelDetailPage;
  const bookingComHotelDetailUrl = bookingComSignals.hotelDetailUrl;
  const bookingComNonCheckoutUrl = bookingComSignals.nonCheckoutUrl;
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
    pageText.includes("杈撳叆涓汉淇℃伅") ||
    pageText.includes("瀹屾垚棰勮") ||
    pageText.includes("cardholder") ||
    pageText.includes("鐢靛瓙閭鍦板潃") ||
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

  const agentSaysBookNowGate =
    !stalledAtIntermediateBookNow &&
    !blocked &&
    (agentMessage.includes("book now") || agentMessage.includes("reserve now")) &&
    !agentMessage.includes("cvv") &&
    !agentMessage.includes("security code") &&
    !agentMessage.includes("name on card") &&
    !agentMessage.includes("card number was") &&
    (agentMessage.includes("cancellation") ||
     agentMessage.includes("guarantee") ||
     agentMessage.includes("privacy") ||
     agentMessage.includes("policy") ||
     agentMessage.includes("agree") ||
     agentMessage.includes("stopped") ||
     agentMessage.includes("booking detail") ||
     agentMessage.includes("review"));

  const effectiveStalledAtIntermediateBookNow = stalledAtIntermediateBookNow || agentSaysBookNowGate;

  let stage: BookingStageAssessment["stage"] = "unknown";
  let reason = "No stage matched current page signals.";

  if (blocked) {
    stage = "blocked";
    reason = "Blocking or anti-bot signals are visible.";
  } else if (bookingComSearchResults && (listingSignals || !bookingProgressSignals)) {
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
    stage = "payment_gate";
    reason = "URL matches a payment/checkout pattern and no editable form fields found.";
  } else if (effectiveStalledAtIntermediateBookNow && !visibleCheckoutFields) {
    stage = "intermediate_gate";
    reason = stalledAtIntermediateBookNow
      ? "Review-and-pay gate is visible before real checkout fields."
      : "Agent message indicates an intermediate Book Now gate (DOM unreadable - cross-origin widget).";
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

  // ── Phase 2: AI-assisted stage detection (gated by AI_LOOP_STAGE_DETECT=true) ──
  if (process.env.AI_LOOP_STAGE_DETECT === "true") {
    try {
      const aiPerception = await perceiveAndDecide(rawPage, {
        task: "identify the current booking stage",
        profileHint: { first_name: "", last_name: "", email: "", phone: "" },
        recentSteps: [],
      });
      const aiMapped = mapAIStageToRPA(aiPerception.stage);
      const conf = aiPerception.nextAction.confidence;

      // Log comparison for observability (trace not available here, use console)
      console.log(
        `[stage-detect] AI=${aiPerception.stage}(conf=${conf.toFixed(2)}) → mapped=${aiMapped} | RPA=${stage}`
      );

      if (conf >= 0.75 && aiMapped !== "unknown") {
        stage = aiMapped;
        reason = `AI stage detection (conf=${conf.toFixed(2)}): ${aiPerception.pageDescription}`;
      }
    } catch (err) {
      // AI detection is best-effort; never let it crash the existing flow
      console.warn("[stage-detect] AI assess failed, using RPA result:", (err as Error).message?.slice(0, 80));
    }
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

/**
 * Maps AI loop stage names (generic) to the existing RPA BookingStage enum.
 * AI stages are site-agnostic; RPA stages are Booking.com-centric.
 */
function mapAIStageToRPA(aiStage: AIBookingStage): BookingStage {
  switch (aiStage) {
    case "listing":      return "listing";
    case "hotel_detail": return "room_selection";  // Detail page = where you pick rooms
    case "room_selection": return "room_selection";
    case "guest_form":   return "checkout_form";
    case "payment_form": return "payment_gate";
    case "paused_payment": return "payment_gate";
    case "captcha":      return "blocked";
    // confirmation / no_availability / unknown → keep as unknown (no RPA equivalent)
    default:             return "unknown";
  }
}
