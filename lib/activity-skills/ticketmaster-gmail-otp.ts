import type { GmailOtpAssistResult } from "@/lib/gmail-otp-service";
import {
  buildTicketmasterForgeDecision,
  type TicketmasterForgeDecision,
  type TicketmasterForgeObservation,
} from "./ticketmaster-skill-forge";

export function buildTicketmasterDecisionWithGmailOtpAssist(params: {
  observation: TicketmasterForgeObservation;
  otpAssist: GmailOtpAssistResult | null;
}): TicketmasterForgeDecision {
  return buildTicketmasterForgeDecision({
    ...params.observation,
    authorizedCapabilities: {
      ...params.observation.authorizedCapabilities,
      gmailOtp:
        params.observation.authorizedCapabilities?.gmailOtp ||
        params.otpAssist?.status === "found",
    },
  });
}
