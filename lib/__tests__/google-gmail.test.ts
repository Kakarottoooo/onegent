import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_GMAIL_SCOPES,
  buildGoogleGmailAuthUrl,
  decodeGmailBodyData,
  extractTextFromGoogleGmailMessage,
  fetchGoogleGmailProfile,
  searchGoogleGmailMessages,
} from "@/lib/google-gmail";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-client";
  process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("Google Gmail OAuth", () => {
  it("requests only Gmail readonly scope on a separate consent URL", () => {
    const url = new URL(
      buildGoogleGmailAuthUrl({
        redirectUri: "https://onegent.example/api/gmail/google/callback",
        state: "state-1",
      }),
    );

    expect(url.searchParams.get("client_id")).toBe("gmail-client");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_GMAIL_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).not.toContain("calendar");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/gmail/google/callback");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("Google Gmail API helpers", () => {
  it("decodes base64url Gmail bodies and strips HTML", () => {
    const encoded = Buffer.from("<b>Your code is 123456</b>", "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(decodeGmailBodyData(encoded)).toBe("<b>Your code is 123456</b>");
    expect(
      extractTextFromGoogleGmailMessage({
        id: "msg-1",
        snippet: "Ticketmaster",
        payload: {
          mimeType: "text/html",
          body: { data: encoded },
          headers: [],
        },
      }),
    ).toBe("Ticketmaster Your code is 123456");
  });

  it("fetches profile metadata without requesting message bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        emailAddress: "user@gmail.com",
        messagesTotal: 10,
        threadsTotal: 5,
        historyId: "h1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchGoogleGmailProfile("token");

    expect(profile).toMatchObject({ emailAddress: "user@gmail.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("searches Gmail with caller-provided provider-scoped query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "m1", threadId: "t1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const messages = await searchGoogleGmailMessages({
      accessToken: "token",
      query: "newer_than:15m from:ticketmaster.com",
      maxResults: 3,
    });

    expect(messages).toEqual([{ id: "m1", threadId: "t1" }]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(url.searchParams.get("q")).toBe("newer_than:15m from:ticketmaster.com");
    expect(url.searchParams.get("maxResults")).toBe("3");
  });
});
