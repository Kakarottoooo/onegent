import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

/**
 * Yelp provider — search for a restaurant on Yelp and follow its reservation
 * link (which typically redirects to OpenTable or Resy, handled by those providers).
 */
export const yelpProvider: BrowserProvider = {
  id: "yelp-com",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("yelp.com");
  },

  async setup(): Promise<void> {
    // No-op
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    const searchResults =
      lowerUrl.includes("yelp.com/search") ||
      lowerUrl.includes("yelp.com/biz_photos") === false && lowerUrl.includes("yelp.com/biz/");

    // Yelp biz page (restaurant detail)
    const restaurantDetail = lowerUrl.includes("yelp.com/biz/");

    // Check for reservation button visible on page
    const hasReservationButton = await page.evaluate(() => {
      const pattern = /make a reservation|reserve a table|book a table|reserve now/i;
      const els = Array.from(document.querySelectorAll<HTMLElement>("a, button"));
      return els.some(el => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && pattern.test((el.textContent ?? "").trim());
      });
    }).catch(() => false);

    return {
      searchResults,
      hotelDetail: restaurantDetail,
      guestDetailsStep: hasReservationButton as boolean,
      paymentStep: false,
    };
  },

  async fillGuestForm(
    _page: Page,
    _profile: unknown,
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    // Yelp redirects to OpenTable/Resy — those providers handle the actual form fill
    trace("[yelp] reservation form fill delegated to target platform (OpenTable/Resy)");
  },

  getBotPatterns(): string[] {
    return [];
  },
};

registerProvider(yelpProvider);
