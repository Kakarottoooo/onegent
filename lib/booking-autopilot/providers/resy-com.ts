import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

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
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
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
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    const p = profile as ResyProfile;
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");

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

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && el.offsetParent !== null);
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

    // Submit the reservation form
    await new Promise(r => setTimeout(r, 800));
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
