import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const providerSource = readFileSync(
  join(process.cwd(), "lib/booking-autopilot/providers/opentable-com.ts"),
  "utf8",
);

describe("OpenTable provider safety policy", () => {
  it("fills the native phone verification gate before trying email fallback", () => {
    expect(providerSource).toContain("phone-only form detected - filling phone directly");
    expect(providerSource).toContain("phone-only direct fill result");
    expect(providerSource).toContain("phone-only form detected without usable phone - clicking 'Use email instead'");
    expect(providerSource).not.toContain("phone-only form detected - clicking 'Use email instead'");
  });

  it("does not auto-click the final Complete reservation button", () => {
    expect(providerSource).toContain("final confirmation button left for user - submit click skipped by policy");
    expect(providerSource).not.toContain("clicked submit button");
  });
});
