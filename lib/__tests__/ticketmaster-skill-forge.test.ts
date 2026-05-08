import { describe, expect, it } from "vitest";
import {
  buildTicketmasterForgeDecision,
  canResumeTicketmasterAfterUserAction,
  classifyTicketmasterForgePage,
  getTicketmasterAllowedAssistance,
  getTicketmasterForbiddenAutomation,
} from "@/lib/activity-skills";
import type {
  TicketmasterForgeBoundary,
  TicketmasterForgeObservation,
} from "@/lib/activity-skills";

const baseObservation: TicketmasterForgeObservation = {
  currentUrl:
    "https://www.ticketmaster.com/the-lion-king-new-york-ny/event/1D0062E4AABB",
  pageType: "exact_event",
  title: "The Lion King Tickets",
  visibleText: "The Lion King Minskoff Theatre Sat, May 30 2:00 PM Find Tickets",
  buttons: ["Find Tickets"],
  screenshotRef: "artifact://stage0b/tm/exact-event.png",
  actionLog: ["open url", "capture page info"],
};

describe("Ticketmaster skill forge classifier", () => {
  it("lets exact event pages continue only to the next safe Ticketmaster CTA", () => {
    const decision = buildTicketmasterForgeDecision(baseObservation);

    expect(decision).toMatchObject({
      boundary: "none",
      outcome: "exact_event_ready",
      nextAction: "follow_safe_ticket_cta",
      canAutoContinue: true,
      requiresUserAction: false,
      resumeAfterUserAction: false,
      missingEvidence: [],
    });
    expect(decision.allowedAssistance).toContain(
      "reuse_user_authorized_provider_session",
    );
  });

  it("asks the user to choose when an artist/listing page has multiple visible candidates", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
      pageType: "artist_or_performer",
      visibleText:
        "Disney On Ice presents Find Your Hero Sep 17 7:00 PM Detroit Sep 18 11:00 AM Detroit",
      candidates: [
        { name: "Disney On Ice", dateTime: "Sep 17 7:00 PM", city: "Detroit" },
        { name: "Disney On Ice", dateTime: "Sep 18 11:00 AM", city: "Detroit" },
      ],
    });

    expect(decision).toMatchObject({
      boundary: "needs_user_choice",
      outcome: "provider_listing_needs_choice",
      nextAction: "ask_user_to_choose_event",
      canAutoContinue: false,
      requiresUserAction: true,
      resumeAfterUserAction: true,
    });
  });

  it("does not treat a header-only Sign In button as a login wall", () => {
    const boundary = classifyTicketmasterForgePage({
      ...baseObservation,
      pageType: "artist_or_performer",
      visibleText: "United States Sep 17 Find Tickets Sign In",
      buttons: ["Find Tickets", "Sign In"],
    });

    expect(boundary).toBe("needs_user_choice");
  });

  it("pauses for login checkpoints when no authorized session or credentials exist", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=abc",
      visibleText: "Sign in to your account Email address Password Continue",
      fields: ["Email address", "Password"],
    });

    expect(decision).toMatchObject({
      boundary: "login_checkpoint",
      outcome: "account_session_required",
      nextAction: "pause_for_user_login",
      canAutoContinue: false,
      requiresUserAction: true,
      resumeAfterUserAction: true,
    });
    expect(decision.forbiddenAutomation).toContain("use_unscoped_credentials");
  });

  it("uses an authorized provider session at a login checkpoint", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=abc",
      visibleText: "Sign in to your account Email address Password Continue",
      fields: ["Email address", "Password"],
      authorizedCapabilities: { providerSession: true },
    });

    expect(decision).toMatchObject({
      boundary: "login_checkpoint",
      outcome: "account_session_required",
      nextAction: "reuse_authorized_session",
      canAutoContinue: true,
      requiresUserAction: false,
      resumeAfterUserAction: false,
    });
  });

  it("uses authorized profile credentials at a login checkpoint", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=abc",
      visibleText: "Sign in to your account Email address Password Continue",
      fields: ["Email address", "Password"],
      authorizedCapabilities: { profileCredentials: true },
    });

    expect(decision).toMatchObject({
      boundary: "login_checkpoint",
      outcome: "account_session_required",
      nextAction: "use_authorized_profile_login",
      canAutoContinue: true,
      requiresUserAction: false,
      resumeAfterUserAction: false,
    });
  });

  it("pauses for OTP checkpoints when Gmail OTP is not authorized", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText: "Enter the verification code sent to your email",
      fields: ["Verification code"],
    });

    expect(decision).toMatchObject({
      boundary: "otp_checkpoint",
      outcome: "account_session_required",
      nextAction: "pause_for_user_verification",
      canAutoContinue: false,
      resumeAfterUserAction: true,
    });
    expect(decision.forbiddenAutomation).toContain("read_unrelated_email");
  });

  it("uses Gmail OTP only for an active authorized provider-login checkpoint", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText: "Enter the verification code sent to your email",
      fields: ["Verification code"],
      authorizedCapabilities: { gmailOtp: true },
    });

    expect(decision).toMatchObject({
      boundary: "otp_checkpoint",
      outcome: "account_session_required",
      nextAction: "use_authorized_gmail_otp",
      canAutoContinue: true,
      requiresUserAction: false,
      resumeAfterUserAction: false,
    });
    expect(decision.forbiddenAutomation).toContain("read_unrelated_email");
  });

  it("pauses for CAPTCHA checkpoints and forbids solving the challenge", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText: "Security check Verify you are human reCAPTCHA",
    });

    expect(decision).toMatchObject({
      boundary: "captcha_checkpoint",
      outcome: "account_session_required",
      nextAction: "pause_for_user_verification",
      canAutoContinue: false,
      resumeAfterUserAction: true,
    });
    expect(decision.forbiddenAutomation).toContain("solve_captcha");
  });

  it("pauses for user seat selection and allows resume only after the user chooses", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://www.ticketmaster.com/event/1D0062E4AABB?seatmap=true",
      visibleText: "Select Seats Section 101 Row A Choose seats",
      buttons: ["Select Seats"],
    });

    expect(decision).toMatchObject({
      boundary: "seat_selection_checkpoint",
      outcome: "user_seat_selection_required",
      nextAction: "pause_for_user_seat_selection",
      canAutoContinue: false,
      requiresUserAction: true,
      resumeAfterUserAction: true,
    });
    expect(decision.forbiddenAutomation).toContain("auto_select_seats");
  });

  it("pauses at payment fields and forbids CVV and payment submission", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText:
        "Checkout Payment Method Card Number Expiration Date CVV Billing address",
      fields: ["Card number", "Expiration date", "CVV", "Billing address"],
    });

    expect(decision).toMatchObject({
      boundary: "payment_checkpoint",
      outcome: "payment_or_final_action_required",
      nextAction: "pause_before_payment",
      canAutoContinue: false,
      resumeAfterUserAction: false,
    });
    expect(decision.forbiddenAutomation).toEqual(
      expect.arrayContaining(["fill_cvv", "submit_payment"]),
    );
  });

  it("can prefill authorized saved-card fields except CVV, then pause", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText:
        "Checkout Payment Method Card Number Expiration Date CVV Billing address",
      fields: ["Card number", "Expiration date", "CVV", "Billing address"],
      authorizedCapabilities: { paymentCardWithoutCvv: true },
    });

    expect(decision).toMatchObject({
      boundary: "payment_checkpoint",
      outcome: "payment_or_final_action_required",
      nextAction: "prefill_card_except_cvv_then_pause",
      canAutoContinue: false,
      requiresUserAction: true,
      resumeAfterUserAction: false,
    });
    expect(decision.allowedAssistance).toContain("fill_payment_card_without_cvv");
    expect(decision.forbiddenAutomation).toEqual(
      expect.arrayContaining(["fill_cvv", "submit_payment"]),
    );
  });

  it("pauses at final confirmation and forbids final purchase clicks", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      visibleText: "Review your order Place Order",
      buttons: ["Place Order"],
    });

    expect(decision).toMatchObject({
      boundary: "final_confirmation_checkpoint",
      outcome: "payment_or_final_action_required",
      nextAction: "pause_before_final_confirmation",
      canAutoContinue: false,
      requiresUserAction: true,
    });
    expect(decision.forbiddenAutomation).toContain("click_final_confirmation");
  });

  it("classifies provider error pages before any misleading seat or login text", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl:
        "https://www.ticketmaster.com/hamilton-new-york-ny-04-15-2026/event/A1B2C3D4E5F6",
      visibleText:
        "PAGE NOT FOUND Return to home or search to discover more Select seats Sign In",
      buttons: ["Sign In"],
    });

    expect(decision).toMatchObject({
      boundary: "provider_degraded",
      outcome: "provider_degraded",
      nextAction: "review_provider_degraded",
      canAutoContinue: false,
      requiresUserAction: false,
    });
  });

  it("blocks continuation when required lab evidence is missing", () => {
    const decision = buildTicketmasterForgeDecision({
      ...baseObservation,
      currentUrl: "",
      screenshotRef: "",
      actionLog: [],
    });

    expect(decision).toMatchObject({
      boundary: "insufficient_evidence",
      outcome: "insufficient_evidence",
      nextAction: "collect_more_evidence",
      canAutoContinue: false,
      missingEvidence: ["currentUrl", "screenshot", "action_log"],
    });
  });
});

describe("Ticketmaster skill forge safety policy", () => {
  it("allows trusted session reuse and non-payment profile prefill", () => {
    expect(getTicketmasterAllowedAssistance()).toEqual([
      "reuse_user_authorized_provider_session",
      "use_profile_credentials_for_provider_login",
      "read_gmail_otp_for_active_provider_login",
      "fill_payment_card_without_cvv",
      "prefill_non_payment_profile_fields",
      "resume_after_user_boundary_action",
      "inspect_page_and_collect_evidence",
      "click_reversible_ticket_cta_before_hard_stop",
    ]);
  });

  it("keeps the explicit forbidden automation list stable", () => {
    expect(getTicketmasterForbiddenAutomation()).toEqual([
      "solve_captcha",
      "auto_select_seats",
      "fill_cvv",
      "submit_payment",
      "click_final_confirmation",
      "use_unscoped_credentials",
      "read_unrelated_email",
      "store_plaintext_payment_secret",
    ]);
  });

  it("distinguishes authorized credential use from unscoped credential use", () => {
    const decision = buildTicketmasterForgeDecision(baseObservation);

    expect(decision.allowedAssistance).toContain(
      "reuse_user_authorized_provider_session",
    );
    expect(decision.allowedAssistance).toContain(
      "use_profile_credentials_for_provider_login",
    );
    expect(decision.forbiddenAutomation).toContain("use_unscoped_credentials");
  });

  it("only resumes after user-action checkpoints, never payment or final confirmation", () => {
    const resumable: TicketmasterForgeBoundary[] = [
      "needs_user_choice",
      "login_checkpoint",
      "captcha_checkpoint",
      "otp_checkpoint",
      "seat_selection_checkpoint",
    ];
    const notResumable: TicketmasterForgeBoundary[] = [
      "none",
      "payment_checkpoint",
      "final_confirmation_checkpoint",
      "provider_degraded",
      "insufficient_evidence",
    ];

    for (const boundary of resumable) {
      expect(canResumeTicketmasterAfterUserAction(boundary), boundary).toBe(true);
    }
    for (const boundary of notResumable) {
      expect(canResumeTicketmasterAfterUserAction(boundary), boundary).toBe(false);
    }
  });
});
