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
  mouseTarget?: { x: number; y: number } | null;
  evaluateSequence?: unknown[];
} = {}) {
  const phoneLocator = makeLocator({ visible: options.phoneVisible ?? true });
  const continueLocator = makeLocator({ visible: true });
  const evaluateSequence = [...(options.evaluateSequence ?? [])];
  const evaluate = vi.fn(async (_fn?: unknown, arg?: unknown) => {
    if (evaluateSequence.length > 0) {
      return evaluateSequence.shift();
    }
    if (typeof arg === "string" && options.domFillResult !== undefined) {
      return options.domFillResult;
    }
    if (Object.prototype.hasOwnProperty.call(options, "mouseTarget")) {
      return options.mouseTarget;
    }
    return options.otpProbe ?? { otpText: true, sixSmallInputs: false };
  });
  const locator = vi.fn((selector: string) => {
    if (selector.includes("Continue")) return continueLocator;
    return phoneLocator;
  });

  return {
    page: {
      locator,
      evaluate,
      mouse: { click: vi.fn(async () => undefined) },
      keyboard: {
        press: vi.fn(async () => undefined),
        type: vi.fn(async () => undefined),
      },
    } as unknown as Page,
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
    expect(phoneLocator.fill).toHaveBeenCalledWith("5551234567", { timeout: 2500 });
    expect(continueLocator.click).toHaveBeenCalledWith({ timeout: 2500 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-01-locator-main] ok=true step=clicked");
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
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-01-locator-main] ok=false");
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-03-dom-main] ok=true");
  });

  it("falls back to mouse and keyboard typing when locator and DOM direct fail", async () => {
    const traceLines: string[] = [];
    const trace = (line: string) => traceLines.push(line);
    const { page } = makeResyPhonePage({
      phoneVisible: false,
      evaluateSequence: [
        { ok: false, step: "find-input", filled: false },
        { x: 120, y: 40 },
        true,
        true,
        { otpText: true, sixSmallInputs: false },
      ],
    });

    const result = await fillResyMobileNumberAndStopAtOtp(
      page,
      { phone: "5551234567" },
      trace,
    );

    expect(result).toEqual({
      filled: true,
      reachedOtp: true,
      reason: "otp-screen-detected",
    });
    expect(traceLines.join("\n")).toContain("[resy][strategy rs-phone-05-mouse-keyboard] ok=true");
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
      mouseTarget: null,
    });

    const result = await fillResyMobileNumberAndStopAtOtp(
      page,
      { phone: "5551234567" },
      trace,
    );

    expect(result).toEqual({
      filled: false,
      reachedOtp: false,
      reason: "step:rs-phone-05-mouse-keyboard:target-not-found",
    });
    expect(traceLines.join("\n")).toContain("all strategies failed at rs-phone-05-mouse-keyboard:target-not-found");
  });
});
