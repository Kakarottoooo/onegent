import type { ActivitySkillOutcome, ActivitySkillPageType } from "./types";

export type TicketmasterForgeBoundary =
  | "none"
  | "needs_user_choice"
  | "login_checkpoint"
  | "captcha_checkpoint"
  | "otp_checkpoint"
  | "seat_selection_checkpoint"
  | "payment_checkpoint"
  | "final_confirmation_checkpoint"
  | "provider_degraded"
  | "insufficient_evidence";

export type TicketmasterForgeNextAction =
  | "continue_inspecting"
  | "follow_safe_ticket_cta"
  | "ask_user_to_choose_event"
  | "pause_for_user_login"
  | "pause_for_user_verification"
  | "pause_for_user_seat_selection"
  | "pause_before_payment"
  | "pause_before_final_confirmation"
  | "review_provider_degraded"
  | "collect_more_evidence";

export type TicketmasterForbiddenAutomation =
  | "background_login"
  | "read_gmail_otp"
  | "solve_captcha"
  | "auto_select_seats"
  | "fill_payment_card"
  | "fill_cvv"
  | "submit_payment"
  | "click_final_confirmation";

export type TicketmasterForgeMissingEvidence =
  | "currentUrl"
  | "screenshot"
  | "action_log";

export type TicketmasterVisibleCandidate = {
  name?: string | null;
  dateTime?: string | null;
  venue?: string | null;
  city?: string | null;
};

export type TicketmasterForgeObservation = {
  currentUrl?: string | null;
  pageType?: ActivitySkillPageType | string | null;
  title?: string | null;
  visibleText?: string | null;
  buttons?: string[] | null;
  fields?: string[] | null;
  candidates?: TicketmasterVisibleCandidate[] | null;
  screenshotRef?: string | null;
  actionLog?: string[] | null;
};

export type TicketmasterForgeDecision = {
  boundary: TicketmasterForgeBoundary;
  outcome: ActivitySkillOutcome;
  nextAction: TicketmasterForgeNextAction;
  canAutoContinue: boolean;
  requiresUserAction: boolean;
  resumeAfterUserAction: boolean;
  missingEvidence: TicketmasterForgeMissingEvidence[];
  forbiddenAutomation: TicketmasterForbiddenAutomation[];
  summary: string;
};

export const TICKETMASTER_FORBIDDEN_AUTOMATION: ReadonlyArray<TicketmasterForbiddenAutomation> =
  Object.freeze([
    "background_login",
    "read_gmail_otp",
    "solve_captcha",
    "auto_select_seats",
    "fill_payment_card",
    "fill_cvv",
    "submit_payment",
    "click_final_confirmation",
  ]);

const DECISIONS: Readonly<
  Record<
    TicketmasterForgeBoundary,
    Omit<TicketmasterForgeDecision, "boundary" | "missingEvidence">
  >
> = Object.freeze({
  none: {
    outcome: "exact_event_ready",
    nextAction: "follow_safe_ticket_cta",
    canAutoContinue: true,
    requiresUserAction: false,
    resumeAfterUserAction: false,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster page is safe to continue until the next user-controlled boundary.",
  },
  needs_user_choice: {
    outcome: "provider_listing_needs_choice",
    nextAction: "ask_user_to_choose_event",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: true,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster listing has multiple or non-unique candidates; ask the user which event to use.",
  },
  login_checkpoint: {
    outcome: "account_session_required",
    nextAction: "pause_for_user_login",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: true,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster requires account sign-in; pause for the user and resume only after they finish manually.",
  },
  captcha_checkpoint: {
    outcome: "account_session_required",
    nextAction: "pause_for_user_verification",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: true,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster shows a CAPTCHA or human-verification challenge; pause for the user.",
  },
  otp_checkpoint: {
    outcome: "account_session_required",
    nextAction: "pause_for_user_verification",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: true,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster requires an OTP or account verification code; pause for the user.",
  },
  seat_selection_checkpoint: {
    outcome: "user_seat_selection_required",
    nextAction: "pause_for_user_seat_selection",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: true,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster requires ticket or seat selection; the user must choose seats before any resume.",
  },
  payment_checkpoint: {
    outcome: "payment_or_final_action_required",
    nextAction: "pause_before_payment",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: false,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster shows payment or billing fields; stop before card entry, CVV, payment submission, or purchase.",
  },
  final_confirmation_checkpoint: {
    outcome: "payment_or_final_action_required",
    nextAction: "pause_before_final_confirmation",
    canAutoContinue: false,
    requiresUserAction: true,
    resumeAfterUserAction: false,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster shows a final purchase confirmation action; stop and leave final confirmation to the user.",
  },
  provider_degraded: {
    outcome: "provider_degraded",
    nextAction: "review_provider_degraded",
    canAutoContinue: false,
    requiresUserAction: false,
    resumeAfterUserAction: false,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster page is unavailable, blocked, degraded, or not safe to continue.",
  },
  insufficient_evidence: {
    outcome: "insufficient_evidence",
    nextAction: "collect_more_evidence",
    canAutoContinue: false,
    requiresUserAction: false,
    resumeAfterUserAction: false,
    forbiddenAutomation: [...TICKETMASTER_FORBIDDEN_AUTOMATION],
    summary:
      "Ticketmaster skill runner lacks required evidence; collect URL, screenshot, and action log before continuing.",
  },
});

export function buildTicketmasterForgeDecision(
  observation: TicketmasterForgeObservation,
): TicketmasterForgeDecision {
  const missingEvidence = findMissingEvidence(observation);
  const boundary =
    missingEvidence.length > 0
      ? "insufficient_evidence"
      : classifyTicketmasterForgePage(observation);
  const base = DECISIONS[boundary];
  return {
    boundary,
    ...base,
    missingEvidence,
  };
}

export function classifyTicketmasterForgePage(
  observation: TicketmasterForgeObservation,
): TicketmasterForgeBoundary {
  const surface = buildSurfaceText(observation);
  const currentUrl = (observation.currentUrl ?? "").toLowerCase();

  if (looksProviderDegraded(surface, currentUrl)) return "provider_degraded";
  if (looksFinalConfirmation(surface)) return "final_confirmation_checkpoint";
  if (looksPayment(surface)) return "payment_checkpoint";
  if (looksSeatSelection(surface)) return "seat_selection_checkpoint";
  if (looksCaptcha(surface)) return "captcha_checkpoint";
  if (looksOtp(surface)) return "otp_checkpoint";
  if (looksLoginCheckpoint(surface, currentUrl, observation.fields)) {
    return "login_checkpoint";
  }

  const candidates = observation.candidates?.filter(hasCandidateSignal) ?? [];
  if (candidates.length > 1) return "needs_user_choice";
  if (candidates.length === 1) return "none";

  if (observation.pageType === "exact_event") return "none";
  if (
    observation.pageType === "artist_or_performer" ||
    observation.pageType === "listing" ||
    observation.pageType === "grouping" ||
    observation.pageType === "search_results"
  ) {
    return "needs_user_choice";
  }

  return "insufficient_evidence";
}

export function canResumeTicketmasterAfterUserAction(
  boundary: TicketmasterForgeBoundary,
): boolean {
  return (
    boundary === "login_checkpoint" ||
    boundary === "captcha_checkpoint" ||
    boundary === "otp_checkpoint" ||
    boundary === "seat_selection_checkpoint" ||
    boundary === "needs_user_choice"
  );
}

export function getTicketmasterForbiddenAutomation(): ReadonlyArray<TicketmasterForbiddenAutomation> {
  return TICKETMASTER_FORBIDDEN_AUTOMATION;
}

function findMissingEvidence(
  observation: TicketmasterForgeObservation,
): TicketmasterForgeMissingEvidence[] {
  const missing: TicketmasterForgeMissingEvidence[] = [];
  if (!hasText(observation.currentUrl)) missing.push("currentUrl");
  if (!hasText(observation.screenshotRef)) missing.push("screenshot");
  if (!hasStringEntry(observation.actionLog)) missing.push("action_log");
  return missing;
}

function buildSurfaceText(observation: TicketmasterForgeObservation): string {
  return [
    observation.currentUrl,
    observation.title,
    observation.visibleText,
    ...(observation.buttons ?? []),
    ...(observation.fields ?? []),
  ]
    .filter(hasText)
    .join(" ")
    .toLowerCase();
}

function looksProviderDegraded(surface: string, currentUrl: string): boolean {
  return (
    /\b404\b/.test(surface) ||
    surface.includes("page not found") ||
    surface.includes("well, this isn't right") ||
    surface.includes("the page you requested could not be found") ||
    surface.includes("we can't seem to find the page") ||
    surface.includes("access denied") ||
    surface.includes("temporarily unavailable") ||
    currentUrl.includes("/error") ||
    currentUrl.includes("/not-found")
  );
}

function looksFinalConfirmation(surface: string): boolean {
  return (
    surface.includes("place order") ||
    surface.includes("place your order") ||
    surface.includes("confirm purchase") ||
    surface.includes("complete purchase") ||
    surface.includes("submit order") ||
    surface.includes("buy now")
  );
}

function looksPayment(surface: string): boolean {
  return (
    surface.includes("card number") ||
    surface.includes("credit card") ||
    surface.includes("debit card") ||
    surface.includes("billing address") ||
    surface.includes("payment method") ||
    surface.includes("expiration date") ||
    /\b(cvv|cvc|security code)\b/.test(surface)
  );
}

function looksSeatSelection(surface: string): boolean {
  return (
    surface.includes("select seats") ||
    surface.includes("choose seats") ||
    surface.includes("seat map") ||
    surface.includes("pick your seats") ||
    surface.includes("best available seats") ||
    /\bsection\b.*\brow\b/.test(surface)
  );
}

function looksCaptcha(surface: string): boolean {
  return (
    surface.includes("captcha") ||
    surface.includes("recaptcha") ||
    surface.includes("verify you are human") ||
    surface.includes("security check") ||
    surface.includes("cloudflare")
  );
}

function looksOtp(surface: string): boolean {
  return (
    surface.includes("verification code") ||
    surface.includes("one-time code") ||
    surface.includes("enter the code") ||
    surface.includes("two-factor") ||
    surface.includes("2fa") ||
    surface.includes("code sent") ||
    surface.includes("sms code") ||
    surface.includes("email code")
  );
}

function looksLoginCheckpoint(
  surface: string,
  currentUrl: string,
  fields?: string[] | null,
): boolean {
  const fieldText = (fields ?? []).join(" ").toLowerCase();
  if (currentUrl.includes("auth.ticketmaster.")) return true;
  return (
    (surface.includes("sign in to your account") ||
      surface.includes("log in to continue") ||
      surface.includes("account sign in") ||
      surface.includes("enter your password")) ||
    (fieldText.includes("password") && /email|username|account/.test(fieldText))
  );
}

function hasCandidateSignal(candidate: TicketmasterVisibleCandidate): boolean {
  return (
    hasText(candidate.name) ||
    hasText(candidate.dateTime) ||
    hasText(candidate.venue) ||
    hasText(candidate.city)
  );
}

function hasStringEntry(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => hasText(entry));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
