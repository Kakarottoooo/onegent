import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PROVIDER_SKILLS,
  findActivityProviderSkill,
  isActivitySkillExactEvent,
  resolveActivityProviderSkillUrl,
} from "@/lib/activity-skills";

describe("activity provider skill registry", () => {
  it("registers the Stage 0B activity providers with safety stops and evidence contracts", () => {
    expect(ACTIVITY_PROVIDER_SKILLS.map((skill) => skill.provider)).toEqual([
      "ticketmaster",
      "seatgeek",
      "stubhub",
      "eventbrite",
      "axs",
    ]);

    for (const skill of ACTIVITY_PROVIDER_SKILLS) {
      expect(skill.requiredInputs).toContain("input_url");
      expect(skill.hardStops).toEqual(
        expect.arrayContaining([
          "seat_selection",
          "login",
          "account_verification",
          "captcha",
          "otp",
          "payment",
          "final_purchase",
          "final_confirmation",
        ]),
      );
      expect(skill.evidenceContract.minimumForLabRun).toEqual(
        expect.arrayContaining([
          "provider",
          "page_type",
          "current_url",
          "screenshot",
          "action_log",
          "safe_next_action",
        ]),
      );
    }
  });

  it("finds skills by provider without falling back to the wrong provider", () => {
    expect(findActivityProviderSkill("ticketmaster")?.provider).toBe("ticketmaster");
    expect(findActivityProviderSkill("axs")?.provider).toBe("axs");
  });
});
describe("activity provider skill URL matching", () => {
  it("treats exact Ticketmaster event URLs as direct task starts", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581/event/1D0062E4AABB",
    );

    expect(match).toMatchObject({
      provider: "ticketmaster",
      pageType: "exact_event",
      providerPageId: "1D0062E4AABB",
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
    });
    expect(isActivitySkillExactEvent(match!)).toBe(true);
  });

  it("treats Ticketmaster artist pages as provider-start pages requiring user choice", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    );

    expect(match).toMatchObject({
      provider: "ticketmaster",
      pageType: "artist_or_performer",
      providerPageId: "1742147",
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
    });
    expect(isActivitySkillExactEvent(match!)).toBe(false);
  });

  it("recognizes dated SeatGeek event pages as exact events", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
    );

    expect(match).toMatchObject({
      provider: "seatgeek",
      pageType: "exact_event",
      providerPageId: "17921493",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
  });

  it("keeps SeatGeek performer/listing pages as provider-start pages", () => {
    const match = resolveActivityProviderSkillUrl("https://seatgeek.com/hamilton-tickets");

    expect(match).toMatchObject({
      provider: "seatgeek",
      pageType: "listing",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("keeps StubHub performer and grouping pages as user-choice provider starts", () => {
    expect(resolveActivityProviderSkillUrl("https://www.stubhub.com/bts-tickets/performer/1503185")).toMatchObject({
      provider: "stubhub",
      pageType: "artist_or_performer",
      providerPageId: "1503185",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
    expect(resolveActivityProviderSkillUrl("https://www.stubhub.com/world-cup-tickets/grouping/45410")).toMatchObject({
      provider: "stubhub",
      pageType: "grouping",
      providerPageId: "45410",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("recognizes Eventbrite event pages but keeps directories as listings", () => {
    expect(resolveActivityProviderSkillUrl("https://www.eventbrite.com/e/summer-concert-tickets-123456789")).toMatchObject({
      provider: "eventbrite",
      pageType: "exact_event",
      providerPageId: "123456789",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
    expect(resolveActivityProviderSkillUrl("https://www.eventbrite.com/d/ny--new-york/music--events/")).toMatchObject({
      provider: "eventbrite",
      pageType: "listing",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("supports AXS event, artist, and listing pages", () => {
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/events/123456/example-event")).toMatchObject({
      provider: "axs",
      pageType: "exact_event",
      providerPageId: "123456",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/artists/98765/example-artist")).toMatchObject({
      provider: "axs",
      pageType: "artist_or_performer",
      providerPageId: "98765",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/search?q=concert")).toMatchObject({
      provider: "axs",
      pageType: "listing",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("rejects provider impersonation and malformed URLs from direct execution", () => {
    for (const url of [
      "https://ticketmaster.com.evil.example/event/abc",
      "https://seatgeek.com.evil.example/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
      "https://stubhub.com.evil.example/bts-tickets/performer/1503185",
      "https://eventbrite.com.evil.example/e/summer-concert-tickets-123456789",
      "https://axs.com.evil.example/events/123456/example-event",
    ]) {
      const match = resolveActivityProviderSkillUrl(url);
      expect(match).toMatchObject({
        provider: "unknown",
        pageType: "unknown_provider_page",
        executionMode: "review_capture",
        needsUserChoice: true,
        safeNextAction: "review_capture",
      });
      expect(isActivitySkillExactEvent(match!)).toBe(false);
    }

    expect(resolveActivityProviderSkillUrl("javascript:https://ticketmaster.com/event/abc")).toBeNull();
    expect(resolveActivityProviderSkillUrl("not a url")).toBeNull();
  });
});
