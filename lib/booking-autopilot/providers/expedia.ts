import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

export const expediaProvider: BrowserProvider = {
  id: "expedia",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("expedia.com");
  },

  async setup(): Promise<void> {
    // No-op for Expedia
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    const searchResults =
      lowerUrl.includes("/hotel-search") ||
      lowerUrl.includes("/hotels");

    const hotelDetail =
      /\/h\/\d+/.test(lowerUrl) ||
      (lowerUrl.includes("/hotel/") && !lowerUrl.includes("/checkout"));

    const isCheckout = lowerUrl.includes("/checkout");

    const guestDetailsStep = isCheckout && await page.evaluate(() => {
      const hasNameInput = !!document.querySelector('input[id*="firstName"], input[id*="lastName"], input[name*="firstName"], input[name*="lastName"], input[autocomplete*="given-name"], input[autocomplete*="family-name"]');
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
registerProvider(expediaProvider);
