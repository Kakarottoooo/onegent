import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";
import { fillGuestFormWithAI, auditAndRefillEmptyFields } from "../ai-loop/fill-form";
import { buildEffectiveProfile } from "../core/profile";
import type { BookingProfile } from "../types";
import { shouldStopForDryRun, DRY_RUN_BOUNDARY_MARKER } from "../dry-run";

interface ResyProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

/** Map app city IDs (from lib/cities.ts) to Resy city slugs */
export const RESY_CITY_SLUGS: Record<string, string> = {
  nashville:     "nash",
  new_york:      "nyc",
  "new-york":    "nyc",
  los_angeles:   "la",
  "los-angeles": "la",
  chicago:       "chi",
  san_francisco: "sf",
  "san-francisco": "sf",
  miami:         "miami",
  washington:    "dc",
  dc:            "dc",
  boston:        "bos",
  atlanta:       "atl",
  austin:        "aus",
  seattle:       "sea",
  denver:        "den",
  portland:      "pdx",
  houston:       "hou",
  dallas:        "dal",
  phoenix:       "phx",
  philadelphia:  "phl",
  minneapolis:   "msp",
  charlotte:     "clt",
  detroit:       "det",
  san_diego:     "sd",
  "san-diego":   "sd",
  las_vegas:     "lv",
  "las-vegas":   "lv",
  new_orleans:   "no",
  "new-orleans": "no",
};

/**
 * Convert a city label (from step.body.city or CITIES config) to a Resy slug.
 * Falls back to a best-effort lowercase first-word slug.
 */
export function cityToResySlug(city: string): string {
  const lower = city.toLowerCase().replace(/,.*$/, "").trim(); // strip ", TN" etc.
  const normalized = lower.replace(/\s+/g, "_");
  if (RESY_CITY_SLUGS[normalized]) return RESY_CITY_SLUGS[normalized];
  if (RESY_CITY_SLUGS[lower.replace(/\s+/g, "-")]) return RESY_CITY_SLUGS[lower.replace(/\s+/g, "-")];
  // Fallback: first word, lowercase
  return lower.split(/[\s,]+/)[0] ?? "nyc";
}

/**
 * Click through Resy's "Complete Your Reservation" intermediate modal.
 *
 * After a user clicks a time slot on the venue listing page, Resy opens a
 * modal with cancellation policy + a marketing-consent toggle + a "Reserve
 * Now" button. This modal has NO input fields — it's a confirmation gate
 * BEFORE the actual guest-form modal (which collects first/last/email/phone).
 *
 * RC B (commit 2bf2995) used to mis-classify this modal as `payment_gate`
 * which caused the executor to emit the dry-run boundary marker and exit
 * WITHOUT ever filling the guest form. fully_automated_success was
 * permanently 0% on Resy as a result.
 *
 * Strategy: programmatic click on "Reserve Now". Marketing-consent toggle
 * is intentionally left at default (off) — privacy-preserving, and the
 * Reserve Now button works regardless of toggle state.
 *
 * Returns clicked=true once the next modal containing input fields appears.
 */
/**
 * Outcome of clicking the Resy confirmation modal:
 *   - "guest_form"    → next modal has name/email inputs (existing user, fill normally)
 *   - "mobile_verify" → next modal asks for mobile phone (anonymous user, route to OTP boundary)
 *   - "timeout"       → no follow-up modal appeared in 10s
 *   - "not_clicked"   → confirmation modal not present, click skipped
 */
export type ResyConfirmationNext = "guest_form" | "mobile_verify" | "timeout" | "not_clicked";

export async function clickResyConfirmationModal(
  page: Page,
  trace: (msg: string) => void
): Promise<{ clicked: boolean; reason: string; nextStage: ResyConfirmationNext }> {
  const detection = await page.evaluate(() => {
    const isShown = (el: HTMLElement): boolean => {
      if (el.hidden || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    };
    const text = (document.body?.innerText ?? "").toLowerCase();
    const hasModalText = text.includes("complete your reservation");
    const hasReserveButton = Array.from(document.querySelectorAll<HTMLElement>("button"))
      .some(b => isShown(b) && /^\s*reserve now\s*$/i.test((b.textContent ?? "").trim()));
    const hasNameInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter(el => el.type !== "hidden" && el.type !== "checkbox" && !el.disabled && isShown(el))
      .some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return ph.includes("first") || ph.includes("last") || el.type === "email" ||
               lbl.includes("first") || lbl.includes("last") || lbl.includes("email");
      });
    return { hasModalText, hasReserveButton, hasNameInputs };
  }).catch(() => ({ hasModalText: false, hasReserveButton: false, hasNameInputs: true }));

  if (!detection.hasModalText || detection.hasNameInputs || !detection.hasReserveButton) {
    return {
      clicked: false,
      reason: `not on confirmation modal (modalText=${detection.hasModalText} hasNameInputs=${detection.hasNameInputs} hasReserveButton=${detection.hasReserveButton})`,
      nextStage: "not_clicked",
    };
  }

  const clicked = await page.evaluate(() => {
    const isShown = (el: HTMLElement): boolean => {
      if (el.hidden || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    };
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find(b => isShown(b) && /^\s*reserve now\s*$/i.test((b.textContent ?? "").trim()));
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  }).catch(() => false);

  if (!clicked) {
    trace("[resy] clickResyConfirmationModal: Reserve Now button click failed");
    return { clicked: false, reason: "click failed", nextStage: "not_clicked" };
  }

  trace("[resy] clickResyConfirmationModal: clicked Reserve Now — waiting for next modal");

  // Poll for either the guest-form modal (name/email) OR the mobile-verify
  // modal (phone OTP for anonymous users). Resy routes anonymous users to
  // mobile-verify before exposing the guest form, so both shapes need to
  // be recognised at this gate.
  for (let i = 0; i < 20; i += 1) {
    await new Promise(r => setTimeout(r, 500));
    const probe = await page.evaluate(() => {
      const isShown = (el: HTMLElement): boolean => {
        if (el.hidden || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
      };
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && el.type !== "checkbox" && !el.disabled && isShown(el));
      const hasGuestForm = inputs.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return ph.includes("first") || ph.includes("last") || el.type === "email" ||
               lbl.includes("first") || lbl.includes("last") || lbl.includes("email");
      });
      // Mobile-verify modal: text "mobile phone number to verify" (or close
      // variant) + a phone-shaped input (type=tel OR placeholder contains
      // "mobile" / "phone").
      const text = (document.body?.innerText ?? "").toLowerCase();
      const verifyText =
        text.includes("mobile phone number to verify") ||
        text.includes("mobile phone number") && text.includes("verify or create");
      const hasMobileInput = inputs.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return el.type === "tel" || ph.includes("mobile") || ph.includes("phone") ||
               lbl.includes("mobile") || lbl.includes("phone");
      });
      const hasMobileVerify = verifyText && hasMobileInput;
      return { hasGuestForm, hasMobileVerify };
    }).catch(() => ({ hasGuestForm: false, hasMobileVerify: false }));

    if (probe.hasGuestForm) {
      trace(`[resy] clickResyConfirmationModal: guest-form modal appeared after ${(i + 1) * 500}ms`);
      return { clicked: true, reason: "form-modal-visible", nextStage: "guest_form" };
    }
    if (probe.hasMobileVerify) {
      trace(`[resy] clickResyConfirmationModal: mobile-verify modal appeared after ${(i + 1) * 500}ms`);
      return { clicked: true, reason: "mobile-verify-visible", nextStage: "mobile_verify" };
    }
  }

  trace("[resy] clickResyConfirmationModal: clicked but no follow-up modal in 10s");
  return { clicked: true, reason: "form-modal-timeout", nextStage: "timeout" };
}

/**
 * After Resy's "Complete Your Reservation" → mobile-verify modal, fill the
 * phone number and click Continue. Then poll for the 6-digit OTP screen
 * and emit a verify-gate boundary trace once it appears.
 *
 * Stops at OTP — never enters the code (we don't have a real SMS receiver,
 * and OTP entry is the user's identity-confirmation moment, analogous to
 * OT's "stop at CVV" rule). Returns reachedOtp=true so caller can emit
 * the dry_run boundary marker and exit.
 */
export async function fillResyMobileNumberAndStopAtOtp(
  page: Page,
  profile: { phone?: string },
  trace: (msg: string) => void,
): Promise<{ filled: boolean; reachedOtp: boolean; reason: string }> {
  const phoneRaw = (profile.phone ?? "").trim();
  if (!phoneRaw) {
    trace("[resy] fillResyMobileNumber: profile.phone empty — cannot continue");
    return { filled: false, reachedOtp: false, reason: "no-phone-on-profile" };
  }

  // Strip non-digits, drop leading "1" / "+1" — Resy's mobile input expects
  // 10 digits with the country code provided by the +1 dropdown beside it.
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  const phoneTen = phoneDigits.length === 11 && phoneDigits.startsWith("1")
    ? phoneDigits.slice(1)
    : phoneDigits.slice(-10);

  // Find phone input via DOM, set value via native setter, dispatch input
  // events. Then locate Continue button and click. This is programmatic
  // (no AI) and fast.
  const fillResult = await page.evaluate((digits: string) => {
    const isShown = (el: HTMLElement): boolean => {
      if (el.hidden || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    };
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter(el => el.type !== "hidden" && !el.disabled && isShown(el));
    const phoneInput = inputs.find(el => {
      const ph = (el.placeholder || "").toLowerCase();
      const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
      return el.type === "tel" || ph.includes("mobile") || ph.includes("phone") ||
             lbl.includes("mobile") || lbl.includes("phone");
    });
    if (!phoneInput) return { ok: false, step: "find-input" };

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(phoneInput, digits);
    phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
    phoneInput.dispatchEvent(new Event("change", { bubbles: true }));
    phoneInput.dispatchEvent(new Event("blur", { bubbles: true }));

    const continueBtn = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find(b => isShown(b) && /^\s*continue\s*$/i.test((b.textContent ?? "").trim()));
    if (!continueBtn) return { ok: false, step: "find-button", filled: true };
    continueBtn.scrollIntoView({ block: "center" });
    continueBtn.click();
    return { ok: true, step: "clicked", filled: true };
  }, phoneTen).catch((e: Error) => ({ ok: false, step: `error:${e.message?.slice(0, 60)}`, filled: false }));

  if (!fillResult.ok) {
    trace(`[resy] fillResyMobileNumber: failed at ${fillResult.step}`);
    return { filled: Boolean(fillResult.filled), reachedOtp: false, reason: `step:${fillResult.step}` };
  }

  trace(`[resy] fillResyMobileNumber: phone filled (${phoneTen.length} digits) + Continue clicked — polling for OTP screen`);

  // Poll for OTP screen — Resy renders the verification step as either
  // 6 separate <input> boxes OR text "Check your mobile phone".
  for (let i = 0; i < 16; i += 1) {
    await new Promise(r => setTimeout(r, 500));
    const otpProbe = await page.evaluate(() => {
      const text = (document.body?.innerText ?? "").toLowerCase();
      const otpText =
        text.includes("check your mobile phone") ||
        text.includes("we sent a 6-digit") ||
        text.includes("6-digit confirmation code") ||
        text.includes("verification code");
      const isShown = (el: HTMLElement): boolean => {
        if (el.hidden || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return true;
      };
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && isShown(el));
      // 6+ small single-char input boxes — OTP code entry pattern.
      const sixSmallInputs = inputs.filter(el => {
        const ml = el.maxLength;
        return ml === 1 || el.type === "tel" && (el.size > 0 && el.size <= 2);
      }).length >= 4;
      return { otpText, sixSmallInputs };
    }).catch(() => ({ otpText: false, sixSmallInputs: false }));

    if (otpProbe.otpText || otpProbe.sixSmallInputs) {
      trace(`[resy] fillResyMobileNumber: phone otp gate reached after ${(i + 1) * 500}ms (otpText=${otpProbe.otpText} sixInputs=${otpProbe.sixSmallInputs})`);
      return { filled: true, reachedOtp: true, reason: "otp-screen-detected" };
    }
  }

  trace("[resy] fillResyMobileNumber: filled phone but OTP screen not detected within 8s");
  return { filled: true, reachedOtp: false, reason: "otp-screen-timeout" };
}

export const resyProvider: BrowserProvider = {
  id: "resy-com",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("resy.com");
  },

  async setup(): Promise<void> {
    // No-op
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    // Search results: resy.com/cities/{slug} with query params but NO venue slug
    const searchResults =
      /resy\.com\/cities\/[a-z]+(\?|$)/.test(lowerUrl) &&
      !lowerUrl.includes("/venues/") &&
      !lowerUrl.includes("/restaurant/");

    // Restaurant/venue detail page
    const restaurantDetail =
      lowerUrl.includes("/venues/") ||
      lowerUrl.includes("/restaurant/") ||
      /resy\.com\/cities\/[a-z]+\/[a-z0-9-]+(\?|$)/.test(lowerUrl);

    // Booking form: /book in URL OR reservation form visible (name/email/phone inputs)
    const isBookingUrl = lowerUrl.includes("/book") || lowerUrl.includes("/reservation");
    const hasReservationForm = await page.evaluate(() => {
      const isShown = (el: HTMLElement): boolean => {
        if (el.hidden || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && isShown(el));
      return inputs.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return ph.includes("first") || ph.includes("last") || el.type === "email" ||
               ph.includes("phone") || lbl.includes("first") || lbl.includes("last");
      });
    }).catch(() => false);

    return {
      searchResults,
      hotelDetail: restaurantDetail,
      guestDetailsStep: isBookingUrl || (hasReservationForm as boolean),
      paymentStep: false,
    };
  },

  async fillGuestForm(
    page: Page,
    profile: unknown,
    helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    const p = profile as ResyProfile;
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");
    const h = helpers as { stagehand?: { act: (s: string) => Promise<unknown> }; rawPage?: Page } | null;
    const stagehand = h?.stagehand;
    const rawPage = h?.rawPage ?? page;

    const results = await page.evaluate(
      ({ first, last, email, phone }: { first: string; last: string; email: string; phone: string }) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          return el.value === val;
        };

        const isShown = (el: HTMLElement): boolean => {
          if (el.hidden || !el.isConnected) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && isShown(el));
        const res: Record<string, boolean | string> = {};

        const firstEl = inputs.find(el => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          return ph.includes("first") || lbl.includes("first name") || (el.id || "").toLowerCase().includes("first");
        });
        res.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

        const lastEl = inputs.find(el => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          return ph.includes("last") || lbl.includes("last name") || (el.id || "").toLowerCase().includes("last");
        });
        res.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

        const emailEl = inputs.find(el => el.type === "email" || (el.placeholder || "").toLowerCase().includes("email"));
        res.email = emailEl ? nativeFill(emailEl, email) : "not_found";

        const phoneEl = inputs.find(el =>
          (el.type === "tel" || (el.placeholder || "").toLowerCase().includes("phone")) &&
          !(el.id || "").toLowerCase().includes("country")
        );
        res.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

        return res;
      },
      { first: p.first_name ?? "", last: p.last_name ?? "", email: p.email ?? "", phone: phoneDigits }
    ).catch((err: Error) => {
      trace(`[resy] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[resy] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone}`);

    // ── AI fill for missed fields + audit ──────────────────────────────────────
    if (stagehand) {
      const missed = [results.firstName, results.lastName, results.email, results.phone].filter(v => v === "not_found" || v === false);
      if (missed.length > 0) {
        trace(`[resy] ${missed.length} field(s) missed — running AI fill`);
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        try {
          const aiResult = await fillGuestFormWithAI(stagehand, effectiveProfile, trace);
          trace(`[resy] AI fill: filled=${aiResult.filled.join(",")} failed=${aiResult.failed.join(",")}`);
        } catch (e) { trace(`[resy] AI fill error: ${(e as Error).message?.slice(0, 80)}`); }
      }
      try {
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        const audit = await auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace);
        if (audit.refilled.length) trace(`[resy] audit refilled: ${audit.refilled.join(",")}`);
      } catch (e) { trace(`[resy] audit error: ${(e as Error).message?.slice(0, 80)}`); }
    }

    // Submit the reservation form
    await new Promise(r => setTimeout(r, 800));

    // Benchmark dry_run boundary: if the caller flagged this run as dry_run,
    // stop before the reservation-committing click.
    if (shouldStopForDryRun(helpers)) {
      trace(`[resy] ${DRY_RUN_BOUNDARY_MARKER} - submit click skipped (benchmark_dry_run=true)`);
      return;
    }

    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /complete reservation|confirm|reserve|book now|find a table/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"], button'))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) { btn.click(); return (btn.textContent ?? "").trim().slice(0, 40); }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[resy] clicked submit: "${submitted}"`);
    } else {
      trace("[resy] submit button not found");
    }
  },

  getBotPatterns(): string[] {
    return [];
  },
};

registerProvider(resyProvider);
