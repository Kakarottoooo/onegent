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

    expect(parsed).toEqual({
      provider: "ticketmaster",
      pageType: "event",
      url: "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85",
      host: "www.ticketmaster.com",
      providerPageId: "1B0063739937BB85",
      eventId: "1B0063739937BB85",
    });
  });

  it("accepts Ticketmaster artist pages as provider-start URLs", () => {
    const parsed = parseDirectActivityProviderUrl(
      "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV",
    );

    expect(parsed).toEqual({
      provider: "ticketmaster",
      pageType: "artist",
      url: "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV",
      host: "www.ticketmaster.com",
      providerPageId: "712214",
      artistId: "712214",
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
    expect(parseDirectActivityProviderUrl("https://www.ticketmaster.com/search?q=lil%20wayne")).toBeNull();
    expect(parseDirectActivityProviderUrl("javascript:https://www.ticketmaster.com/event/abc123")).toBeNull();
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
    expect(task).toContain("Do not use generic event search");
    expect(task).toContain("Use the events shown on this provider page");
    expect(task).toContain("stop before the final purchase");
  });
});
