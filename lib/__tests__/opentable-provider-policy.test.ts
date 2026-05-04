import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const providerSource = readFileSync(
  join(process.cwd(), "lib/booking-autopilot/providers/opentable-com.ts"),
  "utf8",
);
const executorSource = readFileSync(
  join(process.cwd(), "lib/booking-autopilot/stagehand-executor.ts"),
  "utf8",
);

describe("OpenTable provider safety policy", () => {
  it("fills the native phone verification gate before trying email fallback", () => {
    expect(providerSource).toContain("phone-only form detected - filling phone directly");
    expect(providerSource).toContain("phone-only direct fill result");
    expect(providerSource).toContain("using raw Playwright page for guest-form DOM operations");
    expect(providerSource).toContain("onegent-opentable-debug-cursor");
    expect(providerSource).toContain("locator fill ${field}");
    expect(providerSource).toContain("OpenTableCompatLocator");
    expect(providerSource).toContain("typeof candidate.isEnabled === \"function\"");
    expect(providerSource).toContain("locator lacks full fill API");
    expect(providerSource).toContain("[opentable][strategy ${strategy}]");
    expect(providerSource).toContain("ot-phone-01-exact-locator");
    expect(providerSource).toContain("ot-phone-02-dom-direct");
    expect(providerSource).toContain("ot-phone-03-discovered-coordinate");
    expect(providerSource).toContain("ot-phone-04-fixed-coordinate-high");
    expect(providerSource).toContain("ot-phone-05-fixed-coordinate-mid");
    expect(providerSource).toContain("ot-phone-06-fixed-coordinate-low");
    expect(providerSource).toContain("fixed-phone-gate-high");
    expect(providerSource).toContain("accepted unverified phone because this is the calibrated OpenTable phone-gate coordinate fallback");
    expect(providerSource).toContain("refusing ready handoff");
    expect(providerSource).toContain(".debug-screenshots");
    expect(providerSource).toContain("saved guest-form artifact");
    expect(providerSource).toContain("diner form state unreadable after phone gate fill");
    expect(providerSource).toContain("coordinate typing");
    expect(providerSource).toContain("phone-only form detected without usable phone - clicking 'Use email instead'");
    expect(providerSource).not.toContain("phone-only form detected - clicking 'Use email instead'");
    expect(providerSource).not.toContain("getByPlaceholder");
    expect(providerSource).not.toContain("getByLabel");
    expect(providerSource).not.toContain('verified || field === "phone"');
    expect(providerSource).not.toContain('empty: ["email"]');
  });

  it("does not auto-click the final Complete reservation button", () => {
    expect(providerSource).toContain("final confirmation button left for user - submit click skipped by policy");
    expect(providerSource).not.toContain("clicked submit button");
  });

  it("does not convert OpenTable guest-form errors into ready handoffs", () => {
    expect(executorSource).toContain("isOpenTableGuestFormError");
    expect(executorSource).toContain("OpenTable guest-form error occurred after reaching the form");
    expect(executorSource).toContain("reachedGuestForm && !guestFormIncomplete && !isOpenTableGuestFormError");
  });

  it("opts the user out of SMS marketing checkboxes by default", () => {
    // Founder directive 2026-05-03: never auto-consent users to SMS
    // marketing because the booking phone is the user's real number;
    // restaurant text spam = harassment. Email marketing is left alone
    // (different harm profile; not in scope this round).
    expect(providerSource).toContain("SMS_PATTERNS");
    expect(providerSource).toContain("/text updates?/i");
    expect(providerSource).toContain("/reminders.*reservations?/i");
    expect(providerSource).toContain("founder anti-spam policy");
    expect(providerSource).toContain("unchecked ${smsUncheckedCount} SMS marketing checkbox(es)");
    // Use cb.click() to fire React onChange, NOT direct .checked = false:
    expect(providerSource).toContain("cb.click()");
    expect(providerSource).not.toContain("cb.checked = false");
    // Don't blanket-uncheck every checkbox — only those matching SMS_PATTERNS:
    expect(providerSource).toContain("SMS_PATTERNS.some(re => re.test(labelText))");
  });

  it("captures the founder live-verified success rationale in code comments", () => {
    // The fillGuestForm doc-block records WHY the 6-layer ladder works
    // and prevents future "small refactor accidentally drops a layer"
    // regressions. If you remove these phrases you almost certainly
    // also broke something the comment was protecting.
    expect(providerSource).toContain("founder live-verified 2026-05-03");
    expect(providerSource).toContain("Sirrah / Thu May 14 8:00 PM / 1 person");
    expect(providerSource).toContain("structurally durable shape");
    expect(providerSource).toContain("CANNOT silently regress");
  });
});
