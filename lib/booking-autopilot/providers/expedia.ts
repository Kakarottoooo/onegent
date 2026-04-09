import type { Frame, Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

// Selectors for Expedia Group payment fields (used by both Expedia and Hotels.com)
// Expedia inline payment form (not iframe) — placeholder-based selectors are most reliable.
// Confirmed field placeholders from live Expedia checkout page:
//   Card number:    "0000 0000 0000 0000"
//   Expiry:         "MM/YY"
//   Name on card:   "Name on card"
export const EXPEDIA_GROUP_CARD_NAME_SELECTORS = [
  'input[placeholder="Name on card"]',
  'input[id*="cardHolder"], input[id*="cardholder"], input[id*="card-holder"]',
  'input[name*="cardHolder"], input[name*="cardholder"]',
  'input[autocomplete="cc-name"]',
  'input[placeholder*="Name on card"], input[placeholder*="Cardholder"]',
];

export const EXPEDIA_GROUP_CARD_NUMBER_SELECTORS = [
  'input[placeholder="0000 0000 0000 0000"]',
  'input[id*="cardNumber"], input[id*="card-number"]',
  'input[name*="cardNumber"], input[name*="card-number"]',
  'input[autocomplete="cc-number"]',
  'input[placeholder*="Card number"], input[placeholder*="card number"]',
];

export const EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS = [
  'input[placeholder="MM/YY"]',
  'input[id*="expiryDate"], input[id*="expiry"], input[id*="expiration"]',
  'input[name*="expiryDate"], input[name*="expiry"], input[name*="expiration"]',
  'input[autocomplete="cc-exp"]',
  'input[placeholder*="MM/YY"], input[placeholder*="Expiry"], input[placeholder*="Expiration"]',
];

interface ExpediaGroupProfile {
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
  billing_zip?: string;
  zip?: string; // fallback alias from BookingProfile
}

// Billing ZIP code selectors for Expedia checkout
const EXPEDIA_BILLING_ZIP_SELECTORS = [
  'input[id*="billingZip"], input[id*="billing-zip"], input[id*="BillingZip"]',
  'input[name*="billingZip"], input[name*="billing-zip"]',
  'input[autocomplete="postal-code"]',
  'input[placeholder*="ZIP code"], input[placeholder*="Zip code"], input[placeholder*="Postal code"]',
  'input[aria-label*="Billing ZIP"], input[aria-label*="ZIP code"]',
];

async function findVisibleInScope(scope: Page | Frame, selectors: string[]): Promise<{ scope: Page | Frame; selector: string } | null> {
  for (const selector of selectors) {
    const visible = await scope.evaluate((sel) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      return !!(el && el.offsetParent !== null && !el.disabled);
    }, selector).catch(() => false);
    if (visible) return { scope, selector };
  }
  return null;
}

async function fillExpediaGroupPaymentField(
  page: Page,
  selectorList: string[],
  value: string,
  label: string,
  trace: (msg: string) => void
): Promise<boolean> {
  if (!value) return false;

  // First check inline (main page)
  const inlineMatch = await findVisibleInScope(page, selectorList);
  if (inlineMatch) {
    try {
      await page.fill(inlineMatch.selector, value);
      const filled = await page.evaluate((sel) => {
        const el = document.querySelector<HTMLInputElement>(sel);
        return el ? el.value : "";
      }, inlineMatch.selector).catch(() => "");
      trace(`Expedia payment: filled ${label} inline (value present: ${filled.length > 0})`);
      return true;
    } catch (err) {
      trace(`Expedia payment: inline fill failed for ${label}: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  // Try iframes
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    // Stagehand v3 may expose url as a string property rather than a method
    const rawUrl: unknown = frame.url;
    const frameUrl = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
    if (!frameUrl.includes("expedia") && !frameUrl.includes("hotels") && !frameUrl.includes("payment") && !frameUrl.includes("checkout")) continue;
    const frameMatch = await findVisibleInScope(frame, selectorList);
    if (frameMatch) {
      try {
        await frame.fill(frameMatch.selector, value);
        const filled = await frame.evaluate((sel) => {
          const el = document.querySelector<HTMLInputElement>(sel);
          return el ? el.value : "";
        }, frameMatch.selector).catch(() => "");
        trace(`Expedia payment: filled ${label} in iframe (${frameUrl.slice(0, 60)}) (value present: ${filled.length > 0})`);
        return true;
      } catch (err) {
        trace(`Expedia payment: iframe fill failed for ${label}: ${(err as Error).message?.slice(0, 80)}`);
      }
    }
  }

  trace(`Expedia payment: could not find visible ${label} field (inline or iframe)`);
  return false;
}

interface ExpediaGuestProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

/**
 * Fill Expedia / Hotels.com guest fields using Playwright native fill().
 * Avoids stagehand.act() entirely so browser autocomplete cannot mis-fill fields.
 * After each fill, presses Escape + Tab to dismiss any autocomplete dropdown.
 */
export async function fillExpediaGuestForm(
  page: Page,
  profile: ExpediaGuestProfile,
  trace: (msg: string) => void,
): Promise<void> {
  const FIELD_SELECTORS: Array<{ key: keyof ExpediaGuestProfile; selectors: string[]; label: string }> = [
    {
      key: "first_name",
      label: "first name",
      selectors: [
        'input[autocomplete="given-name"]',
        'input[id*="firstName"], input[id*="first-name"], input[id*="firstname"]',
        'input[name*="firstName"], input[name*="first-name"]',
        'input[placeholder*="First name"]',
      ],
    },
    {
      key: "last_name",
      label: "last name",
      selectors: [
        'input[autocomplete="family-name"]',
        'input[id*="lastName"], input[id*="last-name"], input[id*="lastname"]',
        'input[name*="lastName"], input[name*="last-name"]',
        'input[placeholder*="Last name"]',
      ],
    },
    {
      key: "email",
      label: "email",
      selectors: [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[id*="email"], input[name*="email"]',
        'input[placeholder*="Email"]',
      ],
    },
    {
      key: "phone",
      label: "phone number",
      selectors: [
        'input[type="tel"]',
        'input[autocomplete="tel"]',
        'input[id*="phone"], input[name*="phone"]',
        'input[placeholder*="Phone"]',
      ],
    },
  ];

  for (const field of FIELD_SELECTORS) {
    const value = profile[field.key];
    if (!value) continue;

    let filled = false;
    for (const sel of field.selectors) {
      // Check if selector matches a visible input
      const exists = await page.evaluate((s) => {
        const el = document.querySelector<HTMLInputElement>(s);
        return !!(el && el.offsetParent !== null && !el.disabled);
      }, sel).catch(() => false);

      if (!exists) continue;

      try {
        // Triple-click to select any existing content, then fill
        await page.click(sel, { clickCount: 3 }).catch(() => {});
        await page.fill(sel, value);
        // Press Escape then Tab to dismiss any autocomplete dropdown
        await page.keyboard.press("Escape").catch(() => {});
        await page.keyboard.press("Tab").catch(() => {});

        // Verify the value was actually set
        const actual = await page.evaluate((s) => {
          return (document.querySelector<HTMLInputElement>(s))?.value ?? "";
        }, sel).catch(() => "");

        if (actual === value) {
          trace(`Expedia guest: filled ${field.label} = "${field.key === "email" ? value : "[ok]"}" via selector "${sel}"`);
          filled = true;
          break;
        }
        trace(`Expedia guest: fill ${field.label} mismatch — expected "${value.slice(0, 20)}" got "${actual.slice(0, 20)}"`);
      } catch (err) {
        trace(`Expedia guest: fill ${field.label} failed (${sel}): ${(err as Error).message?.slice(0, 60)}`);
      }
    }

    if (!filled) {
      trace(`Expedia guest: could not find visible field for ${field.label}`);
    }
  }
}

export async function fillExpediaGroupPaymentForm(
  page: Page,
  profile: ExpediaGroupProfile,
  trace: (msg: string) => void
): Promise<void> {
  // Detect inline vs iframe payment
  const inlineCardCount = await page.evaluate(() => {
    const selectors = [
      'input[placeholder="0000 0000 0000 0000"]',
      'input[id*="cardNumber"], input[name*="cardNumber"], input[id*="card-number"]',
      'input[autocomplete="cc-number"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el && el.offsetParent !== null) return 1;
    }
    return 0;
  }).catch(() => 0);

  const iframeCount = page.frames().filter(f => {
    if (f === page.mainFrame()) return false;
    const rawUrl: unknown = f.url;
    const url = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
    return url.includes("payment") || url.includes("checkout") || url.includes("expedia") || url.includes("hotels");
  }).length;

  trace(`Expedia payment: detected ${inlineCardCount} inline card input(s), ${iframeCount} payment-related iframe(s)`);

  // Handle Expedia "Protect your stay" required section — select "No protection".
  // This section is required before "Book now" becomes active.
  const protectionSelected = await page.evaluate(() => {
    // Look for the "No protection" radio/button option
    const labels = Array.from(document.querySelectorAll<HTMLElement>('label, button, [role="radio"], [role="button"], input[type="radio"]'));
    const noProtLabel = labels.find(el => {
      const text = (el.textContent ?? "").trim().toLowerCase();
      return text.includes("no protection") || text.includes("willing to risk") || text.includes("i'm willing");
    });
    if (noProtLabel) {
      noProtLabel.scrollIntoView({ block: "center" });
      noProtLabel.click();
      return true;
    }
    // Also try clicking an <input type="radio"> with nearby "no protection" text
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    for (const radio of radios) {
      const container = radio.closest('[class*="option"], [class*="Option"], [class*="plan"], li, div');
      const text = (container?.textContent ?? "").toLowerCase();
      if (text.includes("no protection") || text.includes("willing to risk")) {
        radio.click();
        return true;
      }
    }
    return false;
  }).catch(() => false);
  if (protectionSelected) {
    trace("Expedia payment: selected 'No protection' plan");
  } else {
    trace("Expedia payment: 'Protect your stay' section not found or already handled");
  }

  // Fill cardholder name
  if (profile.card_name) {
    await fillExpediaGroupPaymentField(page, EXPEDIA_GROUP_CARD_NAME_SELECTORS, profile.card_name, "cardholder name", trace);
  }

  // Fill card number
  if (profile.card_number) {
    await fillExpediaGroupPaymentField(page, EXPEDIA_GROUP_CARD_NUMBER_SELECTORS, profile.card_number, "card number", trace);
  }

  // Fill expiry date — stop before CVV
  if (profile.card_expiry) {
    await fillExpediaGroupPaymentField(page, EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS, profile.card_expiry, "expiry date", trace);
  }

  // Fill billing ZIP code
  const billingZip = profile.billing_zip ?? profile.zip;
  if (billingZip) {
    await fillExpediaGroupPaymentField(page, EXPEDIA_BILLING_ZIP_SELECTORS, billingZip, "billing ZIP", trace);
  } else {
    trace("Expedia payment: no billing ZIP in profile — skipping");
  }

  // Verification pass
  const verifyField = async (selectors: string[], fieldName: string): Promise<boolean> => {
    for (const sel of selectors) {
      const val = await page.evaluate((s) => {
        const el = document.querySelector<HTMLInputElement>(s);
        return el ? el.value : null;
      }, sel).catch(() => null);
      if (val !== null) {
        trace(`Expedia payment verify: ${fieldName} = "${val.length > 0 ? "[filled]" : "[empty]"}"`);
        return val.length > 0;
      }
    }
    // Also check iframes
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      for (const sel of selectors) {
        const val = await frame.evaluate((s) => {
          const el = document.querySelector<HTMLInputElement>(s);
          return el ? el.value : null;
        }, sel).catch(() => null);
        if (val !== null) {
          trace(`Expedia payment verify (iframe): ${fieldName} = "${val.length > 0 ? "[filled]" : "[empty]"}"`);
          return val.length > 0;
        }
      }
    }
    trace(`Expedia payment verify: ${fieldName} field not found`);
    return false;
  };

  const nameOk = profile.card_name ? await verifyField(EXPEDIA_GROUP_CARD_NAME_SELECTORS, "cardholder name") : true;
  const numberOk = profile.card_number ? await verifyField(EXPEDIA_GROUP_CARD_NUMBER_SELECTORS, "card number") : true;
  const expiryOk = profile.card_expiry ? await verifyField(EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS, "expiry") : true;
  trace(`Expedia payment verification: name=${nameOk}, cardNumber=${numberOk}, expiry=${expiryOk}`);
}

export const expediaProvider: BrowserProvider = {
  id: "expedia",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("expedia.com");
  },

  async setup(_page: Page, _context: unknown, trace: (msg: string) => void): Promise<void> {
    trace("[expedia] setup: watching for external-site redirects (IHG, Marriott, Hilton, etc.)");
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    const searchResults =
      lowerUrl.includes("/hotel-search") ||
      lowerUrl.includes("/hotels");

    // Expedia hotel detail URL formats:
    //   /h/12345  (old format)
    //   .h12345.  (new: "City-Hotels-Name.h12345.Hotel-Information")
    const hotelDetail =
      /\/h\/\d+/.test(lowerUrl) ||
      /[./]h\d+[./]/.test(lowerUrl) ||
      (lowerUrl.includes("/hotel/") && !lowerUrl.includes("/checkout"));

    const isCheckout = lowerUrl.includes("/checkout");

    // /checkout/session/ is the Expedia payment step URL pattern (card fields in cross-origin iframe)
    // /checkout/info/ or /checkout/ root is the guest details step
    const isPaymentSessionUrl = lowerUrl.includes("/checkout/session");

    // Guest details step: on checkout but NOT on the payment session page
    const guestDetailsStep = isCheckout && !isPaymentSessionUrl && await page.evaluate(() => {
      const hasNameInput = !!document.querySelector('input[id*="firstName"], input[id*="lastName"], input[name*="firstName"], input[name*="lastName"], input[autocomplete*="given-name"], input[autocomplete*="family-name"]');
      const hasEmailInput = !!document.querySelector('input[type="email"], input[id*="email"], input[name*="email"]');
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
    await fillExpediaGuestForm(page, profile as ExpediaGroupProfile & { first_name?: string; last_name?: string; email?: string; phone?: string }, trace);
  },

  async fillPaymentForm(page: Page, profile: unknown, _helpers: unknown, trace: (msg: string) => void): Promise<void> {
    await fillExpediaGroupPaymentForm(page, profile as ExpediaGroupProfile, trace);
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
