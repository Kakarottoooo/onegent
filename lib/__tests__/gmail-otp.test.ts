import { describe, expect, it } from "vitest";
import {
  buildProviderOtpGmailQuery,
  extractOtpCodeFromText,
  findProviderOtpInGmailMessages,
  messageMatchesProvider,
} from "@/lib/gmail-otp";
import type { GoogleGmailMessage } from "@/lib/google-gmail";

function msg(overrides: Partial<GoogleGmailMessage> = {}): GoogleGmailMessage {
  return {
    id: "msg-1",
    internalDate: String(Date.parse("2026-05-08T06:00:00.000Z")),
    snippet: "Your Ticketmaster verification code is 123456",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Ticketmaster <no-reply@ticketmaster.com>" },
        { name: "Subject", value: "Your Ticketmaster verification code" },
      ],
      body: {
        data: Buffer.from("Your Ticketmaster verification code is 123456.", "utf8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, ""),
      },
    },
    ...overrides,
  };
}

describe("Gmail OTP provider queries", () => {
  it("builds a provider-scoped recent Gmail query", () => {
    const query = buildProviderOtpGmailQuery({
      provider: "ticketmaster",
      windowMinutes: 15,
    });

    expect(query).toContain("newer_than:15m");
    expect(query).toContain("from:ticketmaster.com");
    expect(query).toContain("verification code");
    expect(query).not.toContain("in:anywhere");
  });

  it("clamps the search window to prevent broad mailbox reads", () => {
    expect(buildProviderOtpGmailQuery({ provider: "resy", windowMinutes: 240 }))
      .toContain("newer_than:60m");
    expect(buildProviderOtpGmailQuery({ provider: "opentable", windowMinutes: -5 }))
      .toContain("newer_than:1m");
  });
});

describe("Gmail OTP extraction", () => {
  it("extracts six-digit OTP codes near code wording", () => {
    expect(extractOtpCodeFromText("Your code is 123456.")).toBe("123456");
    expect(extractOtpCodeFromText("Ticket #987654321 is not an OTP")).toBeNull();
  });

  it("requires provider-scoped messages before returning an OTP", () => {
    const result = findProviderOtpInGmailMessages({
      provider: "ticketmaster",
      query: "newer_than:15m from:ticketmaster.com",
      requestedAt: new Date("2026-05-08T06:05:00.000Z"),
      messages: [msg()],
    });

    expect(result).toMatchObject({
      status: "found",
      provider: "ticketmaster",
      code: "123456",
      messageId: "msg-1",
      from: "Ticketmaster <no-reply@ticketmaster.com>",
      subject: "Your Ticketmaster verification code",
    });
  });

  it("rejects unrelated provider messages even if they contain a code", () => {
    const result = findProviderOtpInGmailMessages({
      provider: "ticketmaster",
      query: "newer_than:15m from:ticketmaster.com",
      requestedAt: new Date("2026-05-08T06:05:00.000Z"),
      messages: [
        msg({
          id: "resy-1",
          snippet: "Your Resy code is 333444",
          payload: {
            headers: [
              { name: "From", value: "Resy <login@resy.com>" },
              { name: "Subject", value: "Your Resy code" },
            ],
            body: {
              data: Buffer.from("Your Resy verification code is 333444.", "utf8")
                .toString("base64url"),
            },
          },
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "not_found",
      reason: "no_provider_message",
      checkedMessageIds: ["resy-1"],
    });
  });

  it("rejects stale provider OTP messages outside the active task window", () => {
    const result = findProviderOtpInGmailMessages({
      provider: "ticketmaster",
      query: "newer_than:15m from:ticketmaster.com",
      requestedAt: new Date("2026-05-08T06:30:00.000Z"),
      windowMinutes: 15,
      messages: [msg()],
    });

    expect(result).toMatchObject({
      status: "not_found",
      reason: "no_recent_message",
    });
  });

  it("recognizes supported provider sender domains", () => {
    expect(messageMatchesProvider("ticketmaster", msg())).toBe(true);
    expect(
      messageMatchesProvider(
        "opentable",
        msg({
          payload: {
            headers: [
              { name: "From", value: "OpenTable <no-reply@opentable.com>" },
              { name: "Subject", value: "Verification code" },
            ],
          },
        }),
      ),
    ).toBe(true);
  });
});
