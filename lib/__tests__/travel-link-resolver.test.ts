import { describe, expect, it } from "vitest";
import {
  resolveTravelLinkFromUrl,
  titleizeTravelSlug,
} from "@/lib/capture/travel-link-resolver";

describe("resolveTravelLinkFromUrl", () => {
  it.each([
    [
      "Ticketmaster artist",
      "https://www.ticketmaster.com/kacey-musgraves-tickets/artist/1668663?ac_link=ntm_kaceymusgraves26-1_spotlight_1",
      {
        provider: "ticketmaster",
        page_type: "artist",
        provider_page_id: "1668663",
        title_hint: "Kacey Musgraves",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
    [
      "Ticketmaster exact event",
      "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85",
      {
        provider: "ticketmaster",
        page_type: "exact_event",
        provider_page_id: "1B0063739937BB85",
        execution_mode: "direct_execution",
        needs_user_choice: false,
      },
    ],
    [
      "StubHub performer",
      "https://www.stubhub.com/bts-tickets/performer/1503185",
      {
        provider: "stubhub",
        page_type: "performer",
        provider_page_id: "1503185",
        title_hint: "BTS",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
    [
      "StubHub grouping",
      "https://www.stubhub.com/nba-playoffs-tickets/grouping/107517",
      {
        provider: "stubhub",
        page_type: "grouping",
        provider_page_id: "107517",
        title_hint: "NBA Playoffs",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
    [
      "SeatGeek dated sports event",
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
      {
        provider: "seatgeek",
        page_type: "exact_event",
        provider_page_id: "17921493",
        title_hint: "Nashville Sc",
        execution_mode: "direct_execution",
        needs_user_choice: false,
      },
    ],
    [
      "SeatGeek dated concert event",
      "https://seatgeek.com/chris-stapleton-tickets/nashville-tennessee-nissan-stadium-2026-05-23-6-pm/concert/17990981",
      {
        provider: "seatgeek",
        page_type: "exact_event",
        provider_page_id: "17990981",
        title_hint: "Chris Stapleton",
        execution_mode: "direct_execution",
        needs_user_choice: false,
      },
    ],
    [
      "SeatGeek performer listing",
      "https://seatgeek.com/hamilton-tickets",
      {
        provider: "seatgeek",
        page_type: "provider_listing",
        provider_page_id: "hamilton-tickets",
        title_hint: "Hamilton",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
    [
      "AXS exact event",
      "https://www.axs.com/events/901001/red-rocks-summer-night-tickets",
      {
        provider: "axs",
        page_type: "exact_event",
        provider_page_id: "901001",
        title_hint: "Red Rocks Summer Night",
        execution_mode: "direct_execution",
        needs_user_choice: false,
      },
    ],
    [
      "AXS artist",
      "https://www.axs.com/artists/110001/foo-fighters-tickets",
      {
        provider: "axs",
        page_type: "artist",
        provider_page_id: "110001",
        title_hint: "Foo Fighters",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
    [
      "AXS search",
      "https://www.axs.com/search?q=red%20rocks",
      {
        provider: "axs",
        page_type: "search_results",
        provider_page_id: "search",
        title_hint: "AXS Search",
        execution_mode: "provider_start",
        needs_user_choice: true,
      },
    ],
  ])("classifies %s", (_label, url, expected) => {
    expect(resolveTravelLinkFromUrl(url)).toMatchObject({
      vertical: "activity",
      safe_next_action: "start_task",
      ...expected,
    });
  });

  it("rejects host impersonation from direct provider handling", () => {
    expect(resolveTravelLinkFromUrl("https://ticketmaster.com.evil.example/event/abc")).toMatchObject({
      provider: "unknown",
      vertical: "unknown",
      safe_next_action: "review_capture",
    });
  });

  it("normalizes ttps:// pasted URLs before classification", () => {
    expect(resolveTravelLinkFromUrl("ttps://www.stubhub.com/world-cup-tickets/grouping/45410")).toMatchObject({
      normalized_url: "https://www.stubhub.com/world-cup-tickets/grouping/45410",
      provider: "stubhub",
      page_type: "grouping",
    });
  });
});

describe("titleizeTravelSlug", () => {
  it("removes provider boilerplate without destroying acronym event names", () => {
    expect(titleizeTravelSlug("bts-tickets")).toBe("BTS");
    expect(titleizeTravelSlug("nba-playoffs-tickets")).toBe("NBA Playoffs");
    expect(titleizeTravelSlug("disney-on-ice-presents-find-your-tickets")).toBe(
      "Disney On Ice Presents",
    );
  });
});

describe("resolveTravelLinkFromUrl StubHub exact event and checkout boundaries", () => {
  it("recognizes StubHub /event/<id> URLs as exact events", () => {
    expect(
      resolveTravelLinkFromUrl("https://www.stubhub.com/john-mulaney-nashville-tickets-6-12-2026/event/160512394/"),
    ).toMatchObject({
      provider: "stubhub",
      page_type: "exact_event",
      provider_page_id: "160512394",
      title_hint: "John Mulaney Nashville Tickets 6 12 2026",
      execution_mode: "direct_execution",
      needs_user_choice: false,
      safe_next_action: "start_task",
      evidence: { matched_pattern: "stubhub_event" },
    });
  });

  it("keeps StubHub checkout URLs at review_capture instead of direct provider execution", () => {
    expect(
      resolveTravelLinkFromUrl("https://checkout.stubhub.com/secure/buy/checkout?ID=d045373b-46cb-4b2c-adb8-185255e52d55%7c12631332481%7c2%7c0"),
    ).toMatchObject({
      provider: "stubhub",
      page_type: "unknown_provider_page",
      provider_page_id: "checkout",
      execution_mode: "review_capture",
      needs_user_choice: true,
      safe_next_action: "review_capture",
      evidence: { matched_pattern: "stubhub_checkout_boundary" },
    });
  });
});
