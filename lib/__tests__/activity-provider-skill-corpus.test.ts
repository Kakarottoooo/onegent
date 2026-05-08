import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PROVIDER_SKILL_URL_FIXTURES,
  activityProviderSkillFixtureCounts,
  findActivityProviderSkill,
  isActivitySkillExactEvent,
  resolveActivityProviderSkillUrl,
} from "@/lib/activity-skills";

describe("activity provider skill URL corpus", () => {
  it("has 21 no-live URL fixtures for StubHub, Eventbrite, and AXS", () => {
    expect(activityProviderSkillFixtureCounts()).toEqual({
      stubhub: 21,
      eventbrite: 21,
      axs: 21,
    });
  });

  it.each(ACTIVITY_PROVIDER_SKILL_URL_FIXTURES)(
    "resolves $id with the expected activity skill boundary",
    (fixture) => {
      const resolved = resolveActivityProviderSkillUrl(fixture.url);

      if (fixture.outcome === "null") {
        expect(resolved).toBeNull();
        return;
      }

      if (fixture.outcome === "unknown") {
        expect(resolved).toMatchObject({
          provider: "unknown",
          pageType: "unknown_provider_page",
          executionMode: "review_capture",
          needsUserChoice: true,
          safeNextAction: "review_capture",
        });
        expect(isActivitySkillExactEvent(resolved!)).toBe(false);
        return;
      }

      expect(resolved).toMatchObject({
        provider: fixture.expected.provider,
        pageType: fixture.expected.pageType,
        executionMode: fixture.expected.executionMode,
        needsUserChoice: fixture.expected.needsUserChoice,
        safeNextAction: fixture.expected.safeNextAction,
      });

      if (fixture.expected.providerPageId) {
        expect(resolved?.providerPageId).toBe(fixture.expected.providerPageId);
      }
      if (fixture.expected.matchedPattern) {
        expect(resolved?.evidence.matchedPattern).toBe(fixture.expected.matchedPattern);
      }
    },
  );

  it("never treats listing, grouping, performer, artist, organizer, or search URLs as exact-event evidence", () => {
    const nonExactFixtures = ACTIVITY_PROVIDER_SKILL_URL_FIXTURES.filter(
      (fixture) =>
        fixture.kind !== "exact_event" &&
        fixture.kind !== "malformed" &&
        fixture.kind !== "impersonation",
    );

    expect(nonExactFixtures.length).toBeGreaterThan(0);
    for (const fixture of nonExactFixtures) {
      const resolved = resolveActivityProviderSkillUrl(fixture.url);
      expect(resolved?.pageType).not.toBe("exact_event");
      expect(resolved?.executionMode).toBe("provider_start");
      expect(resolved?.needsUserChoice).toBe(true);
      expect(isActivitySkillExactEvent(resolved!)).toBe(false);
    }
  });

  it("only marks exact events when the provider URL pattern proves an event id", () => {
    const exactFixtures = ACTIVITY_PROVIDER_SKILL_URL_FIXTURES.filter(
      (fixture) => fixture.kind === "exact_event",
    );

    expect(exactFixtures.length).toBeGreaterThan(0);
    for (const fixture of exactFixtures) {
      const resolved = resolveActivityProviderSkillUrl(fixture.url);
      expect(resolved).toMatchObject({
        provider: fixture.provider,
        pageType: "exact_event",
        executionMode: "direct_execution",
        needsUserChoice: false,
        safeNextAction: "start_task",
      });
      expect(resolved?.providerPageId).toBe(fixture.expected.providerPageId);
      expect(isActivitySkillExactEvent(resolved!)).toBe(true);
    }
  });

  it("keeps every known provider skill under the shared safe hard-stop contract", () => {
    for (const provider of ["stubhub", "eventbrite", "axs"] as const) {
      expect(findActivityProviderSkill(provider)?.hardStops).toEqual(
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
    }
  });
});
