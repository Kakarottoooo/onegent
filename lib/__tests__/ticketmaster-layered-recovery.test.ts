import { describe, expect, it } from "vitest";

import {
  FAILURE_CATEGORIES,
  WORKED_EXAMPLES,
  getFailureCategory,
  listFailureCategories,
} from "@/lib/operator-failure-taxonomy";

import {
  classifyTicketmasterStage,
  isTicketmasterTicketOptionsPage,
  looksLikeFindTicketsLabel,
  parseTargetDateTime,
  type TicketmasterStageSnapshot,
} from "@/lib/booking-autopilot/providers/ticketmaster-rpa";

// Test scope: this file proves that the layered-recovery rules described in
// docs/30-provider-debug/TICKETMASTER_LAYERED_RECOVERY.md are reflected in
// the pure code surfaces (taxonomy related-classes, stage classifier, label
// helpers, date parser). These are the surfaces the runtime relies on.
//
// The activity dogfood evidence (job 46028ee4-c644-4df7-bee5-7bcb7d2713f9)
// is the `ticketmaster-lion-king-safe-handoff-2026-05-07` worked example;
// asserting that example stays put protects the doc from drifting away from
// the artifact pack.

const blankStageInputs: Omit<TicketmasterStageSnapshot, "url"> = {
  hasSeatMap: false,
  hasYourTicketsPanel: false,
  hasSubtotal: false,
  hasReserveButton: false,
  reserveEnabled: false,
  hasSeatSelection: false,
  hasSignInHeading: false,
  hasEmailInput: false,
};

describe("Ticketmaster layered recovery -- new classification keys", () => {
  it("registers external_ad_tab_opened as a provider_logic_failure related class", () => {
    const cat = getFailureCategory("provider_logic_failure");
    expect(cat).not.toBeNull();
    expect(cat!.severity).toBe("patchable");
    expect(cat!.relatedClasses).toContain("external_ad_tab_opened");
  });

  it("registers user_seat_selection_required as a safe_boundary_reached related class", () => {
    const cat = getFailureCategory("safe_boundary_reached");
    expect(cat).not.toBeNull();
    expect(cat!.severity).toBe("info");
    expect(cat!.relatedClasses).toContain("user_seat_selection_required");
  });

  it("registers local_browser_disconnected_stale_job as a model_env_transient related class", () => {
    const cat = getFailureCategory("model_env_transient");
    expect(cat).not.toBeNull();
    expect(cat!.severity).toBe("wait");
    expect(cat!.relatedClasses).toContain("local_browser_disconnected_stale_job");
  });

  it("does not promote any of the new keys to a top-level category", () => {
    const topLevel = FAILURE_CATEGORIES.map((c) => c.key);
    expect(topLevel).toEqual([
      "model_env_transient",
      "provider_network_degraded",
      "provider_logic_failure",
      "safe_boundary_reached",
    ]);
    expect(topLevel).not.toContain("external_ad_tab_opened");
    expect(topLevel).not.toContain("user_seat_selection_required");
    expect(topLevel).not.toContain("local_browser_disconnected_stale_job");
  });

  it("each new related class shows up in exactly one category (no double-classifying)", () => {
    const cats = listFailureCategories();
    const occurrences = (key: string) =>
      cats.filter((c) => c.relatedClasses.includes(key)).length;
    expect(occurrences("external_ad_tab_opened")).toBe(1);
    expect(occurrences("user_seat_selection_required")).toBe(1);
    expect(occurrences("local_browser_disconnected_stale_job")).toBe(1);
  });

  it("provider_logic_failure ad-tab signal mentions a wrong-tab / external host condition", () => {
    const cat = getFailureCategory("provider_logic_failure");
    expect(cat).not.toBeNull();
    const haystack = cat!.signals.join("\n").toLowerCase();
    expect(haystack).toMatch(/ad|sponsor|external|wrong tab/);
  });

  it("safe_boundary_reached seat-selection signal mentions reserve disabled or user pick", () => {
    const cat = getFailureCategory("safe_boundary_reached");
    expect(cat).not.toBeNull();
    const haystack = cat!.signals.join("\n").toLowerCase();
    expect(haystack).toMatch(/reserve|seat/);
    expect(haystack).toMatch(/disabled|pick|select/);
  });

  it("model_env_transient stale-job signal mentions local browser / CDP disconnect", () => {
    const cat = getFailureCategory("model_env_transient");
    expect(cat).not.toBeNull();
    const haystack = cat!.signals.join("\n").toLowerCase();
    expect(haystack).toMatch(/cdp|browser/);
    expect(haystack).toMatch(/disconnect|closed|sleep|wi-?fi|reconnect/);
  });
});

describe("Ticketmaster layered recovery -- 2026-05-07 dogfood worked example", () => {
  it("preserves the Lion King safe-handoff worked example as safe_boundary_reached", () => {
    const wx = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("ticketmaster-lion-king-safe-handoff"),
    );
    expect(wx, "Lion King worked example must be present").toBeDefined();
    expect(wx!.category).toBe("safe_boundary_reached");
  });

  it("worked example carries the canonical job id and provider runtime path", () => {
    const wx = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("ticketmaster-lion-king-safe-handoff"),
    );
    expect(wx).toBeDefined();
    const evidenceMap = new Map(wx!.evidence.map((e) => [e.label, e.value]));
    expect(evidenceMap.get("Job id")).toBe(
      "46028ee4-c644-4df7-bee5-7bcb7d2713f9",
    );
    const providerPath = (evidenceMap.get("Provider runtime path") ?? "").toLowerCase();
    expect(providerPath).toContain("ticketmaster-rpa");
    expect(providerPath).toContain("browser harness was not used");
  });

  it("worked example takeaway names the boundary and forbids browser-harness promotion", () => {
    const wx = WORKED_EXAMPLES.find((e) =>
      e.id.startsWith("ticketmaster-lion-king-safe-handoff"),
    );
    expect(wx).toBeDefined();
    const takeaway = wx!.takeaway.toLowerCase();
    expect(takeaway).toMatch(/safe_boundary_reached|not a provider regression|safe handoff/);
    expect(takeaway).toMatch(/browser harness/);
    expect(takeaway).toMatch(/v2 design input|do not repromote|design input/);
  });
});

describe("Ticketmaster layered recovery -- stage classifier coverage matrix", () => {
  // One row per layered-recovery rule documented in
  // docs/30-provider-debug/TICKETMASTER_LAYERED_RECOVERY.md. If the doc grows
  // a new stage, this matrix should grow with it.
  const cases: Array<{
    name: string;
    snap: TicketmasterStageSnapshot;
    stage: ReturnType<typeof classifyTicketmasterStage>;
  }> = [
    {
      name: "artist_calendar -- /artist/<id> with no DOM hints",
      snap: {
        url: "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
        ...blankStageInputs,
      },
      stage: "artist_calendar",
    },
    {
      name: "artist_calendar -- *-tickets/ landing path",
      snap: {
        url: "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/",
        ...blankStageInputs,
      },
      stage: "artist_calendar",
    },
    {
      name: "event_seat_map -- /event/<id> URL is enough",
      snap: {
        url: "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
        ...blankStageInputs,
      },
      stage: "event_seat_map",
    },
    {
      name: "event_seat_map -- canvas seat map present, Reserve still disabled (= user_seat_selection_required boundary)",
      snap: {
        url: "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
        ...blankStageInputs,
        hasSeatMap: true,
        hasReserveButton: true,
        reserveEnabled: false,
      },
      stage: "event_seat_map",
    },
    {
      name: "ticket_selected -- seat picked, Reserve enabled, Your Tickets panel populated",
      snap: {
        url: "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
        ...blankStageInputs,
        hasSeatMap: true,
        hasYourTicketsPanel: true,
        hasSubtotal: true,
        hasReserveButton: true,
        reserveEnabled: true,
        hasSeatSelection: true,
      },
      stage: "ticket_selected",
    },
    {
      name: "account -- auth.ticketmaster.com OAuth boundary",
      snap: {
        url: "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code&client_id=...",
        ...blankStageInputs,
      },
      stage: "account",
    },
    {
      name: "account -- /identity path on main TM domain",
      snap: {
        url: "https://www.ticketmaster.com/identity/login",
        ...blankStageInputs,
      },
      stage: "account",
    },
    {
      name: "account -- email input on /checkout (overlay over seat map)",
      snap: {
        url: "https://checkout.ticketmaster.com/checkout/abc",
        ...blankStageInputs,
        hasEmailInput: true,
        hasSeatMap: true,
      },
      stage: "account",
    },
    {
      name: "checkout -- checkout.ticketmaster.com (post-Reserve)",
      snap: {
        url: "https://checkout.ticketmaster.com/cart/abc123",
        ...blankStageInputs,
      },
      stage: "checkout",
    },
    {
      name: "checkout -- payments.ticketmaster.com (Proceed-to-Payment landed)",
      snap: {
        url: "https://payments.ticketmaster.com/pay/abc123",
        ...blankStageInputs,
      },
      stage: "checkout",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(classifyTicketmasterStage(c.snap)).toBe(c.stage);
    });
  }

  it("account boundary always wins over a stale seat-map snapshot", () => {
    expect(
      classifyTicketmasterStage({
        url: "https://auth.ticketmaster.com/as/authorization.oauth2",
        ...blankStageInputs,
        hasSeatMap: true,
        hasYourTicketsPanel: true,
        hasReserveButton: true,
        reserveEnabled: true,
        hasSeatSelection: true,
      }),
    ).toBe("account");
  });
});

describe("Ticketmaster layered recovery -- recovery helper rules", () => {
  it("Find Tickets label rule matches drawer button variants the v1 runtime relies on", () => {
    expect(looksLikeFindTicketsLabel("Find Tickets")).toBe(true);
    expect(looksLikeFindTicketsLabel("Find Tickets >")).toBe(true);
    expect(looksLikeFindTicketsLabel("Find Tickets ›")).toBe(true);
    expect(looksLikeFindTicketsLabel("Find Tickets ❯")).toBe(true);
    expect(looksLikeFindTicketsLabel("Buy Tickets")).toBe(true);
    expect(looksLikeFindTicketsLabel("Get Tickets")).toBe(true);
    // Visually-hidden event details inside the button label
    expect(
      looksLikeFindTicketsLabel(
        "Find Tickets The Lion King (New York, NY) 5/30/26, 2:00 PM",
      ),
    ).toBe(true);
  });

  it("Find Tickets label rule rejects the navigation-rail variants", () => {
    // Header rail / breadcrumb labels that contain the phrase but do not start with it
    expect(looksLikeFindTicketsLabel("Event information Find Tickets")).toBe(false);
    // Marketing copy
    expect(looksLikeFindTicketsLabel("See more tickets")).toBe(false);
    // Empty / whitespace
    expect(looksLikeFindTicketsLabel("")).toBe(false);
    expect(looksLikeFindTicketsLabel("   ")).toBe(false);
  });

  it("Ticket-options page check matches /event/<id> URLs only on Ticketmaster hosts", () => {
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      ),
    ).toBe(true);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.ca/show-name/event/00005F123ABC",
      ),
    ).toBe(true);
    // Artist landing page is a ticket-options surface but not the /event/ page
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      ),
    ).toBe(false);
    // External ad tab on a non-Ticketmaster host must not register as a ticket-options page
    expect(
      isTicketmasterTicketOptionsPage(
        "https://example-ad-network.com/promo/event/abc123",
      ),
    ).toBe(false);
  });

  it("Target-date parser carries the activity dogfood May 30 2026 case", () => {
    const target = parseTargetDateTime(
      'Book tickets for "The Lion King - New York" on May 30, 2026 at 2:00 PM.',
    );
    expect(target).toMatchObject({
      monthName: "May",
      monthIndex: 4,
      day: 30,
      year: 2026,
      time: "2:00 PM",
    });
  });

  it("Target-date parser also handles ISO + nearby time form", () => {
    const target = parseTargetDateTime(
      "Target performance date: 2026-05-30. Preferred time: 2:00 PM.",
    );
    expect(target).toMatchObject({
      monthName: "May",
      monthIndex: 4,
      day: 30,
      year: 2026,
      time: "2:00 PM",
    });
  });

  it("Target-date parser does not invent a year for dateless display text", () => {
    // Resident-show calendar text without a year should fall through to the
    // first-available-slot fallback instead of pretending to know the year.
    expect(parseTargetDateTime("Sat, May 30, 2:00 PM")).toBeNull();
  });
});
