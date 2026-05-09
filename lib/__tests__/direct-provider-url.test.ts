import { describe, expect, it } from "vitest";
import {
  buildDirectActivityTask,
  parseDirectActivityProviderUrl,
  readDirectActivityProviderUrlFromConstraints,
} from "@/lib/capture/direct-provider-url";

describe("direct activity provider URL parsing", () => {
  it("accepts the exact Ticketmaster event URL the user pasted", () => {
    const parsed = parseDirectActivityProviderUrl(
      "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85",
    );

    expect(parsed).toMatchObject({
      provider: "ticketmaster",
      pageType: "event",
      url: "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85",
      host: "www.ticketmaster.com",
      providerPageId: "1B0063739937BB85",
      eventId: "1B0063739937BB85",
      needsUserChoice: false,
      executionMode: "direct_execution",
    });
  });

  it("accepts Ticketmaster artist pages as provider-start URLs", () => {
    const parsed = parseDirectActivityProviderUrl(
      "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV",
    );

    expect(parsed).toMatchObject({
      provider: "ticketmaster",
      pageType: "artist",
      url: "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV",
      host: "www.ticketmaster.com",
      providerPageId: "712214",
      artistId: "712214",
      titleHint: "Lil Wayne",
      needsUserChoice: true,
      executionMode: "provider_start",
    });
  });

  it("accepts StubHub performer and grouping pages as provider-start URLs", () => {
    expect(
      parseDirectActivityProviderUrl("https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867"),
    ).toMatchObject({
      provider: "stubhub",
      pageType: "performer",
      providerPageId: "101864867",
      titleHint: "Olivia Rodrigo",
      needsUserChoice: true,
      executionMode: "provider_start",
    });

    expect(
      parseDirectActivityProviderUrl("https://www.stubhub.com/world-cup-tickets/grouping/45410"),
    ).toMatchObject({
      provider: "stubhub",
      pageType: "grouping",
      providerPageId: "45410",
      titleHint: "World Cup",
      needsUserChoice: true,
      executionMode: "provider_start",
    });
  });

  it("accepts StubHub exact events and rejects StubHub checkout links", () => {
    expect(
      parseDirectActivityProviderUrl("https://www.stubhub.com/john-mulaney-nashville-tickets-6-12-2026/event/160512394/"),
    ).toMatchObject({
      provider: "stubhub",
      pageType: "event",
      providerPageId: "160512394",
      eventId: "160512394",
      needsUserChoice: false,
      executionMode: "direct_execution",
    });

    expect(
      parseDirectActivityProviderUrl("https://checkout.stubhub.com/secure/buy/checkout?ID=payment-boundary"),
    ).toBeNull();
  });

  it("accepts SeatGeek dated event and listing pages", () => {
    expect(
      parseDirectActivityProviderUrl("https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493"),
    ).toMatchObject({
      provider: "seatgeek",
      pageType: "event",
      providerPageId: "17921493",
      titleHint: "Nashville Sc",
      needsUserChoice: false,
      executionMode: "direct_execution",
    });

    expect(parseDirectActivityProviderUrl("https://seatgeek.com/hamilton-tickets")).toMatchObject({
      provider: "seatgeek",
      pageType: "listing",
      providerPageId: "hamilton-tickets",
      titleHint: "Hamilton",
      needsUserChoice: true,
      executionMode: "provider_start",
    });
  });

  it("cleans trailing chat text after the event id", () => {
    const parsed = parseDirectActivityProviderUrl(
      "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85,帮我预定一下这个",
    );

    expect(parsed?.url).toBe(
      "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85",
    );
    expect(parsed?.eventId).toBe("1B0063739937BB85");
  });

  it("accepts locale Ticketmaster event hosts", () => {
    expect(parseDirectActivityProviderUrl("https://www.ticketmaster.co.uk/event/abc123")?.eventId).toBe("abc123");
    expect(parseDirectActivityProviderUrl("https://checkout.ticketmaster.ca/event/G5viZbMC_uDmA")?.eventId).toBe(
      "G5viZbMC_uDmA",
    );
  });

  it("rejects impersonation and unsupported Ticketmaster URLs", () => {
    expect(parseDirectActivityProviderUrl("https://ticketmaster.com.evil.example/event/abc123")).toBeNull();
    expect(parseDirectActivityProviderUrl("https://ticketmaster.com.evil.example/artist/712214")).toBeNull();
    expect(parseDirectActivityProviderUrl("https://notticketmaster.com/event/abc123")).toBeNull();
    expect(parseDirectActivityProviderUrl("javascript:https://www.ticketmaster.com/event/abc123")).toBeNull();
  });

  it("treats Ticketmaster search pages as provider-start pages that require user choice", () => {
    expect(parseDirectActivityProviderUrl("https://www.ticketmaster.com/search?q=lil%20wayne")).toMatchObject({
      provider: "ticketmaster",
      pageType: "search",
      needsUserChoice: true,
      executionMode: "provider_start",
    });
  });

  it("reads source_url and capture metadata URLs from constraints", () => {
    expect(
      readDirectActivityProviderUrlFromConstraints({
        source_url: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
      })?.eventId,
    ).toBe("1B0063739937BB85");

    expect(
      readDirectActivityProviderUrlFromConstraints({
        _capture_source: {
          url: "https://www.ticketmaster.com/example/event/G5viZbMC_uDmA",
        },
      })?.eventId,
    ).toBe("G5viZbMC_uDmA");
  });

  it("builds a task that locks the executor to the exact provider URL", () => {
    const task = buildDirectActivityTask({
      eventName: "Nashville SC v DC United",
      eventDate: "2026-05-09",
      numTickets: 1,
      providerUrl: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
    });

    expect(task).toContain("Use this exact Ticketmaster event URL");
    expect(task).toContain("Do not search for or replace it with a different Ticketmaster event URL");
    expect(task).toContain("stop before the final purchase");
  });

  it("builds an artist-page task that starts from the provider page instead of generic search", () => {
    const task = buildDirectActivityTask({
      eventName: "Lil Wayne",
      numTickets: 1,
      providerUrl: "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214",
      pageType: "artist",
    });

    expect(task).toContain("Start from this exact Ticketmaster artist page URL");
    expect(task).toContain("Treat this as a provider-start page, not exact event evidence");
    expect(task).toContain("Do not use generic event search");
    expect(task).toContain("use the provider-rendered events, listings, dates, and cities as the source of truth");
    expect(task).toContain("do not report no availability just because that field is missing");
    expect(task).toContain("exactly one obvious matching listing");
    expect(task).toContain("stop before the final purchase");
  });

  it("keeps exact event task copy separate from provider-start copy", () => {
    const task = buildDirectActivityTask({
      eventName: "Nashville SC v DC United",
      eventDate: "2026-05-09",
      numTickets: 1,
      providerUrl: "https://www.ticketmaster.com/example/event/1B0063739937BB85",
      provider: "ticketmaster",
      pageType: "event",
    });

    expect(task).toContain("Use this exact Ticketmaster event URL");
    expect(task).toContain("If this exact provider page is unavailable or not found");
    expect(task).not.toContain("provider-start page");
    expect(task).not.toContain("date or city");
  });

  it("builds a non-Ticketmaster provider-start task without Ticketmaster-specific copy", () => {
    const task = buildDirectActivityTask({
      eventName: "Olivia Rodrigo",
      numTickets: 1,
      providerUrl: "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867",
      provider: "stubhub",
      pageType: "performer",
    });

    expect(task).toContain("Start from this exact StubHub performer page URL");
    expect(task).toContain("unrelated StubHub page");
    expect(task).not.toContain("Ticketmaster");
  });
});
