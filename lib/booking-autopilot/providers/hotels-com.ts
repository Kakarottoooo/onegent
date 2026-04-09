import type { Page } from "playwright";
import { fillExpediaGroupPaymentForm } from "./expedia";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

interface HotelsComProfile {
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
}

export const hotelsComProvider: BrowserProvider = {
  id: "hotels-com",

  matchesUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("hotels.com") && !lower.includes("expedia.com");
  },

  async setup(): Promise<void> {
    // No-op for Hotels.com
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    const searchResults = lowerUrl.includes("/search");

    // Hotels.com hotel detail pages: /ho<digits> pattern and not checkout
    const hotelDetail =
      /hotels\.com\/ho\d+/.test(lowerUrl) &&
      !lowerUrl.includes("checkout");

    const isCheckout = lowerUrl.includes("/checkout");

    const guestDetailsStep = isCheckout && await page.evaluate(() => {
      const hasNameInput = !!document.querySelector(
        'input[id*="firstName"], input[id*="lastName"], ' +
        'input[name*="firstName"], input[name*="lastName"], ' +
        'input[autocomplete*="given-name"], input[autocomplete*="family-name"]'
      );
      const hasEmailInput = !!document.querySelector('input[type="email"], input[id*="email"], input[name*="email"]');
      return hasNameInput || hasEmailInput;
    }).catch(() => false);

    const paymentStep = isCheckout && await page.evaluate(() => {
      const cardInput = document.querySelector<HTMLInputElement>(
        'input[id*="cardNumber"], input[name*="cardNumber"], input[id*="card-number"], ' +
        'input[autocomplete="cc-number"], input[placeholder*="Card number"], ' +
        'input[placeholder*="card number"]'
      );
      return !!(cardInput && cardInput.offsetParent !== null);
    }).catch(() => false);

    return {
      searchResults,
      hotelDetail,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: paymentStep as boolean,
    };
  },

  async fillPaymentForm(page: Page, profile: unknown, _helpers: unknown, trace: (msg: string) => void): Promise<void> {
    // Hotels.com uses the same Expedia Group checkout infrastructure
    await fillExpediaGroupPaymentForm(page, profile as HotelsComProfile, trace);
  },

  getBotPatterns(): string[] {
    return [
      "show us your human side",
      "bot or not",
      "we can't tell if you're a human",
      "please type the numbers you hear",
    ];
  },
};

// Register with the global provider registry
registerProvider(hotelsComProvider);
