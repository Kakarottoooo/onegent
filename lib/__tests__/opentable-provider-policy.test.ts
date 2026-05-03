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
    expect(providerSource).toContain("ot-phone-04-fixed-coordinate");
    expect(providerSource).toContain(".debug-screenshots");
    expect(providerSource).toContain("saved guest-form artifact");
    expect(providerSource).toContain("diner form state unreadable after phone gate fill");
    expect(providerSource).toContain("coordinate typing");
    expect(providerSource).toContain("phone-only form detected without usable phone - clicking 'Use email instead'");
    expect(providerSource).not.toContain("phone-only form detected - clicking 'Use email instead'");
    expect(providerSource).not.toContain("getByPlaceholder");
    expect(providerSource).not.toContain("getByLabel");
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
});
