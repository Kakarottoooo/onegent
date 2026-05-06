import { describe, expect, it } from "vitest";

import {
  classifyTicketmasterStage,
  type TicketmasterStageSnapshot,
} from "@/lib/booking-autopilot/providers/ticketmaster-rpa";

const blank: Omit<TicketmasterStageSnapshot, "url"> = {
  hasSeatMap: false,
  hasYourTicketsPanel: false,
  hasSubtotal: false,
  hasReserveButton: false,
  reserveEnabled: false,
  hasSeatSelection: false,
  hasSignInHeading: false,
  hasEmailInput: false,
};

describe("classifyTicketmasterStage — pure stage classifier", () => {
  // Bug observed live (job from worktree restart-3004-20260506T003654/worker.log):
  //   `[tm-rpa] Unexpected error: locator.boundingBox is not a function`
  // After the boundingBox fix, the second-largest issue was the executor
  // mapping any non-checkout outcome to status:"error" → UI showed "Failed"
  // even when the user had already arrived at the Ticketmaster account page
  // and was expected to sign in manually. The classifier below is the single
  // source of truth that drives the "needs_user_action" handoff vs failure.

  describe("account boundary (handoff, NOT failure)", () => {
    it("classifies auth.ticketmaster.com URL as account", () => {
      expect(classifyTicketmasterStage({
        url: "https://auth.ticketmaster.com/as/authorization.oauth2?response_type=code&client_id=...",
        ...blank,
      })).toBe("account");
    });

    it("classifies sign-in heading on any TM URL as account", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/checkout/cart",
        ...blank,
        hasSignInHeading: true,
      })).toBe("account");
    });

    it("classifies email input on /checkout as account", () => {
      expect(classifyTicketmasterStage({
        url: "https://checkout.ticketmaster.com/checkout/abc",
        ...blank,
        hasEmailInput: true,
      })).toBe("account");
    });

    it("classifies /identity path as account", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/identity/login",
        ...blank,
      })).toBe("account");
    });

    it("account boundary takes precedence over a stale seat-map signal", () => {
      // TM sometimes layers a sign-in modal over the seat map. Account wins.
      expect(classifyTicketmasterStage({
        url: "https://auth.ticketmaster.com/as/authorization.oauth2",
        ...blank,
        hasSeatMap: true,
        hasYourTicketsPanel: true,
        hasReserveButton: true,
        reserveEnabled: true,
      })).toBe("account");
    });
  });

  describe("ticket_selected (Reserve enabled, ready to click)", () => {
    it("classifies seat-map + reserve enabled + seat selection as ticket_selected", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/event/00005F123ABC",
        ...blank,
        hasSeatMap: true,
        hasYourTicketsPanel: true,
        hasSubtotal: true,
        hasReserveButton: true,
        reserveEnabled: true,
        hasSeatSelection: true,
      })).toBe("ticket_selected");
    });

    it("does NOT classify as ticket_selected when reserve button is disabled", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/event/00005F123ABC",
        ...blank,
        hasSeatMap: true,
        hasReserveButton: true,
        reserveEnabled: false,
        hasSeatSelection: true,
      })).toBe("event_seat_map");
    });

    it("does NOT classify as ticket_selected without a seat selection signal", () => {
      // Even if Reserve is enabled (TM glitch), don't act if no seat picked.
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/event/00005F123ABC",
        ...blank,
        hasSeatMap: true,
        hasReserveButton: true,
        reserveEnabled: true,
        hasSeatSelection: false,
      })).toBe("event_seat_map");
    });
  });

  describe("event_seat_map (waiting for user to select seats)", () => {
    it("classifies /event/ URL as event_seat_map", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/event/00005F123ABC",
        ...blank,
        hasSeatMap: true,
      })).toBe("event_seat_map");
    });

    it("classifies based on Your Tickets panel even without /event/ URL match", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/some-other-path",
        ...blank,
        hasYourTicketsPanel: true,
      })).toBe("event_seat_map");
    });
  });

  describe("checkout (handed off to existing pipeline)", () => {
    it("classifies checkout.ticketmaster.com as checkout", () => {
      expect(classifyTicketmasterStage({
        url: "https://checkout.ticketmaster.com/cart/abc123",
        ...blank,
      })).toBe("checkout");
    });

    it("classifies payments.ticketmaster.com as checkout", () => {
      expect(classifyTicketmasterStage({
        url: "https://payments.ticketmaster.com/pay/abc123",
        ...blank,
      })).toBe("checkout");
    });
  });

  describe("artist_calendar (initial entry)", () => {
    it("classifies /artist/ URL as artist_calendar", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
        ...blank,
      })).toBe("artist_calendar");
    });

    it("classifies *-tickets/ landing path as artist_calendar", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/some-show-new-york-tickets/",
        ...blank,
      })).toBe("artist_calendar");
    });
  });

  describe("unknown fallback", () => {
    it("returns unknown for unrelated TM URLs with no DOM hints", () => {
      expect(classifyTicketmasterStage({
        url: "https://www.ticketmaster.com/",
        ...blank,
      })).toBe("unknown");
    });
  });
});
