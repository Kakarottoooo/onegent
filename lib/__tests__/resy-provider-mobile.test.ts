import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fillResyMobileNumberAndStopAtOtp } from "@/lib/booking-autopilot/providers/resy-com";

type LocatorLike = {
  first: () => LocatorLike;
  isVisible: ReturnType<typeof vi.fn>;
  scrollIntoViewIfNeeded: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  inputValue: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
};

function makeLocator(options: {
  visible?: boolean;
  value?: string;
  fillRejects?: boolean;
} = {}): LocatorLike {
  let currentValue = options.value ?? "";
  const locator: LocatorLike = {
    first: () => locator,
    isVisible: vi.fn(async () => options.visible ?? true),
    scrollIntoViewIfNeeded: vi.fn(async () => undefined),
    fill: vi.fn(async (value: string) => {
      if (options.fillRejects) throw new Error("fill failed");
      currentValue = value;
    }),
    inputValue: vi.fn(async () => currentValue),
    click: vi.fn(async () => undefined),
  };
  return locator;
}

function makeResyPhonePage(options: {
  phoneVisible?: boolean;
  domFillResult?: unknown;
  otpProbe?: unknown;
} = {}) {
  const phoneLocator = makeLocator({ visible: options.phoneVisible ?? true });
  const continueLocator = makeLocator({ visible: true });
  const evaluate = vi.fn(async () => {
    if (options.domFillResult !== undefined && evaluate.mock.calls.length === 1) {
      return options.domFillResult;
    }
    return options.otpProbe ?? { otpText: true, sixSmallInputs: false };
  });
  const locator = vi.fn((selector: string) => {
    if (selector.includes("Continue")) return continueLocator;
    return phoneLocator;
  });

  return {
    page: { locator, evaluate } as unknown as Page,
    locator,
    phoneLocator,
    continueLocator,
    evaluate,
  };
}

describe("fillResyMobileNumberAndStopAtOtp", () => {
  it("uses the locator strategy first and stops at the OTP gate", async () => {
    const traceLines: string[] = [];
    const trace = (line: string) => traceLines.push(line);
    const { page, phoneLocator, continueLocator, evaluate } = makeResyPhonePage();

    const result = await fillResyMobileNumberAndStopAtOtp(
      page,
      { phone: "+1 (555) 123-4567" },
      trace,
    );

    expect(result).toEqual({
      filled: true,
      reachedOtp: true,
      reason: "otp-screen-detected",
    });
    expect(phoneLocator.fill).toHaveBeenCalledWith("5551234567", { timeout: 3000 });
    expect(continueLocator.click).toHaveBeenCalledWith({ timeout: 3000 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-01-locator] Continue clicked");
    expect(traceLines.join("\n")).toContain("phone otp gate reached");
  });

  it("falls back to DOM direct when the locator strategy cannot see the input", async () => {
    const traceLines: string[] = [];
    const trace = (line: string) => traceLines.push(line);
    const { page, evaluate } = makeResyPhonePage({
      phoneVisible: false,
      domFillResult: { ok: true, step: "clicked", filled: true },
      otpProbe: { otpText: false, sixSmallInputs: true },
    });

    const result = await fillResyMobileNumberAndStopAtOtp(
      page,
      { phone: "555.123.4567" },
      trace,
    );

    expect(result.reachedOtp).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(traceLines.join("\n")).toContain("falling back to DOM direct");
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-02-dom-direct] ok=true");
  });

  it("returns a clear no-phone reason without touching the page", async () => {
    const traceLines: string[] = [];
    const trace = (line: string) => traceLines.push(line);
    const { page, locator, evaluate } = makeResyPhonePage();

    const result = await fillResyMobileNumberAndStopAtOtp(page, {}, trace);

    expect(result).toEqual({
      filled: false,
      reachedOtp: false,
      reason: "no-phone-on-profile",
    });
    expect(locator).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("reports the exact failed DOM step when every strategy fails", async () => {
    const traceLines: string[] = [];
    const trace = (line: string) => traceLines.push(line);
    const { page } = makeResyPhonePage({
      phoneVisible: false,
      domFillResult: { ok: false, step: "find-input", filled: false },
    });

    const result = await fillResyMobileNumberAndStopAtOtp(
      page,
      { phone: "5551234567" },
      trace,
    );

    expect(result).toEqual({
      filled: false,
      reachedOtp: false,
      reason: "step:find-input",
    });
    expect(traceLines.join("\n")).toContain("[resy] fillResyMobileNumber: failed at find-input");
  });
});
