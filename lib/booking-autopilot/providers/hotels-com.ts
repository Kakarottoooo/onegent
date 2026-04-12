import type { Page } from "playwright";
import { fillExpediaGuestForm, fillExpediaGroupPaymentForm } from "./expedia";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

interface HotelsComProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
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

    // Hotels.com hotel detail pages: /ho<digits> or /h<digits> pattern (not checkout)
    const hotelDetail =
      (/hotels\.com\/ho\d+/.test(lowerUrl) || /hotels\.com\/h\d+/.test(lowerUrl)) &&
      !lowerUrl.includes("checkout");

    const isCheckout = lowerUrl.includes("/checkout");

    // Hotels.com redirects to expedia.com/checkout/session/ for the payment step.
    // We must also accept expedia.com/checkout/session when we are in a hotels.com booking flow.
    const isPaymentSessionUrl =
      lowerUrl.includes("/checkout/session") ||
      (lowerUrl.includes("expedia.com") && lowerUrl.includes("/checkout"));

    // Guest details step: on checkout page (hotels.com domain) but NOT on the payment session page,
    // and guest form inputs are visible. Use placeholder-based detection because Hotels.com/Expedia
    // use smart-form-control IDs that don't match generic firstName/lastName patterns.
    const guestDetailsStep = isCheckout && !isPaymentSessionUrl && await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const visible = inputs.filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
      const hasNameInput = visible.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const ac = (el.autocomplete || "").toLowerCase();
        return ph.includes("john") || ph.includes("smith") || ac.includes("given-name") || ac.includes("family-name");
      });
      const hasEmailInput = visible.some(el => el.type === "email");
      return hasNameInput || hasEmailInput;
    }).catch(() => false);

    // Payment step: URL-based (most reliable) OR inline card input visible
    const paymentStep = isPaymentSessionUrl || (isCheckout && await page.evaluate(() => {
      const cardInput = document.querySelector<HTMLInputElement>(
        'input[id*="cardNumber"], input[name*="cardNumber"], input[id*="card-number"], ' +
        'input[autocomplete="cc-number"], input[placeholder*="Card number"], ' +
        'input[placeholder*="card number"]'
      );
      return !!(cardInput && cardInput.offsetParent !== null);
    }).catch(() => false));

    return {
      searchResults,
      hotelDetail,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: paymentStep as boolean,
    };
  },

  async fillGuestForm(page: Page, profile: unknown, _helpers: unknown, trace: (msg: string) => void): Promise<void> {
    // Hotels.com uses the same Expedia Group checkout infrastructure for guest details
    await fillExpediaGuestForm(page, profile as HotelsComProfile, trace);
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
