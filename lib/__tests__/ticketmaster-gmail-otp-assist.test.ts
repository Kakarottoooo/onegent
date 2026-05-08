import { describe, expect, it } from "vitest";
import { buildTicketmasterDecisionWithGmailOtpAssist } from "@/lib/activity-skills";

const otpObservation = {
  currentUrl: "https://auth.ticketmaster.com/as/authorization.oauth2",
  pageType: "exact_event",
  visibleText: "Enter the verification code sent to your email",
  fields: ["Verification code"],
  screenshotRef: "artifact://tm/otp.png",
  actionLog: ["opened auth page", "captured otp prompt"],
} as const;

describe("Ticketmaster Gmail OTP assist bridge", () => {
  it("enables Gmail OTP continuation only when OTP assist found an active provider code", () => {
    const decision = buildTicketmasterDecisionWithGmailOtpAssist({
      observation: otpObservation,
      otpAssist: {
        connected: true,
        status: "found",
        provider: "ticketmaster",
        code: "123456",
        messageId: "msg-1",
        receivedAt: "2026-05-08T06:00:00.000Z",
        from: "Ticketmaster <no-reply@ticketmaster.com>",
        subject: "Your verification code",
        query: "newer_than:15m from:ticketmaster.com",
      },
    });

    expect(decision).toMatchObject({
      boundary: "otp_checkpoint",
      nextAction: "use_authorized_gmail_otp",
      canAutoContinue: true,
      requiresUserAction: false,
    });
  });

  it("keeps OTP checkpoints manual when Gmail OTP assist misses", () => {
    const decision = buildTicketmasterDecisionWithGmailOtpAssist({
      observation: otpObservation,
      otpAssist: {
        connected: true,
        status: "not_found",
        provider: "ticketmaster",
        query: "newer_than:15m from:ticketmaster.com",
        checkedMessageIds: [],
        reason: "no_provider_message",
      },
    });

    expect(decision).toMatchObject({
      boundary: "otp_checkpoint",
      nextAction: "pause_for_user_verification",
      canAutoContinue: false,
      requiresUserAction: true,
    });
  });
});
