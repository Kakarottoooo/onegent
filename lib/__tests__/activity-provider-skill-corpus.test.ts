import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PROVIDER_SKILL_URL_FIXTURES,
  activityProviderSkillFixtureCounts,
} from "@/lib/capture/activity-provider-skill-corpus";
import { resolveTravelLinkFromUrl } from "@/lib/capture/travel-link-resolver";

describe("activity provider skill URL corpus", () => {
  it("has 20 or more no-live URL fixtures for StubHub, Eventbrite, and AXS", () => {
    expect(activityProviderSkillFixtureCounts()).toEqual({
      stubhub: 21,
      eventbrite: 21,
      axs: 21,
    });
  });

  it.each(ACTIVITY_PROVIDER_SKILL_URL_FIXTURES)(
    "resolves $id with the expected provider skill boundary",
    (fixture) => {
      const resolved = resolveTravelLinkFromUrl(fixture.url);

      if (fixture.kind === "malformed") {
        expect(resolved).toBeNull();
        expect(fixture.expected).toMatchObject({
          provider: "unknown",
          page_type: "unknown_provider_page",
          execution_mode: "review_capture",
          needs_user_choice: true,
          safe_next_action: "review_capture",
          hard_stop: "review_only_no_execution",
        });
        return;
      }

      expect(resolved).toMatchObject({
        provider: fixture.expected.provider,
        page_type: fixture.expected.page_type,
        execution_mode: fixture.expected.execution_mode,
        needs_user_choice: fixture.expected.needs_user_choice,
        safe_next_action: fixture.expected.safe_next_action,
        hard_stop: fixture.expected.hard_stop,
      });

      if (fixture.expected.provider_page_id) {
        expect(resolved?.provider_page_id).toBe(fixture.expected.provider_page_id);
      }
      if (fixture.expected.matched_pattern) {
        expect(resolved?.evidence.matched_pattern).toBe(fixture.expected.matched_pattern);
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
      const resolved = resolveTravelLinkFromUrl(fixture.url);
      expect(resolved?.page_type).not.toBe("exact_event");
      expect(resolved?.execution_mode).toBe("provider_start");
      expect(resolved?.needs_user_choice).toBe(true);
    }
  });

  it("only marks exact events when the provider URL pattern proves an event id", () => {
    const exactFixtures = ACTIVITY_PROVIDER_SKILL_URL_FIXTURES.filter(
      (fixture) => fixture.kind === "exact_event",
    );

    expect(exactFixtures.length).toBeGreaterThan(0);
    for (const fixture of exactFixtures) {
      const resolved = resolveTravelLinkFromUrl(fixture.url);
      expect(resolved).toMatchObject({
        provider: fixture.provider,
        page_type: "exact_event",
        execution_mode: "direct_execution",
        needs_user_choice: false,
        safe_next_action: "start_task",
        hard_stop: "seat_selection_login_payment_or_final_confirmation",
      });
      expect(resolved?.provider_page_id).toBe(fixture.expected.provider_page_id);
    }
  });

  it("rejects host impersonation for StubHub, Eventbrite, and AXS", () => {
    const impersonationFixtures = ACTIVITY_PROVIDER_SKILL_URL_FIXTURES.filter(
      (fixture) => fixture.kind === "impersonation",
    );

    expect(impersonationFixtures.map((fixture) => fixture.provider).sort()).toEqual([
      "axs",
      "axs",
      "eventbrite",
      "eventbrite",
      "stubhub",
      "stubhub",
    ]);

    for (const fixture of impersonationFixtures) {
      const resolved = resolveTravelLinkFromUrl(fixture.url);
      expect(resolved).toMatchObject({
        provider: "unknown",
        vertical: "unknown",
        page_type: "unknown_provider_page",
        execution_mode: "review_capture",
        needs_user_choice: true,
        safe_next_action: "review_capture",
        hard_stop: "review_only_no_execution",
      });
    }
  });
});
