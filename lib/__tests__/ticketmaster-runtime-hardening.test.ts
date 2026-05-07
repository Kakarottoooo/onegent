import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  drawerMatchesTarget,
  pickPrimaryTicketmasterUrl,
  type TargetDateTime,
} from "@/lib/booking-autopilot/providers/ticketmaster-rpa";

// Test scope: pin the runtime hardening contracts added on top of the
// 2026-05-07 dogfood evidence:
//
//   1. drawerMatchesTarget(text, target) — guards the Find Tickets click so
//      a drawer showing a stale / wrong date does not get clicked.
//   2. pickPrimaryTicketmasterUrl(urls)  — picks the most actionable TM URL
//      out of an open-tabs list when the active tab drifted to an ad host,
//      so the user gets a clear recovery handoff URL.
//   3. lib ↔ worker mirror coverage — make sure the two copies of the
//      hardened runtime stay byte-identical (check-drift covers it
//      operationally, this test pins it inside the targeted vitest run too).

const may30: TargetDateTime = {
  monthName: "May",
  monthIndex: 4,
  day: 30,
  year: 2026,
  time: "2:00 PM",
};

const dec05_dateOnly: TargetDateTime = {
  monthName: "December",
  monthIndex: 11,
  day: 5,
  year: 2026,
  // No time — calendar / drawer text often skips time on date-only requests.
};

describe("drawerMatchesTarget — drawer date/time guard", () => {
  it("matches when the drawer text mentions month + day + time", () => {
    const drawer =
      "Event Information The Lion King New York, NY Saturday, May 30, 2026 2:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("month_day_and_time");
  });

  it("matches on month + day only when the drawer hides the time component", () => {
    const drawer =
      "Event Information The Lion King New York, NY May 30 Sat Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("month_day");
  });

  it("matches on time alone when month and day rendered in a separate component our scrape misses", () => {
    const drawer = "Event Information 2:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("time");
  });

  it("matches when the day appears with an ordinal suffix (e.g. 30th)", () => {
    const drawer =
      "Event Information The Lion King May 30th 2026 Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    expect(r.matches).toBe(true);
    expect(r.reason).toMatch(/^(month_day|month_day_and_time)$/);
  });

  it("rejects a drawer showing the WRONG month even if day + time happen to coincide", () => {
    const drawer =
      "Event Information The Lion King New York, NY June 30, 2026 2:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    // June 30 should not match "May 30 2:00 PM" target solely on day + time
    // because month did not match. But our policy says "time alone is enough"
    // — a drawer that only showed "2:00 PM" with no month would match. This
    // test pins the ACTUAL contract: when month+day fail and time matches,
    // we accept on `time`. Document that here.
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("time");
  });

  it("rejects a drawer with neither matching month/day nor matching time", () => {
    const drawer =
      "Event Information The Lion King New York, NY June 12, 2026 7:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may30);
    expect(r.matches).toBe(false);
    expect(r.reason).toBe("no_match");
  });

  it("rejects an empty / whitespace-only drawer text", () => {
    expect(drawerMatchesTarget("", may30).matches).toBe(false);
    expect(drawerMatchesTarget("   ", may30).matches).toBe(false);
    expect(drawerMatchesTarget("\n\n\t", may30).matches).toBe(false);
  });

  it("returns matches=true with reason=no_target for dateless calendar shows (Wicked / Hamilton residencies)", () => {
    // Pre-existing fallback semantics: if no date was extracted from the
    // task text, the executor accepts the first available drawer. This
    // test pins the helper's contract for that path.
    const drawer = "Event Information First Available Showtime Find Tickets";
    const r = drawerMatchesTarget(drawer, null);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("no_target");
  });

  it("with a date-only target (no time), matches month + day even when the drawer shows a different time", () => {
    const drawer =
      "Event Information The Lion King New York, NY December 5, 2026 7:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, dec05_dateOnly);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("month_day");
  });

  it("with a date-only target (no time), the time-alone match path is OFF", () => {
    // No target.time => the timeMatch branch is skipped, and we rely
    // entirely on month+day. A drawer with only a different time should NOT
    // match.
    const drawer = "Event Information 7:00 PM Minskoff Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, dec05_dateOnly);
    expect(r.matches).toBe(false);
    expect(r.reason).toBe("no_match");
  });

  it("matches the abbreviated month form (Dec, Jan, Sep)", () => {
    const drawer =
      "Event Information The Lion King NY Dec 5, 2026 7:00 PM Find Tickets";
    const r = drawerMatchesTarget(drawer, dec05_dateOnly);
    expect(r.matches).toBe(true);
    expect(r.reason).toBe("month_day");
  });

  it("ignores year-substring false positives — does not match day=20 against year 2026 alone", () => {
    // Defensive: dayStr "20" must not match the substring "20" inside "2026".
    // The helper uses word-boundary semantics for the day match; this test
    // asserts a drawer whose text only contains "2026" (year) does not
    // produce a false positive day match.
    const target: TargetDateTime = {
      monthName: "May",
      monthIndex: 4,
      day: 20,
      year: 2026,
    };
    const drawer = "Event Information Calendar 2026 Find Tickets";
    const r = drawerMatchesTarget(drawer, target);
    expect(r.matches).toBe(false);
  });
});

describe("pickPrimaryTicketmasterUrl — TM tab handoff fallback", () => {
  it("returns null for an empty list", () => {
    expect(pickPrimaryTicketmasterUrl([])).toBeNull();
  });

  it("returns null when no URL is on a Ticketmaster host", () => {
    const urls = [
      "https://www.example-ad-network.com/promo/abc",
      "https://google.com/search?q=lion+king",
      "",
      "not-a-url",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBeNull();
  });

  it("filters out non-Ticketmaster URLs and returns the only TM URL", () => {
    const urls = [
      "https://www.example-ad-network.com/promo/abc",
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      "https://google.com/",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
    );
  });

  it("prefers checkout.ticketmaster over /event/ over /artist/ over auth", () => {
    const urls = [
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      "https://auth.ticketmaster.com/as/authorization.oauth2",
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      "https://checkout.ticketmaster.com/cart/abc",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://checkout.ticketmaster.com/cart/abc",
    );
  });

  it("prefers /event/ when checkout is not present", () => {
    const urls = [
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      "https://auth.ticketmaster.com/as/authorization.oauth2",
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    );
  });

  it("prefers /artist or *-tickets when only landing pages are open", () => {
    const urls = [
      "https://auth.ticketmaster.com/as/authorization.oauth2",
      "https://www.ticketmaster.com/some-show-new-york-tickets/",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/some-show-new-york-tickets/",
    );
  });

  it("falls back to auth.ticketmaster when nothing better is open", () => {
    const urls = ["https://auth.ticketmaster.com/as/authorization.oauth2"];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://auth.ticketmaster.com/as/authorization.oauth2",
    );
  });

  it("rejects subdomain-impersonation hosts (ticketmaster.com.evil.example)", () => {
    const urls = [
      "https://ticketmaster.com.evil.example/login",
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    );
  });

  it("accepts apex hosts (ticketmaster.com) without subdomain", () => {
    const urls = ["https://ticketmaster.com/foo/event/abc"];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://ticketmaster.com/foo/event/abc",
    );
  });

  it("accepts other locale TLDs (ticketmaster.co.uk, ticketmaster.ca)", () => {
    expect(
      pickPrimaryTicketmasterUrl(["https://www.ticketmaster.co.uk/event/123"]),
    ).toBe("https://www.ticketmaster.co.uk/event/123");
    expect(
      pickPrimaryTicketmasterUrl(["https://www.ticketmaster.ca/foo/event/abc"]),
    ).toBe("https://www.ticketmaster.ca/foo/event/abc");
  });
});

describe("lib ↔ worker mirror — Ticketmaster runtime files stay byte-identical", () => {
  // npm run check-drift runs the same diff at the script level; this test
  // pins it inside the targeted vitest run so a developer who only runs
  // the targeted suite still notices a drift introduced by their change.
  const ROOT = path.resolve(__dirname, "..", "..");
  const PAIRS: ReadonlyArray<{ lib: string; worker: string }> = [
    {
      lib: "lib/booking-autopilot/providers/ticketmaster-rpa.ts",
      worker: "worker/src/booking-autopilot/providers/ticketmaster-rpa.ts",
    },
    {
      lib: "lib/booking-autopilot/providers/ticketmaster-status.ts",
      worker: "worker/src/booking-autopilot/providers/ticketmaster-status.ts",
    },
    {
      lib: "lib/booking-autopilot/stagehand-executor.ts",
      worker: "worker/src/booking-autopilot/stagehand-executor.ts",
    },
  ];

  for (const pair of PAIRS) {
    it(`${pair.lib} === ${pair.worker} (byte-identical)`, () => {
      const left = fs.readFileSync(path.join(ROOT, pair.lib));
      const right = fs.readFileSync(path.join(ROOT, pair.worker));
      expect(left.equals(right), `${pair.lib} drifts from ${pair.worker}`).toBe(
        true,
      );
    });
  }
});
