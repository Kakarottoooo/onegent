import { describe, expect, it } from "vitest";

import {
  TICKETMASTER_TASK_STATES,
  classifyTicketmasterTaskState,
  isTicketmasterDomainUrl,
  type TicketmasterTaskInput,
  type TicketmasterTaskState,
} from "@/lib/booking-autopilot/providers/ticketmaster-status";

// Test scope: every branch of the pure task-state classifier and the host
// helper. These tests pin the user-visible task-state contract so any future
// refactor that wires the classifier into the live executor cannot silently
// regress the 6 states.
//
// Hard rules guarded here:
//   - No state declares "we signed in for the user".
//   - No state declares "we picked a seat for the user".
//   - external_ad_tab_detected and local_browser_disconnected return error
//     (NOT running / NOT paused_payment) so the task does not look live forever.
//   - checkout_reached returns running so the existing form-fill pipeline
//     still takes over.

const baseInput: TicketmasterTaskInput = {
  reachedCheckout: false,
  needsLogin: false,
  handoffReady: false,
  currentUrl: "",
  localBrowserDisconnected: false,
};

function decide(over: Partial<TicketmasterTaskInput>) {
  return classifyTicketmasterTaskState({ ...baseInput, ...over });
}

describe("isTicketmasterDomainUrl", () => {
  it("accepts the canonical TM hosts the runtime drives", () => {
    expect(isTicketmasterDomainUrl("https://www.ticketmaster.com/")).toBe(true);
    expect(
      isTicketmasterDomainUrl(
        "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      ),
    ).toBe(true);
    expect(
      isTicketmasterDomainUrl(
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      ),
    ).toBe(true);
    expect(
      isTicketmasterDomainUrl("https://checkout.ticketmaster.com/cart/abc"),
    ).toBe(true);
    expect(
      isTicketmasterDomainUrl("https://payments.ticketmaster.com/pay/abc"),
    ).toBe(true);
    expect(
      isTicketmasterDomainUrl(
        "https://auth.ticketmaster.com/as/authorization.oauth2",
      ),
    ).toBe(true);
    expect(isTicketmasterDomainUrl("https://www.ticketmaster.ca/")).toBe(true);
  });

  it("accepts apex hosts without subdomain", () => {
    expect(isTicketmasterDomainUrl("https://ticketmaster.com/foo")).toBe(true);
    expect(isTicketmasterDomainUrl("https://ticketmaster.ca/foo")).toBe(true);
  });

  it("accepts other Ticketmaster locale TLDs", () => {
    expect(
      isTicketmasterDomainUrl("https://www.ticketmaster.co.uk/event/123"),
    ).toBe(true);
    expect(
      isTicketmasterDomainUrl("https://www.ticketmaster.com.au/event/123"),
    ).toBe(true);
  });

  it("rejects empty / nullish / non-URL strings", () => {
    expect(isTicketmasterDomainUrl("")).toBe(false);
    expect(isTicketmasterDomainUrl("   ")).toBe(false);
    expect(isTicketmasterDomainUrl("not-a-url")).toBe(false);
    expect(isTicketmasterDomainUrl("/relative/path")).toBe(false);
  });

  it("rejects external ad / sponsor / promo hosts", () => {
    expect(isTicketmasterDomainUrl("https://example-ad-network.com/")).toBe(
      false,
    );
    expect(isTicketmasterDomainUrl("https://promo.example.com/event/abc")).toBe(
      false,
    );
    expect(
      isTicketmasterDomainUrl(
        "https://googleads.g.doubleclick.net/aclk?sa=L&ai=...",
      ),
    ).toBe(false);
  });

  it("rejects subdomain-impersonation attempts (suffix not on a dot boundary)", () => {
    // ticketmaster.com.evil.example -- attacker domain ending in an unrelated TLD
    expect(
      isTicketmasterDomainUrl("https://ticketmaster.com.evil.example/path"),
    ).toBe(false);
    // notticketmaster.com -- ends with "ticketmaster.com" string but not on a dot
    expect(isTicketmasterDomainUrl("https://notticketmaster.com/path")).toBe(
      false,
    );
    // ticketmasterxcom -- no actual ticketmaster.com TLD boundary
    expect(isTicketmasterDomainUrl("https://ticketmasterxcom/path")).toBe(
      false,
    );
  });
});

describe("classifyTicketmasterTaskState — exported state list", () => {
  it("exports all 6 states in the canonical order", () => {
    expect([...TICKETMASTER_TASK_STATES]).toEqual([
      "checkout_reached",
      "user_seat_selection_required",
      "user_login_required",
      "external_ad_tab_detected",
      "local_browser_disconnected",
      "unknown_failure",
    ]);
  });

  it("the exported list matches the union type by exhaustive switch", () => {
    // Using the union as `s` proves the list is a superset; using
    // TICKETMASTER_TASK_STATES proves it is also a subset.
    const seen: Record<TicketmasterTaskState, true> = {
      checkout_reached: true,
      user_seat_selection_required: true,
      user_login_required: true,
      external_ad_tab_detected: true,
      local_browser_disconnected: true,
      unknown_failure: true,
    };
    for (const s of TICKETMASTER_TASK_STATES) {
      expect(seen[s]).toBe(true);
    }
  });
});

describe("classifyTicketmasterTaskState — checkout_reached (event/date found and form-fill takes over)", () => {
  it("classifies checkout.ticketmaster URL as checkout_reached / running", () => {
    const d = decide({
      reachedCheckout: true,
      currentUrl: "https://checkout.ticketmaster.com/cart/abc123",
    });
    expect(d.state).toBe("checkout_reached");
    expect(d.executorStatus).toBe("running");
    expect(d.holdBrowserOpen).toBe(false);
  });

  it("classifies payments.ticketmaster URL as checkout_reached / running", () => {
    const d = decide({
      reachedCheckout: true,
      currentUrl: "https://payments.ticketmaster.com/pay/abc",
    });
    expect(d.state).toBe("checkout_reached");
    expect(d.executorStatus).toBe("running");
  });

  it("checkout_reached takes precedence over needs_login (RPA may set both transiently)", () => {
    const d = decide({
      reachedCheckout: true,
      needsLogin: true,
      handoffReady: true,
      currentUrl: "https://checkout.ticketmaster.com/cart/abc123",
    });
    expect(d.state).toBe("checkout_reached");
  });

  it("checkout_reached summary never claims login was performed", () => {
    const d = decide({
      reachedCheckout: true,
      currentUrl: "https://checkout.ticketmaster.com/cart/abc123",
    });
    const lower = d.summary.toLowerCase();
    expect(lower).not.toMatch(/signed.*in|logged.*in|enter.*password/);
  });
});

describe("classifyTicketmasterTaskState — user_seat_selection_required (event page reached)", () => {
  it("event page reached + handoff_ready + no login => seat selection required", () => {
    const d = decide({
      handoffReady: true,
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    });
    expect(d.state).toBe("user_seat_selection_required");
    expect(d.executorStatus).toBe("paused_payment");
    expect(d.holdBrowserOpen).toBe(true);
  });

  it("seat selection summary never claims a seat was picked", () => {
    const d = decide({
      handoffReady: true,
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    });
    const lower = d.summary.toLowerCase();
    expect(lower).not.toMatch(/seat selected|chose a seat|picked a seat/);
    expect(lower).toMatch(/seat|review|continue/);
  });

  it("uses the RPA-supplied summary verbatim when given", () => {
    const d = decide({
      handoffReady: true,
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      summary: "Custom seat-pick prompt for Lion King.",
    });
    expect(d.summary).toBe("Custom seat-pick prompt for Lion King.");
  });
});

describe("classifyTicketmasterTaskState — user_login_required (account/session checkpoint)", () => {
  // The login boundary returns `needs_login` (not `paused_payment`) so the
  // upstream mapper at lib/api-v1/run-travel-task-attempt.ts renders
  // `awaiting_login`, the accurate user-facing label, instead of
  // `ready_for_confirmation`. Pinning this here so a future refactor cannot
  // silently re-conflate the two boundaries.
  it("needs_login + auth.ticketmaster URL => user_login_required / needs_login", () => {
    const d = decide({
      needsLogin: true,
      handoffReady: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    });
    expect(d.state).toBe("user_login_required");
    expect(d.executorStatus).toBe("needs_login");
    expect(d.holdBrowserOpen).toBe(true);
  });

  it("login summary explicitly says we will NOT enter account details", () => {
    const d = decide({
      needsLogin: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    });
    expect(d.summary.toLowerCase()).toMatch(
      /won'?t enter|do not enter|will not enter|sign in/,
    );
  });

  it("user_login_required wins over user_seat_selection_required when both signals fire", () => {
    const d = decide({
      needsLogin: true,
      handoffReady: true,
      currentUrl:
        "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code",
    });
    expect(d.state).toBe("user_login_required");
  });
});

describe("classifyTicketmasterTaskState — external_ad_tab_detected", () => {
  it("non-TM host with handoff_ready maps to external_ad_tab_detected / error", () => {
    const d = decide({
      handoffReady: true,
      currentUrl: "https://promo.example.com/landing/abc",
    });
    expect(d.state).toBe("external_ad_tab_detected");
    expect(d.executorStatus).toBe("error");
    // Browser stays open so user can close the ad tab manually.
    expect(d.holdBrowserOpen).toBe(true);
  });

  it("non-TM host with needs_login also maps to external_ad_tab_detected (login signal computed against wrong tab)", () => {
    // Ad tab might have a /login path or sign-in heading; the login signal
    // computed on it is meaningless. The classifier must NOT treat it as a
    // legit user-login boundary.
    const d = decide({
      needsLogin: true,
      handoffReady: true,
      currentUrl: "https://example-ad-network.com/login",
    });
    expect(d.state).toBe("external_ad_tab_detected");
    expect(d.executorStatus).toBe("error");
  });

  it("external ad summary names the ad tab specifically (not generic 'did not reach checkout')", () => {
    const d = decide({
      handoffReady: true,
      currentUrl: "https://promo.example.com/landing/abc",
    });
    const lower = d.summary.toLowerCase();
    expect(lower).toMatch(/ad tab|external/);
    expect(lower).not.toMatch(/^couldn'?t reach ticketmaster checkout/);
  });

  it("subdomain-impersonation domain (ticketmaster.com.evil.example) is detected as external", () => {
    const d = decide({
      handoffReady: true,
      currentUrl: "https://ticketmaster.com.evil.example/login",
    });
    expect(d.state).toBe("external_ad_tab_detected");
  });

  it("empty currentUrl is NOT classified as ad tab (it's either disconnect or unknown_failure)", () => {
    const d = decide({ handoffReady: true, currentUrl: "" });
    expect(d.state).toBe("user_seat_selection_required");
  });
});

describe("classifyTicketmasterTaskState — local_browser_disconnected (stale-job guard)", () => {
  it("localBrowserDisconnected=true => local_browser_disconnected / error", () => {
    const d = decide({
      localBrowserDisconnected: true,
      handoffReady: true,
      currentUrl: "",
    });
    expect(d.state).toBe("local_browser_disconnected");
    expect(d.executorStatus).toBe("error");
    // Do not hold a dead browser session open.
    expect(d.holdBrowserOpen).toBe(false);
  });

  it("disconnect signal beats login + seat + ad-tab signals (cannot trust them without page)", () => {
    const d = decide({
      localBrowserDisconnected: true,
      needsLogin: true,
      handoffReady: true,
      currentUrl: "https://promo.example.com/landing/abc",
    });
    expect(d.state).toBe("local_browser_disconnected");
  });

  it("disconnect maps to error so the task does NOT look live forever", () => {
    const d = decide({ localBrowserDisconnected: true });
    expect(d.executorStatus).toBe("error");
    expect(d.executorStatus).not.toBe("running");
    expect(d.executorStatus).not.toBe("paused_payment");
  });

  it("disconnect summary tells the user the browser dropped, not a generic checkout error", () => {
    const d = decide({ localBrowserDisconnected: true });
    expect(d.summary.toLowerCase()).toMatch(/disconnect|reopen|retry/);
  });
});

describe("classifyTicketmasterTaskState — unknown_failure (last fallback)", () => {
  it("no signals at all => unknown_failure / error (task is not left running)", () => {
    const d = decide({ currentUrl: "" });
    expect(d.state).toBe("unknown_failure");
    expect(d.executorStatus).toBe("error");
  });

  it("TM URL but no handoff_ready / no needs_login / no checkout => unknown_failure / error", () => {
    const d = decide({
      currentUrl:
        "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
    });
    expect(d.state).toBe("unknown_failure");
    expect(d.executorStatus).toBe("error");
  });

  it("unknown_failure prefers RPA-supplied error message when no summary is given", () => {
    const d = decide({
      currentUrl: "",
      errorMessage: "Reserve Tickets click strategies all missed.",
    });
    expect(d.summary).toBe("Reserve Tickets click strategies all missed.");
  });

  it("unknown_failure summary never claims success or asks the user to wait silently", () => {
    const d = decide({ currentUrl: "" });
    const lower = d.summary.toLowerCase();
    expect(lower).not.toMatch(/please wait|loading|in progress/);
    expect(lower).toMatch(/couldn'?t reach|finish manually/);
  });
});

describe("classifyTicketmasterTaskState — never leaves a task looking live forever", () => {
  // Property-style invariant. For every valid combination of signals, the
  // executorStatus must never be "running" UNLESS reachedCheckout was true.
  const matrix = [
    { reachedCheckout: false, needsLogin: false, handoffReady: false },
    { reachedCheckout: false, needsLogin: false, handoffReady: true },
    { reachedCheckout: false, needsLogin: true, handoffReady: false },
    { reachedCheckout: false, needsLogin: true, handoffReady: true },
  ];
  const urlVariants = [
    "",
    "https://www.ticketmaster.com/foo",
    "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    "https://promo.example.com/landing/abc",
    "https://auth.ticketmaster.com/as/authorization.oauth2",
  ];
  const disconnectVariants = [false, true];

  for (const flags of matrix) {
    for (const url of urlVariants) {
      for (const disconnected of disconnectVariants) {
        const label = `flags=${JSON.stringify(flags)} url="${url || "<empty>"}" disconnected=${disconnected}`;
        it(`never returns "running" without checkout — ${label}`, () => {
          const d = classifyTicketmasterTaskState({
            ...baseInput,
            ...flags,
            currentUrl: url,
            localBrowserDisconnected: disconnected,
          });
          // reachedCheckout is false in every matrix row, so running is illegal.
          expect(d.executorStatus).not.toBe("running");
          // The state must be one of the documented user-visible states.
          expect(TICKETMASTER_TASK_STATES).toContain(d.state);
          // Summary must always be a non-empty string.
          expect(typeof d.summary).toBe("string");
          expect(d.summary.length).toBeGreaterThan(0);
        });
      }
    }
  }

  it("checkout_reached + any other signals always returns running and never paused_payment", () => {
    for (const disconnected of disconnectVariants) {
      for (const url of urlVariants) {
        const d = classifyTicketmasterTaskState({
          ...baseInput,
          reachedCheckout: true,
          needsLogin: true,
          handoffReady: true,
          currentUrl: url,
          localBrowserDisconnected: disconnected,
        });
        expect(d.state).toBe("checkout_reached");
        expect(d.executorStatus).toBe("running");
      }
    }
  });
});
