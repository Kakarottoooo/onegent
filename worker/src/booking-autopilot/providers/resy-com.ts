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
  // Locator API traverses frames + shadow DOM automatically — single
  // `document.body.innerText` evaluate misses Resy's modal because the
  // modal is rendered inside an iframe or React Portal target outside
  // <body>. Stage assessment's `readCombinedText` succeeds because it
  // walks `getInteractionScopes` (frames + main); our hook needs the
  // same coverage. Run 11 case 005 (Cosme) hit this — modalText=false
  // even though the modal was visibly open.
  //
  // Run 13 case 018 (Cosme) hit a follow-up: the strict `^...$` anchored
  // regex required the entire matched text node to be exactly "Complete
  // Your Reservation", but Resy variants wrap the heading in a div with
  // additional surrounding whitespace / sibling spans. Use substring
  // match (`text=...`) — Playwright treats this as case-insensitive
  // substring containment by default in newer versions, so it tolerates
  // surrounding text without false-matching unrelated copy.
  const modalHeading = page.locator(
    "text=/complete your reservation/i"
  ).first();
  const reserveBtn = page.locator(
    'button:has-text("Reserve Now"), [role="button"]:has-text("Reserve Now")'
  ).first();
  const guestFormInput = page.locator(
    'input[placeholder*="First" i], input[placeholder*="Last" i], input[type="email"], input[aria-label*="First" i], input[aria-label*="Last" i], input[aria-label*="Email" i]'
  ).first();

  const hasModalHeading = await modalHeading.isVisible({ timeout: 1500 }).catch(() => false);
  const hasReserveButton = await reserveBtn.isVisible({ timeout: 500 }).catch(() => false);
  const hasNameInputs = await guestFormInput.isVisible({ timeout: 250 }).catch(() => false);

  if (!hasModalHeading || hasNameInputs || !hasReserveButton) {
    return {
      clicked: false,
      reason: `not on confirmation modal (modalHeading=${hasModalHeading} hasNameInputs=${hasNameInputs} hasReserveButton=${hasReserveButton})`,
      nextStage: "not_clicked",
    };
  }

  const clickOk = await reserveBtn
    .scrollIntoViewIfNeeded({ timeout: 1500 })
    .then(() => reserveBtn.click({ timeout: 3000 }))
    .then(() => true)
    .catch((e: Error) => {
      trace(`[resy] clickResyConfirmationModal: Reserve Now click failed (${e.message?.slice(0, 60)})`);
      return false;
    });

  if (!clickOk) {
    return { clicked: false, reason: "click failed", nextStage: "not_clicked" };
  }

  trace("[resy] clickResyConfirmationModal: clicked Reserve Now — waiting for next modal");

  // Poll for either the guest-form modal (name/email) OR the mobile-verify
  // modal (phone OTP for anonymous users). Locator API traverses frames /
  // shadow DOM, so a single waitFor probe across both candidates is reliable.
  const guestFormProbe = page.locator(
    'input[placeholder*="First" i], input[placeholder*="Last" i], input[type="email"], input[aria-label*="First" i], input[aria-label*="Last" i], input[aria-label*="Email" i]'
  ).first();
  const mobileVerifyHeading = page.locator(
    "text=/mobile phone number to verify/i"
  ).first();

  for (let i = 0; i < 20; i += 1) {
    await new Promise(r => setTimeout(r, 500));
    const guestVisible = await guestFormProbe.isVisible({ timeout: 200 }).catch(() => false);
    const mobileVisible = await mobileVerifyHeading.isVisible({ timeout: 200 }).catch(() => false);
    if (guestVisible) {
      trace(`[resy] clickResyConfirmationModal: guest-form modal appeared after ${(i + 1) * 500}ms`);
      return { clicked: true, reason: "form-modal-visible", nextStage: "guest_form" };
    }
    if (mobileVisible) {
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

  type ResyPhoneFillResult = { ok: boolean; step: string; filled?: boolean };

  const fillWithLocator = async (): Promise<ResyPhoneFillResult> => {
    const phoneInput = page.locator(
      [
        'input[type="tel"]',
        'input[autocomplete="tel"]',
        'input[placeholder*="phone" i]',
        'input[placeholder*="mobile" i]',
        'input[aria-label*="phone" i]',
        'input[aria-label*="mobile" i]',
      ].join(", "),
    ).first();
    const visible = await phoneInput.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible) {
      trace("[resy][strategy rs-phone-01-locator] phone input not visible");
      return { ok: false, step: "locator-input-not-visible", filled: false };
    }

    await phoneInput.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
    await phoneInput.fill(phoneTen, { timeout: 3000 }).catch((e: Error) => {
      trace(`[resy][strategy rs-phone-01-locator] fill failed (${e.message?.slice(0, 80)})`);
      throw e;
    });

    const valueDigits = (await phoneInput.inputValue({ timeout: 1000 }).catch(() => "")).replace(/\D/g, "");
    const verified = valueDigits.endsWith(phoneTen);
    trace(`[resy][strategy rs-phone-01-locator] typed phone verified=${verified} valueDigits=${valueDigits.length}`);
    if (!verified) {
      return { ok: false, step: "locator-input-unverified", filled: valueDigits.length > 0 };
    }

    const continueBtn = page.locator(
      'button:has-text("Continue"), [role="button"]:has-text("Continue")',
    ).first();
    const buttonVisible = await continueBtn.isVisible({ timeout: 1500 }).catch(() => false);
    if (!buttonVisible) {
      trace("[resy][strategy rs-phone-01-locator] Continue button not visible after verified phone fill");
      return { ok: false, step: "locator-button-not-visible", filled: true };
    }
    await continueBtn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
    await continueBtn.click({ timeout: 3000 });
    trace("[resy][strategy rs-phone-01-locator] Continue clicked");
    return { ok: true, step: "locator-clicked", filled: true };
  };

  const fillWithDom = async (): Promise<ResyPhoneFillResult> => page.evaluate((digits: string) => {
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

  let fillResult = await fillWithLocator().catch((e: Error) => ({
    ok: false,
    step: `locator-error:${e.message?.slice(0, 60)}`,
    filled: false,
  }));
  if (!fillResult.ok) {
    trace(`[resy][strategy rs-phone-01-locator] failed at ${fillResult.step}; falling back to DOM direct`);
    fillResult = await fillWithDom();
    trace(`[resy][strategy rs-phone-02-dom-direct] ok=${fillResult.ok} step=${fillResult.step} filled=${Boolean(fillResult.filled)}`);
  }

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
