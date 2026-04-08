import type { BrowserTaskResult } from "../types";
import type { BookingComVerificationResult } from "../providers/booking-com";

export const NO_AVAILABILITY_SIGNALS = [
  "no availability",
  "no rooms available",
  "no rates available",
  "fully booked",
  "sold out",
  "not available for",
  "no vacancies",
  "couldn't find the room",
  "could not find the room",
  "unavailable for your dates",
  "no properties available",
  "0 properties",
  "0 results",
  // Booking.com search-level "no results" messages
  "we couldn't find any properties",
  "couldn't find properties",
  "no properties match",
  "sorry, there are no results",
  "there are no results",
  "no results for your search",
  "no available properties",
  "没有可用",
  "找不到任何",
];

export interface FinalOutcomeAssessment {
  stage: string;
  reason: string;
  pageText: string;
  visibleCheckoutFields: boolean;
  hitPaymentGate: boolean;
  listingSignals: boolean;
  bookingProgressSignals: boolean;
  blocked: boolean;
}

export interface FinalOutcomeInput {
  assessment: FinalOutcomeAssessment;
  screenshotBase64: string;
  handoffUrl: string;
  startUrl: string;
  sessionUrl?: string;
  debugTrace?: string[];
  selectedDatesMatchRequest: boolean;
  bookingComVerification: BookingComVerificationResult;
  hasEnteredFullName: boolean;
  hasEnteredFirstName: boolean;
  hasEnteredLastName: boolean;
  hasEnteredEmail: boolean;
  hasEnteredPhone: boolean;
  hasEnteredCardNumber: boolean;
  hasEnteredCardExpiry: boolean;
  agentMessage: string;
  resultMessage?: string;
  resultCompleted: boolean;
  cardNumberProvided: boolean;
  cardExpiryProvided: boolean;
  /**
   * True when Booking.com's two-step checkout flow confirmed the guest-details
   * step was submitted and we are now on the final payment page.
   * When true, identity field checks are skipped — the name/email were filled
   * on the previous page and are no longer in the payment page DOM.
   */
  bookingComPassedGuestDetails?: boolean;
}

function containsAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function inferHitPaymentGate(agentMessage: string, assessment: FinalOutcomeAssessment): boolean {
  const msg = agentMessage.toLowerCase();
  const agentClaimsFilledDetails =
    /successfully (completed|filled|entered|submitted).{0,60}(guest|booking|details|information|name|email)/i.test(agentMessage) ||
    /filled.{0,30}(guest|personal|contact|booking).{0,30}(details|information|form)/i.test(agentMessage) ||
    /(first name|last name|full name).{0,60}(filled|entered|submitted|provided)/i.test(agentMessage);

  return (
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
    (msg.includes("card number") && !msg.includes("filled"))
  );
}

export function determineFinalOutcome(
  input: FinalOutcomeInput,
  trace: (message: string) => void
): BrowserTaskResult {
  const {
    assessment,
    screenshotBase64,
    handoffUrl,
    startUrl,
    sessionUrl,
    debugTrace,
    selectedDatesMatchRequest,
    bookingComVerification,
    hasEnteredFullName,
    hasEnteredFirstName,
    hasEnteredLastName,
    hasEnteredEmail,
    hasEnteredPhone,
    hasEnteredCardNumber,
    hasEnteredCardExpiry,
    agentMessage,
    resultMessage,
    resultCompleted,
    cardNumberProvided,
    cardExpiryProvided,
    bookingComPassedGuestDetails = false,
  } = input;

  const stalledAtIntermediateBookNow = assessment.stage === "intermediate_gate";
  const stalledAtListing = assessment.stage === "listing";
  const stalledAtDateSelection = assessment.stage === "date_selection";
  const stalledAtRoomSelection = assessment.stage === "room_selection";
  const bookingComPaymentFieldVerification = bookingComVerification.paymentFieldVerification;
  const bookingComVisiblePaymentInputs = bookingComVerification.visiblePaymentInputs;
  const bookingComPaymentSignalsVisible = bookingComVerification.paymentSignalsVisible;
  const hasMinimumFilledProfile = bookingComVerification.hasMinimumFilledProfile;
  const readyForManualPaymentCompletion = bookingComVerification.readyForManualPaymentCompletion;
  const cardTypeRequired = bookingComVerification.cardTypeRequired;
  const cardTypeSelected = bookingComVerification.cardTypeSelected;
  const hitPaymentGate = inferHitPaymentGate(agentMessage, assessment);

  // Detect hard browser errors (chrome error page, blank page).
  const pageLoadFailed =
    handoffUrl.startsWith("chrome-error://") ||
    handoffUrl === "about:blank" ||
    handoffUrl === "about:newtab" ||
    handoffUrl === "";

  if (pageLoadFailed) {
    trace(`Final state check: page failed to load — url="${handoffUrl}". This is a network/browser error, not a booking failure.`);
    return {
      status: "error",
      screenshotBase64,
      handoffUrl: startUrl,
      sessionUrl,
      summary: "The browser failed to load the booking page. This is usually a temporary network issue — tap to retry.",
      error: `Page load failed (url: ${handoffUrl || "empty"})`,
      debugTrace,
    };
  }

  // Detect Booking.com city/region/country redirect — happens when the hotel name can't be
  // found in search, redirecting to a destination overview page instead of search results.
  const bookingCityRedirect =
    /booking\.com\/(city|region|country|district)\//i.test(handoffUrl) ||
    /booking\.com\/searchresults\.html.*no_rooms/i.test(handoffUrl);

  if (bookingCityRedirect) {
    trace(`Final state check: Booking.com redirected to city/region page — hotel not findable via search (url="${handoffUrl}").`);
    return {
      status: "no_availability",
      screenshotBase64,
      handoffUrl: startUrl,
      sessionUrl,
      summary: "This property wasn't found in Booking.com search results — it may not be listed or available for the requested dates.",
      debugTrace,
    };
  }

  if (assessment.blocked) {
    trace("Final state check detected bot protection / blocking signals.");
    return {
      status: "captcha",
      screenshotBase64,
      handoffUrl: startUrl,
      sessionUrl,
      summary: "The hotel's website blocked the automated browser. Open the link to book directly in your browser - it will work normally there.",
      error: "Site blocked the cloud browser (bot protection). Manual booking required.",
      debugTrace,
    };
  }

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
      handoffUrl,
      sessionUrl,
      summary: "The agent stopped at an intermediate booking gate before the actual guest/payment form.",
      error: "Stalled before checkout form - intermediary 'Book Now' step was not completed.",
      debugTrace,
    };
  }

  if (stalledAtListing) {
    const listingUnavailable =
      containsAny(assessment.pageText, NO_AVAILABILITY_SIGNALS) ||
      containsAny(assessment.pageText, [
        "unavailable on our site for your dates",
        "this property is unavailable on our site for your dates",
      ]) ||
      /unavailable on our site|not available|sold out|fully booked/i.test(agentMessage);

    if (listingUnavailable) {
      trace("Final state check found that the listing page matched the target hotel but showed it as unavailable for the requested stay.");
      return {
        status: "no_availability",
        screenshotBase64,
        handoffUrl,
        sessionUrl,
        summary: "This property is unavailable on Booking.com for the requested dates.",
        debugTrace,
      };
    }
  }

  if (stalledAtDateSelection || stalledAtRoomSelection) {
    const noRooms = containsAny(assessment.pageText, NO_AVAILABILITY_SIGNALS) ||
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
      handoffUrl,
      sessionUrl,
      summary: noRooms
        ? "No rooms available for the requested dates at this property."
        : "The agent stopped before reaching the checkout form.",
      error: stalledAtDateSelection
        ? "Stalled at date selection - booking widget did not advance after selecting dates."
        : noRooms
          ? "No availability - the hotel has no rooms for the requested dates."
          : "Stalled at room selection - checkout form was not reached.",
      debugTrace,
    };
  }

  if (!selectedDatesMatchRequest && !hitPaymentGate) {
    trace("Final state check found that the selected stay dates did not match the requested check-in/check-out dates.");
    return {
      status: "error",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: "The booking widget ended up on different dates than the ones requested, so the run was stopped instead of risking a wrong booking.",
      error: "Selected dates mismatched the requested stay.",
      debugTrace,
    };
  }

  if (
    hitPaymentGate &&
    !hasMinimumFilledProfile &&
    !readyForManualPaymentCompletion &&
    // Skip this check when Booking.com's two-step flow confirmed the guest-details
    // page was submitted — identity fields are on the previous page and won't appear
    // in the payment page DOM.
    !bookingComPassedGuestDetails &&
    (
      assessment.visibleCheckoutFields ||
      bookingComVisiblePaymentInputs ||
      (bookingComPaymentSignalsVisible && (cardNumberProvided || cardExpiryProvided))
    )
  ) {
    trace("Final state check found that the page looked like payment, but the expected profile/card values were not actually present in the form fields.");
    return {
      status: "error",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: "The agent reached a payment-like page, but the guest or card fields were not actually populated correctly.",
      error: "Payment page detected without verified guest/card field values.",
      debugTrace,
    };
  }

  if (hitPaymentGate && assessment.listingSignals && !assessment.bookingProgressSignals) {
    trace("Success claim was overridden because listing signals remained visible without checkout progress.");
    return {
      status: "error",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: "The requested dates are unavailable or couldn't be selected on this property. Open the link to choose different dates or book manually.",
      error: "Agent falsely reported completion - still on listing page (dates not selectable)",
      debugTrace,
    };
  }

  if (hitPaymentGate) {
    trace("Final state check confirmed the run reached the payment gate before CVV/final submit.");
    const manualStepHint =
      cardTypeRequired && !cardTypeSelected
        ? "card details are filled - select your card type and enter CVC to complete."
        : "card details are filled - enter CVC to complete.";
    return {
      status: "paused_payment",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: resultMessage || `Reached payment page - ${manualStepHint}`,
      debugTrace,
    };
  }

  const lowerResultMessage = resultMessage?.toLowerCase() ?? "";
  const needsGuestInfo =
    lowerResultMessage.includes("personal detail") ||
    lowerResultMessage.includes("guest detail") ||
    lowerResultMessage.includes("guest information") ||
    lowerResultMessage.includes("contact information") ||
    lowerResultMessage.includes("no guest") ||
    (!resultCompleted && lowerResultMessage.includes("form"));

  if (needsGuestInfo) {
    trace("Agent reported that guest/profile details were still required.");
    return {
      status: "needs_login",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: resultMessage || "Agent reached the guest info form but has no profile data. Please add your details in Preferences > My Profile.",
      error: "No guest profile - add your name, email and phone in Preferences > My Profile, then retry.",
      debugTrace,
    };
  }

  const noAvailability =
    lowerResultMessage.includes("no availability") ||
    lowerResultMessage.includes("not available") ||
    lowerResultMessage.includes("sold out") ||
    lowerResultMessage.includes("fully booked");

  if (noAvailability) {
    trace("Agent confirmed there was no availability for the requested stay.");
    return {
      status: "no_availability",
      screenshotBase64,
      handoffUrl,
      sessionUrl,
      summary: resultMessage || "No availability found.",
      debugTrace,
    };
  }

  const needsLogin =
    lowerResultMessage.includes("sign in") ||
    lowerResultMessage.includes("log in") ||
    lowerResultMessage.includes("create account") ||
    handoffUrl.toLowerCase().includes("login") ||
    handoffUrl.toLowerCase().includes("signin");

  if (needsLogin) {
    trace("Final state check detected a login/sign-in requirement.");
    return {
      status: "needs_login",
      screenshotBase64,
      handoffUrl,
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
      handoffUrl,
      sessionUrl,
      summary: "The agent appeared to finish, but the guest/contact/card values were not verified in distinct checkout fields.",
      error: "Unverified checkout field values on final state.",
      debugTrace,
    };
  }

  trace(`Executor reached fallback terminal state with agent.completed=${String(resultCompleted)}.`);
  return {
    status: resultCompleted ? "completed" : "paused_payment",
    screenshotBase64,
    handoffUrl,
    sessionUrl,
    summary: resultMessage || "Task completed.",
    debugTrace,
  };
}
