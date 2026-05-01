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
export async function clickResyConfirmationModal(
  page: Page,
  trace: (msg: string) => void
): Promise<{ clicked: boolean; reason: string }> {
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
    return { clicked: false, reason: "click failed" };
  }

  trace("[resy] clickResyConfirmationModal: clicked Reserve Now — waiting for guest-form modal");

  // Poll for the form-fill modal (must contain visible name/email input)
  for (let i = 0; i < 20; i += 1) {
    await new Promise(r => setTimeout(r, 500));
    const formAppeared = await page.evaluate(() => {
      const isShown = (el: HTMLElement): boolean => {
        if (el.hidden || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
      };
      return Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && el.type !== "checkbox" && !el.disabled && isShown(el))
        .some(el => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          return ph.includes("first") || ph.includes("last") || el.type === "email" ||
                 lbl.includes("first") || lbl.includes("last") || lbl.includes("email");
        });
    }).catch(() => false);
    if (formAppeared) {
      trace(`[resy] clickResyConfirmationModal: guest-form modal appeared after ${(i + 1) * 500}ms`);
      return { clicked: true, reason: "form-modal-visible" };
    }
  }

  trace("[resy] clickResyConfirmationModal: clicked but form modal did not appear within 10s");
  return { clicked: true, reason: "form-modal-timeout" };
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
