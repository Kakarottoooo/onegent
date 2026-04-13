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
export const EXPEDIA_GROUP_CARD_NAME_LABELS = ["Name on card", "Cardholder name", "Name on Card", "Card holder name"];

export const EXPEDIA_GROUP_CARD_NUMBER_SELECTORS = [
  'input[placeholder="0000 0000 0000 0000"]',
  'input[id*="cardNumber"], input[id*="card-number"]',
  'input[name*="cardNumber"], input[name*="card-number"]',
  'input[autocomplete="cc-number"]',
  'input[placeholder*="Card number"], input[placeholder*="card number"]',
  // Braintree hosted fields use id="credit-card-number" and type="tel"
  'input[id*="credit-card"], input[id="number"]',
  'input[type="tel"][id*="card"], input[type="tel"][name*="card"]',
  'input[type="text"][autocomplete="cc-number"]',
];

export const EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS = [
  'input[placeholder="MM/YY"]',
  'input[id*="expiryDate"], input[id*="expiry"], input[id*="expiration"]',
  'input[name*="expiryDate"], input[name*="expiry"], input[name*="expiration"]',
  'input[autocomplete="cc-exp"]',
  'input[placeholder*="MM/YY"], input[placeholder*="Expiry"], input[placeholder*="Expiration"]',
  // Braintree hosted fields
  'input[id="expiration"], input[id="expirationDate"]',
  'input[type="tel"][id*="expir"]',
];

interface ExpediaGroupProfile {
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
  billing_zip?: string;
  zip?: string; // fallback alias from BookingProfile
  // Guest fields (needed when checkout page combines guest info + payment on one page)
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

// Billing ZIP code selectors for Expedia checkout.
// NOTE: "autocomplete=postal-code" is intentionally omitted — Expedia checkout pages often
// have multiple fields with that attribute (including street address), and browser autocomplete
// can overwrite the filled value with a full address suggestion. Use explicit id/name/placeholder
// selectors only, which are more stable and specific.
const EXPEDIA_BILLING_ZIP_SELECTORS = [
  // Confirmed from live Expedia checkout debug (id="payment_zip_code")
  'input[id="payment_zip_code"]',
  'input[id*="billingZip"], input[id*="billing-zip"], input[id*="BillingZip"]',
  'input[name*="billingZip"], input[name*="billing-zip"]',
  'input[placeholder*="ZIP code"], input[placeholder*="Zip code"], input[placeholder*="Postal code"]',
  'input[aria-label*="Billing ZIP"], input[aria-label*="ZIP code"], input[aria-label*="ZIP Code"]',
  'input[id*="zipCode"], input[id*="zip-code"], input[name*="zipCode"]',
];

/**
 * Fill a form input using the same technique as Booking.com:
 *  1. locator.fill() — standard Playwright
 *  2. Native HTMLInputElement setter + dispatchEvent — forces React to recognize the change
 *  3. pressSequentially — keyboard simulation fallback
 *
 * This is critical for React-controlled inputs where plain fill() doesn't trigger state updates.
 */
async function fillReactInput(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  value: string,
  label: string,
  trace: (msg: string) => void,
  isDigits = false
): Promise<boolean> {
  if (!value) return false;

  const verify = async (): Promise<boolean> => {
    try {
      const actual = await locator.inputValue({ timeout: 1000 });
      return actual.replace(/\s/g, "") === value.replace(/\s/g, "");
    } catch { return false; }
  };

  // Step 1: standard fill
  try {
    await locator.click({ clickCount: 3 }).catch(() => {});
    await locator.fill(value);
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise(r => setTimeout(r, 150));
    if (await verify()) {
      trace(`Expedia fill: "${label}" OK via locator.fill()`);
      return true;
    }
  } catch { /* fall through */ }

  // Step 2: native setter + React event dispatch (same technique as Booking.com)
  try {
    const filled = await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.focus();
      if (nativeSetter) {
        nativeSetter.call(input, "");
        nativeSetter.call(input, v);
      } else {
        input.value = v;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return true;
    }, value).catch(() => false);
    if (filled) {
      await new Promise(r => setTimeout(r, 200));
      if (await verify()) {
        trace(`Expedia fill: "${label}" OK via native setter`);
        return true;
      }
    }
  } catch { /* fall through */ }

  // Step 3: keyboard simulation (last resort)
  try {
    await locator.click({ clickCount: 3 }).catch(() => {});
    if (typeof locator.pressSequentially === "function") {
      await locator.pressSequentially(value, { delay: isDigits ? 40 : 55 });
    } else {
      await page.keyboard.type(value, { delay: isDigits ? 40 : 55 });
    }
    await locator.blur().catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    if (await verify()) {
      trace(`Expedia fill: "${label}" OK via keyboard`);
      return true;
    }
  } catch { /* fall through */ }

  trace(`Expedia fill: "${label}" FAILED — all strategies exhausted`);
  return false;
}

/**
 * Find a visible input by label texts (getByLabel) or CSS selectors,
 * then fill it using the React-compatible native setter technique.
 */
async function findAndFillExpediaField(
  page: Page,
  labelTexts: string[],
  selectors: string[],
  value: string,
  label: string,
  trace: (msg: string) => void,
  isDigits = false
): Promise<boolean> {
  if (!value) return false;

  // Try getByLabel first — most robust, works regardless of id/name/placeholder
  for (const labelText of labelTexts) {
    try {
      const loc = page.getByLabel(labelText, { exact: false });
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      const first = loc.first();
      if (!(await first.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      const ok = await fillReactInput(page, first, value, `${label} [label="${labelText}"]`, trace, isDigits);
      if (ok) return true;
    } catch { /* try next */ }
  }

  // Try CSS selectors — scan main page only (iframes handled separately by fillCardFieldsInPaymentIframes)
  // NOTE: scrollIntoViewIfNeeded is NOT available on Stagehand-proxied locators — do NOT call it here.
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      const ok = await fillReactInput(page, loc, value, `${label} [sel="${sel}"]`, trace, isDigits);
      if (ok) return true;
    } catch { /* try next */ }
  }

  trace(`Expedia fill: "${label}" — no matching visible field found`);
  return false;
}

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
  trace: (msg: string) => void,
  labelTexts?: string[]
): Promise<boolean> {
  if (!value) return false;

  // Strategy 0: getByLabel — works even without knowing the exact selector/id
  if (labelTexts && labelTexts.length > 0) {
    for (const labelText of labelTexts) {
      try {
        const locator = page.getByLabel(labelText, { exact: false });
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const el = locator.first();
        if (!(await el.isVisible({ timeout: 1000 }).catch(() => false))) continue;
        await el.click({ clickCount: 3 }).catch(() => {});
        await el.fill(value);
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise(r => setTimeout(r, 150));
        const actual = await el.inputValue().catch(() => "");
        if (actual === value) {
          trace(`Expedia payment: filled ${label} via label "${labelText}"`);
          return true;
        }
        // Fallback to keyboard type if fill didn't stick
        await el.click({ clickCount: 3 }).catch(() => {});
        await page.keyboard.type(value, { delay: 40 });
        await page.keyboard.press("Escape").catch(() => {});
        const actual2 = await el.inputValue().catch(() => "");
        if (actual2 === value) {
          trace(`Expedia payment: filled ${label} via label "${labelText}" (keyboard)`);
          return true;
        }
      } catch {
        // try next label
      }
    }
  }

  // First check inline (main page)
  const inlineMatch = await findVisibleInScope(page, selectorList);
  if (inlineMatch) {
    try {
      await page.click(inlineMatch.selector, { clickCount: 3 }).catch(() => {});
      await page.fill(inlineMatch.selector, value);
      // Dismiss any browser autocomplete dropdown that might override the typed value
      await page.keyboard.press("Escape").catch(() => {});
      await new Promise(r => setTimeout(r, 150));
      // Verify the value actually stuck (autocomplete can overwrite it)
      const filled = await page.evaluate((sel) => {
        const el = document.querySelector<HTMLInputElement>(sel);
        return el ? el.value : "";
      }, inlineMatch.selector).catch(() => "");
      if (filled !== value) {
        trace(`Expedia payment: ${label} mismatch after fill (got "${filled.slice(0, 30)}") — retrying with keyboard`);
        // Fallback: triple-click + keyboard type to avoid autocomplete
        await page.click(inlineMatch.selector, { clickCount: 3 }).catch(() => {});
        await page.keyboard.type(value, { delay: 40 });
        await page.keyboard.press("Escape").catch(() => {});
        await new Promise(r => setTimeout(r, 150));
        const filled2 = await page.evaluate((sel) => {
          const el = document.querySelector<HTMLInputElement>(sel);
          return el ? el.value : "";
        }, inlineMatch.selector).catch(() => "");
        trace(`Expedia payment: ${label} after keyboard retry = "${filled2.slice(0, 30)}"`);
      } else {
        trace(`Expedia payment: filled ${label} inline OK`);
      }
      return true;
    } catch (err) {
      trace(`Expedia payment: inline fill failed for ${label}: ${(err as Error).message?.slice(0, 80)}`);
    }
  }

  // Try iframes — include ALL non-blank frames since payment processors (Braintree, etc.)
  // use cross-origin iframes whose URLs don't contain "expedia" or "checkout"
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    const rawUrl: unknown = frame.url;
    const frameUrl = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
    if (!frameUrl || frameUrl === "about:blank" || frameUrl === "about:srcdoc") continue;
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
 * Fill Expedia / Hotels.com guest fields using page.evaluate + native HTMLInputElement setter.
 *
 * Uses page.evaluate() instead of locator.evaluate() because the Stagehand proxy
 * does NOT expose .evaluate() on locators. page.evaluate() is always available.
 *
 * Expedia uses non-standard IDs like "smart-form-control-input-component-trave"
 * so we match by placeholder pattern and input type instead of id/name/autocomplete.
 *
 * Confirmed field patterns from live debug:
 *   input[0]: placeholder="(e.g. John)"  type=text  → First name
 *   input[1]: placeholder="(e.g. Smith)" type=text  → Last name
 *   input[2]: type=email                            → Email
 *   input[3]: type=tel (not country code)           → Phone
 */
export async function fillExpediaGuestForm(
  page: Page,
  profile: ExpediaGuestProfile,
  trace: (msg: string) => void,
): Promise<void> {
  // Wait for guest fields to appear using confirmed placeholder patterns
  await page.waitForSelector(
    'input[placeholder*="John"], input[placeholder*="Smith"], input[type="email"]',
    { timeout: 8000 }
  ).catch(() => null);
  await new Promise(r => setTimeout(r, 400));

  // Dismiss any checkout nudge modal (e.g. "This booking is almost yours!") before filling
  await dismissExpediaAlmostYoursModal(page, trace);

  const phoneDigits = (profile.phone ?? "").replace(/\D/g, "");

  // Fill all 4 guest fields via page.evaluate + native setter in a single pass.
  // This approach:
  //   - Uses page.evaluate() which IS available on the Stagehand proxy
  //   - Finds inputs by placeholder/type pattern (not by fragile id/name selectors)
  //   - Uses native HTMLInputElement setter to trigger React state updates
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

      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      // Filter to visible, interactive inputs only
      const visible = allInputs.filter(el =>
        el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" &&
        !el.disabled && (el.offsetParent !== null || el.getBoundingClientRect().width > 0)
      );

      const results: Record<string, boolean | string> = {};

      // First name: placeholder contains "John" (confirmed: "(e.g. John)")
      const firstEl = visible.find(el =>
        el.placeholder.toLowerCase().includes("john") ||
        el.autocomplete === "given-name" ||
        el.id.toLowerCase().includes("firstname") ||
        el.name.toLowerCase().includes("firstname")
      );
      results.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

      // Last name: placeholder contains "Smith" (confirmed: "(e.g. Smith)")
      const lastEl = visible.find(el =>
        el.placeholder.toLowerCase().includes("smith") ||
        el.autocomplete === "family-name" ||
        el.id.toLowerCase().includes("lastname") ||
        el.name.toLowerCase().includes("lastname")
      );
      results.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

      // Email: type="email" is unambiguous
      const emailEl = visible.find(el => el.type === "email");
      results.email = emailEl ? nativeFill(emailEl, email) : "not_found";

      // Phone: type="tel" but NOT country code/region selectors
      const phoneEl = visible.find(el =>
        el.type === "tel" &&
        !el.id.toLowerCase().includes("country") &&
        !el.id.toLowerCase().includes("region") &&
        !el.id.toLowerCase().includes("code") &&
        !el.name.toLowerCase().includes("country") &&
        !(el.getAttribute("aria-label") ?? "").toLowerCase().includes("country")
      );
      results.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

      return results;
    },
    {
      first: profile.first_name ?? "",
      last: profile.last_name ?? "",
      email: profile.email ?? "",
      phone: phoneDigits,
    }
  ).catch((err: Error) => {
    trace(`Expedia guest fill: page.evaluate failed — ${err.message?.slice(0, 80)}`);
    return {} as Record<string, boolean | string>;
  });

  trace(`Expedia guest fill results: ${JSON.stringify(results)}`);

  // Fallback for any field that wasn't found via page.evaluate: try findAndFillExpediaField
  if (results.firstName === "not_found" && profile.first_name) {
    trace("Expedia guest: first name not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["First name", "First Name", "Given name"],
      ['input[placeholder*="John"]', 'input[autocomplete="given-name"]', 'input[placeholder*="First name"]'],
      profile.first_name, "first name", trace);
  }
  if (results.lastName === "not_found" && profile.last_name) {
    trace("Expedia guest: last name not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Last name", "Last Name", "Family name"],
      ['input[placeholder*="Smith"]', 'input[autocomplete="family-name"]', 'input[placeholder*="Last name"]'],
      profile.last_name, "last name", trace);
  }
  if (results.email === "not_found" && profile.email) {
    trace("Expedia guest: email not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Email address", "Email"],
      ['input[type="email"]', 'input[autocomplete="email"]'],
      profile.email, "email", trace);
  }
  if (results.phone === "not_found" && phoneDigits) {
    trace("Expedia guest: phone not found via evaluate — trying locator fallback");
    await findAndFillExpediaField(page,
      ["Phone number", "Phone Number"],
      ['input[type="tel"]:not([id*="country"])'],
      phoneDigits, "phone", trace, true);
  }
}

/**
 * Dismiss the Expedia "This booking is almost yours!" nudge modal if present.
 * This modal appears on the /checkout/session/ payment page and blocks form fill.
 * Strategy: click "Continue booking" button, or fall back to the × close button.
 * @param waitMs - optional wait before checking (modal may render after page interaction)
 */
async function dismissExpediaAlmostYoursModal(page: Page, trace: (msg: string) => void, waitMs = 0): Promise<void> {
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

  // Detect modal via text content OR by presence of "Continue booking" button
  // (body.textContent can be slow/stale; button presence is more reliable)
  const hasModal = await page.evaluate(() => {
    const bodyText = (document.body.textContent ?? "").toLowerCase();
    if (bodyText.includes("almost yours") || bodyText.includes("booking is almost")) return true;
    // Also detect via "Continue booking" button that is visible (used in the modal)
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    return buttons.some(btn => {
      const text = (btn.textContent ?? "").trim().toLowerCase();
      if (text !== "continue booking") return false;
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }).catch(() => false);

  trace(`Expedia: 'almost yours' modal check — found=${hasModal}`);
  if (!hasModal) return;

  // Strategy 1: click the "Continue booking" button directly
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
    for (const btn of buttons) {
      const text = (btn.textContent ?? "").trim().toLowerCase();
      if (text === "continue booking" || text === "continue") {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          (btn as HTMLElement).click();
          return "continue_booking";
        }
      }
    }
    return null;
  }).catch(() => null);

  if (clicked) {
    trace(`Expedia: dismissed 'almost yours' modal via '${clicked}' button`);
    await new Promise(r => setTimeout(r, 600));
    return;
  }

  // Strategy 2: click the × close button inside any modal-like container with "almost yours" text
  const closedX = await page.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const btn of allButtons) {
      const text = (btn.textContent ?? "").trim();
      const ariaLabel = (btn.getAttribute("aria-label") ?? "").toLowerCase();
      const isClose = text === "×" || text === "✕" || text === "✗" ||
        text.toLowerCase() === "x" || text.toLowerCase() === "close" ||
        ariaLabel.includes("close") || ariaLabel.includes("dismiss");
      if (!isClose) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Verify container has "almost yours" text
      let ancestor: HTMLElement | null = btn.parentElement;
      while (ancestor && ancestor !== document.body) {
        if ((ancestor.textContent ?? "").toLowerCase().includes("almost yours")) {
          (btn as HTMLElement).click();
          return true;
        }
        ancestor = ancestor.parentElement;
      }
    }
    return false;
  }).catch(() => false);

  if (closedX) {
    trace("Expedia: dismissed 'almost yours' modal via × close button");
    await new Promise(r => setTimeout(r, 600));
    return;
  }

  // Strategy 3: press Escape — works for most modal implementations
  try {
    await page.keyboard.press("Escape");
    trace("Expedia: pressed Escape to dismiss 'almost yours' modal");
    await new Promise(r => setTimeout(r, 600));
    return;
  } catch { /* ignore */ }

  // Strategy 4: click the first visible button INSIDE the modal container
  // (catches SVG-icon-only × buttons with no text or aria-label)
  const closedAny = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const modalEl = allEls.find(el => {
      const t = (el.textContent ?? "").toLowerCase();
      return (t.includes("almost yours") || t.includes("continue booking")) &&
        el.querySelectorAll("button, [role='button']").length > 0;
    });
    if (!modalEl) return false;
    // Try non-primary buttons first (the close/dismiss button), then primary
    const btns = Array.from(modalEl.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const closeBtn = btns.find(b => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const t = (b.textContent ?? "").trim().toLowerCase();
      // Close buttons are usually small and have short/empty text
      return t === "" || t === "×" || t === "✕" || t === "x" || t.length < 5;
    });
    const target = closeBtn ?? btns.find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (target) { target.click(); return true; }
    return false;
  }).catch(() => false);

  if (closedAny) {
    trace("Expedia: dismissed 'almost yours' modal via strategy 4 (any button in modal container)");
    await new Promise(r => setTimeout(r, 600));
  } else {
    trace("Expedia: 'almost yours' modal present but could not dismiss — continuing anyway");
  }
}

/**
 * Scan all non-blank iframes for payment widget card inputs and fill them.
 *
 * Expedia's payment widget (Checkout.com, Braintree, etc.) loads card inputs
 * inside cross-origin iframes positioned over placeholder elements in the main DOM.
 * The Frame objects returned by page.frames() have full Playwright API (NOT the
 * Stagehand proxy restriction), so we can use frame.locator().nth().fill() freely.
 *
 * Detection: match visible inputs by placeholder, aria-label, or autocomplete:
 *   - Card number: placeholder "0000 0000 0000 0000" or aria-label/autocomplete
 *   - Expiry: placeholder "MM/YY" or similar
 *   - Cardholder name: placeholder/label contains "name"
 *
 * Returns which fields were successfully filled in iframes.
 */
async function fillCardFieldsInPaymentIframes(
  page: Page,  // needed for page.keyboard fallback
  cardName: string,
  cardNumber: string,
  cardExpiry: string,
  trace: (msg: string) => void
): Promise<{ name: boolean; number: boolean; expiry: boolean }> {
  // Safe URL getter — f.url is a method, not a property; calling without `this` binding loses context
  const getFrameUrl = (f: Frame): string => {
    try { return f.url(); } catch { return "(url-error)"; }
  };

  const allFrames = page.frames();
  const nonMainFrames = allFrames.filter(f => f !== page.mainFrame());
  trace(`Expedia card iframes: total=${allFrames.length}, non-main=${nonMainFrames.length}`);

  // Debug dump: show URL + input count for every non-main frame.
  // Checkout.com uses about:srcdoc frames (previously filtered out incorrectly).
  for (let i = 0; i < Math.min(nonMainFrames.length, 30); i++) {
    const f = nonMainFrames[i];
    const url = getFrameUrl(f);
    const inputCount = await f.evaluate(() =>
      document.querySelectorAll("input").length
    ).catch(() => -1);
    // Only log frames with inputs or the first few (to diagnose empty frames)
    if (inputCount > 0 || i < 6) {
      trace(`  frame[${i}] url="${url.slice(0, 60)}" inputs=${inputCount}`);
    }
  }

  // Scan ALL non-main frames — do NOT filter by URL.
  // Checkout.com and similar widgets use about:srcdoc or dynamically-written about:blank
  // frames that contain the real card inputs, hidden from the parent page.
  const filled = { name: false, number: false, expiry: false };

  for (const frame of nonMainFrames) {
    const frameUrl = getFrameUrl(frame);

    // Get all non-hidden inputs in this frame.
    // NOTE: We intentionally DO NOT filter by visibility here — Checkout.com and
    // similar PCI-widget iframes often have inputs with offsetParent === null (they
    // use position:fixed or are inside a transform context), so the strict visibility
    // check would skip them. We try ALL non-hidden inputs and let fill() fail gracefully.
    const inputs = await frame.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((el, i) => ({
        i,
        type: el.type || "text",
        id: el.id || "",
        placeholder: el.placeholder || "",
        autocomplete: el.autocomplete || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      }))
    ).catch(() => [] as Array<{ i: number; type: string; id: string; placeholder: string; autocomplete: string; ariaLabel: string }>);

    const candidateInputs = inputs.filter(d => d.type !== "hidden");
    if (candidateInputs.length === 0) continue;

    trace(`Expedia card: frame (${frameUrl.slice(0, 60)}) has ${candidateInputs.length} input(s)`);
    for (const d of candidateInputs) {
      trace(`  [${d.i}] type=${d.type} id="${d.id.slice(0, 30)}" ph="${d.placeholder.slice(0, 30)}" aria="${d.ariaLabel.slice(0, 30)}" ac=${d.autocomplete}`);
    }

    for (const inp of candidateInputs) {
      const ph = inp.placeholder.toLowerCase();
      const lbl = inp.ariaLabel.toLowerCase();
      const ac = inp.autocomplete.toLowerCase();
      const id = inp.id.toLowerCase();

      // Identify field type by placeholder / aria-label / autocomplete / id
      let fieldType: "name" | "number" | "expiry" | null = null;
      let value = "";

      if (
        ph.includes("0000") || ph.includes("card number") ||
        lbl.includes("card number") || lbl.includes("card no") ||
        ac === "cc-number" || id === "pan" || id.includes("pan-") ||
        id.includes("card-num") || id.includes("cardnum") ||
        id === "number" || id === "payment_credit_card" || id.includes("credit-card")
      ) {
        fieldType = "number";
        value = cardNumber;
      } else if (
        ph === "mm/yy" || ph.includes("mm / yy") || ph.includes("mm/yyyy") ||
        ph.includes("expir") || lbl.includes("expir") || lbl.includes("expiry") ||
        ac === "cc-exp" || id === "expiry" || id.includes("expir")
      ) {
        fieldType = "expiry";
        value = cardExpiry;
      } else if (
        // Use PRECISE matching only — "id.includes('name')" is too broad and matches
        // guest form inputs like "smart-form-control-input-component-traveler-first-name"
        ac === "cc-name" ||
        id === "name" || id === "chn" || id.includes("chn-") ||
        lbl.includes("name on card") || lbl.includes("cardholder") ||
        ph.includes("name on card") || ph.includes("cardholder")
      ) {
        fieldType = "name";
        value = cardName;
      }

      if (!fieldType || !value) continue;

      try {
        const loc = frame.locator("input").nth(inp.i);
        // NOTE: scrollIntoViewIfNeeded is NOT available on Stagehand-proxied locators.
        // Skip it — click() will scroll automatically if needed.
        await loc.click({ clickCount: 3 }).catch(() => {});
        await loc.fill(value);
        await new Promise(r => setTimeout(r, 200));
        const actual = await loc.inputValue().catch(() => "");
        const ok = actual.replace(/\s/g, "") === value.replace(/\s/g, "") || actual.length > 0;
        trace(`Expedia card: ${fieldType} fill — ${ok ? "OK" : "EMPTY"} (got "${actual.slice(0, 20)}")`);
        if (ok) filled[fieldType] = true;

        // Fallback: keyboard type if fill didn't stick
        if (!ok) {
          await loc.click({ clickCount: 3 }).catch(() => {});
          await page.keyboard.type(value, { delay: 50 });
          await new Promise(r => setTimeout(r, 200));
          const actual2 = await loc.inputValue().catch(() => "");
          if (actual2.length > 0) {
            trace(`Expedia card: ${fieldType} fill via keyboard — OK`);
            filled[fieldType] = true;
          }
        }
      } catch (err) {
        trace(`Expedia card: ${fieldType} fill error — ${(err as Error).message?.slice(0, 60)}`);
      }
    }

    // ── Frame-locator fallback: try CSS selectors directly on frame ─────────
    // This catches cases where evaluate() returned inputs but index-based .nth()
    // mismatches due to DOM changes between evaluate and locator calls.
    if (!filled.number && cardNumber) {
      for (const sel of [
        'input[placeholder*="0000"]', 'input[autocomplete="cc-number"]',
        'input[id*="pan"]', 'input[id*="card-num"]', 'input[id*="cardnum"]',
        'input[id="number"]', 'input[id*="credit-card"]',
      ]) {
        try {
          const loc = frame.locator(sel).first();
          const count = await loc.count().catch(() => 0);
          if (count === 0) continue;
          await loc.click({ clickCount: 3 }).catch(() => {});
          if (typeof (loc as { pressSequentially?: (v: string, o?: { delay: number }) => Promise<void> }).pressSequentially === "function") {
            await (loc as { pressSequentially: (v: string, o: { delay: number }) => Promise<void> }).pressSequentially(cardNumber, { delay: 50 });
          } else {
            await loc.fill(cardNumber);
          }
          const actual = await loc.inputValue().catch(() => "");
          if (actual.replace(/\s/g, "").length > 0) {
            trace(`Expedia card: number filled via frame.locator("${sel}") in ${frameUrl.slice(0, 40)}`);
            filled.number = true;
            break;
          }
        } catch { /* try next */ }
      }
    }
    if (!filled.expiry && cardExpiry) {
      for (const sel of [
        'input[placeholder="MM/YY"]', 'input[placeholder*="MM"]',
        'input[autocomplete="cc-exp"]', 'input[id*="expir"]', 'input[id="expiry"]',
      ]) {
        try {
          const loc = frame.locator(sel).first();
          const count = await loc.count().catch(() => 0);
          if (count === 0) continue;
          await loc.click({ clickCount: 3 }).catch(() => {});
          await loc.fill(cardExpiry);
          const actual = await loc.inputValue().catch(() => "");
          if (actual.replace(/\s/g, "").length > 0) {
            trace(`Expedia card: expiry filled via frame.locator("${sel}") in ${frameUrl.slice(0, 40)}`);
            filled.expiry = true;
            break;
          }
        } catch { /* try next */ }
      }
    }
  }

  const anyFilled = filled.name || filled.number || filled.expiry;
  if (!anyFilled) {
    trace("Expedia card iframes: no card inputs found in any frame — widget may not be loaded");
  } else {
    trace(`Expedia card iframes: filled name=${filled.name}, number=${filled.number}, expiry=${filled.expiry}`);
  }
  return filled;
}

export async function fillExpediaGroupPaymentForm(
  page: Page,
  profile: ExpediaGroupProfile,
  trace: (msg: string) => void
): Promise<void> {
  // Wait for the checkout page to fully render before interacting.
  // Expedia's React checkout lazy-renders card fields and modals after initial page load.
  trace("Expedia payment: waiting for checkout page to fully render...");
  await Promise.race([
    // Wait for card number input OR the modal to appear (whichever comes first)
    page.waitForSelector(
      'input[placeholder="0000 0000 0000 0000"], input[placeholder*="Name on card"], [placeholder*="Card number"], input[id*="cardNumber"], input[autocomplete="cc-number"]',
      { timeout: 8000 }
    ).catch(() => null),
    page.waitForSelector(
      'button:has-text("Continue booking"), button:has-text("continue booking")',
      { timeout: 8000 }
    ).catch(() => null),
    new Promise(r => setTimeout(r, 8000)), // hard cap
  ]);
  // Extra settle time after DOM appears (React effects / autocomplete / animation)
  await new Promise(r => setTimeout(r, 800));
  trace("Expedia payment: page settled — proceeding with modal dismiss and form fill");

  // Dismiss the "This booking is almost yours!" nudge modal if present
  await dismissExpediaAlmostYoursModal(page, trace);

  // ── DEBUG: dump all inputs via page.evaluate (works with Stagehand proxy) ──
  try {
    const inputData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map((e, i) => ({
        i,
        type: e.type || "-",
        id: (e.id || "-").slice(0, 40),
        name: (e.name || "-").slice(0, 40),
        placeholder: (e.placeholder || "-").slice(0, 40),
        autocomplete: e.autocomplete || "-",
        ariaLabel: (e.getAttribute("aria-label") || "-").slice(0, 40),
        visible: e.offsetParent !== null,
      }));
    }).catch(() => []);
    trace(`Expedia DEBUG: page.evaluate found ${inputData.length} input(s)`);
    for (const d of inputData.slice(0, 12)) {
      trace(`  input[${d.i}]: ${JSON.stringify(d)}`);
    }
  } catch (dbgErr) {
    trace(`Expedia DEBUG: input scan failed — ${(dbgErr as Error).message?.slice(0, 80)}`);
  }

  // Always attempt guest fill on /checkout/session (combined guest+payment page)
  trace("Expedia payment: attempting guest info fill (combined checkout page)");
  await fillExpediaGuestForm(page, profile, trace);
  await new Promise(r => setTimeout(r, 400));

  // Detect inline vs iframe payment (use Playwright locator for shadow DOM support)
  const inlineCardCount = await page.locator(
    'input[placeholder="0000 0000 0000 0000"], input[id*="cardNumber"], input[autocomplete="cc-number"]'
  ).count().catch(() => 0);

  // Log all non-blank iframes for debugging (payment processor iframes may be cross-origin)
  const allFrames = page.frames().filter(f => {
    if (f === page.mainFrame()) return false;
    const rawUrl: unknown = f.url;
    const url = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "");
    return url && url !== "about:blank" && url !== "about:srcdoc";
  });
  const iframeCount = allFrames.length;
  if (allFrames.length > 0) {
    trace(`Expedia payment: found ${allFrames.length} non-blank iframe(s): ${allFrames.map(f => {
      const u: unknown = f.url;
      return (typeof u === "function" ? (u as () => string)() : (u as string) ?? "").slice(0, 60);
    }).join(" | ")}`);
  }

  trace(`Expedia payment: detected ${inlineCardCount} inline card input(s), ${iframeCount} total iframe(s)`);

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

  // After protection plan interaction, Expedia may show a confirmation dialog
  // (e.g. "Your stay is not protected. Continue?"). Dismiss it before card fill.
  await new Promise(r => setTimeout(r, 600));
  const protectionModalDismissed = await page.evaluate(() => {
    // Look for a modal/dialog overlay that appeared after protection plan selection
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], .modal, [class*="modal"], [class*="dialog"], [class*="overlay"]'
    ));
    for (const dialog of dialogs) {
      const r = dialog.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Find a dismiss button inside
      const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button, [role="button"]'));
      const dismissBtn = buttons.find(btn => {
        const text = (btn.textContent ?? "").trim().toLowerCase();
        return text === "continue" || text === "continue booking" || text === "got it" ||
          text === "ok" || text === "close" || text === "i understand" || text === "dismiss" ||
          text === "×" || text === "✕";
      });
      if (dismissBtn) {
        const br = dismissBtn.getBoundingClientRect();
        if (br.width > 0 && br.height > 0) {
          (dismissBtn as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);
  if (protectionModalDismissed) {
    trace("Expedia payment: dismissed protection plan confirmation dialog");
    await new Promise(r => setTimeout(r, 500));
  }
  // Also run the "almost yours" check
  await dismissExpediaAlmostYoursModal(page, trace, 200);

  // Ensure "Card" payment method is selected (clicking protection plan may deselect it)
  const cardSelected = await page.evaluate(() => {
    // Find and click a "Card" radio/button in the payment section
    const els = Array.from(document.querySelectorAll<HTMLElement>('input[type="radio"], button, [role="radio"], label'));
    const cardEl = els.find(el => {
      const text = (el.textContent ?? "").trim().toLowerCase();
      const val = (el as HTMLInputElement).value?.toLowerCase() ?? "";
      return text === "card" || val === "card" || text.includes("credit") || text.includes("debit");
    });
    if (cardEl) { (cardEl as HTMLElement).click(); return true; }
    return false;
  }).catch(() => false);
  if (cardSelected) {
    trace("Expedia payment: re-selected 'Card' payment method");
    await new Promise(r => setTimeout(r, 600));
  }

  // Scroll to the card details section so fields become visible
  await page.evaluate(() => {
    const cardSection = Array.from(document.querySelectorAll<HTMLElement>('*')).find(el => {
      const text = (el.textContent ?? "").trim();
      return text.startsWith("Card details") || text.startsWith("Card number") || text.includes("0000 0000 0000");
    });
    if (cardSection) cardSection.scrollIntoView({ block: "center" });
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));

  // ── Card fields strategy ──────────────────────────────────────────────────────
  // Expedia uses Checkout.com (CKO) for payment. CKO renders card inputs inside
  // cross-origin iframes that are positioned OVER placeholder divs in the main DOM:
  //   <input id="chn-input-placeholder" type="text" style="display:none">  ← hidden
  //   <iframe ...>  ← real input here, inaccessible via frame.evaluate()
  //
  // From live debugging (2026-04-12):
  //   • page.frames() returns 28 frames, all cross-origin (url-error, inputs=-1)
  //   • The placeholder elements have visible=false (display:none / 0 bbox)
  //   • frame.evaluate() fails for all Checkout.com frames
  //   • page is a Stagehand CDP Page (NOT Playwright) — page.mouse is undefined!
  //     Use page.click(x, y) directly (Stagehand Page API) for coordinate clicks.
  //
  // Strategy (in order):
  //   1. Playwright frameLocator() with Checkout.com iframe selectors (CKO IDs)
  //   2. Visible iframe scan: find <iframe> elements with non-zero bounding box,
  //      sort by vertical position, click center → keyboard.type()
  //   3. Placeholder-parent climb: walk up DOM from placeholder until a parent
  //      has a visible bounding box, click its center → keyboard.type()
  //   4. fillCardFieldsInPaymentIframes: existing frame evaluate scan
  //   5. findAndFillExpediaField: inline page.locator() for non-iframe forms
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Strategy 1: Playwright frameLocator() ─────────────────────────────────
  // Checkout.com injects iframes with IDs like "cko-frames-cardnumber",
  // "cko-frames-expirydate", "cko-frames-cardholdername".
  let checkoutComFrameFilled = { name: false, number: false, expiry: false };
  try {
    const ckoFieldMap = [
      {
        key: "name" as const,
        value: profile.card_name ?? "",
        iframeSels: ['iframe[id*="cardholdername" i]', 'iframe[id*="holdername" i]', 'iframe[name*="cardholdername" i]'],
        inputSels: ['input[autocomplete="cc-name"]', 'input[id*="name"]', 'input'],
      },
      {
        key: "number" as const,
        value: profile.card_number ?? "",
        iframeSels: ['iframe[id*="cardnumber" i]', 'iframe[id*="card-number" i]', 'iframe[name*="cardnumber" i]', 'iframe[id*="pan" i]'],
        inputSels: ['input[autocomplete="cc-number"]', 'input[placeholder*="0000"]', 'input[id*="pan"]', 'input'],
      },
      {
        key: "expiry" as const,
        value: profile.card_expiry ?? "",
        iframeSels: ['iframe[id*="expirydate" i]', 'iframe[id*="expiry-date" i]', 'iframe[id*="expiry" i]', 'iframe[name*="expiry" i]'],
        inputSels: ['input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]', 'input'],
      },
    ];

    for (const field of ckoFieldMap) {
      if (!field.value) continue;
      for (const iframeSel of field.iframeSels) {
        try {
          const fl = page.frameLocator(iframeSel);
          for (const inputSel of field.inputSels) {
            const loc = fl.locator(inputSel).first();
            const count = await loc.count().catch(() => 0);
            if (count === 0) continue;
            await loc.click({ clickCount: 3 }).catch(() => {});
            await loc.fill(field.value);
            const actual = await loc.inputValue().catch(() => "");
            if (actual.replace(/\s/g, "").length > 0) {
              checkoutComFrameFilled[field.key] = true;
              trace(`CKO frameLocator: ${field.key} filled via "${iframeSel}" + "${inputSel}"`);
              break;
            }
          }
          if (checkoutComFrameFilled[field.key]) break;
        } catch { /* try next */ }
      }
    }
  } catch (ckoErr) {
    trace(`CKO frameLocator: outer error — ${(ckoErr as Error).message?.slice(0, 60)}`);
  }
  trace(`CKO frameLocator results: name=${checkoutComFrameFilled.name}, number=${checkoutComFrameFilled.number}, expiry=${checkoutComFrameFilled.expiry}`);

  // ── Strategy 2: visible iframe scan + click→keyboard ─────────────────────
  // Checkout.com iframes are visible on screen (non-zero bounding box).
  // We find them, sort by Y position (top=name/number, bottom=expiry), and
  // click the center of each iframe then use page.keyboard to type the value.
  const needsVisibleIframeFill = !checkoutComFrameFilled.number || !checkoutComFrameFilled.expiry;
  if (needsVisibleIframeFill) {
    try {
      // Get bounding boxes of all visible iframes on the page
      const visibleIframeBoxes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"))
          .map((el, i) => {
            const r = el.getBoundingClientRect();
            return { i, x: r.x, y: r.y, w: r.width, h: r.height };
          })
          .filter(b => b.w > 0 && b.h > 0 && b.h < 120) // card fields are short (<120px tall)
          .sort((a, b) => a.y - b.y); // sort top→bottom
      }).catch(() => [] as Array<{ i: number; x: number; y: number; w: number; h: number }>);

      trace(`CKO visible iframes: ${visibleIframeBoxes.length} short iframes found`);
      for (const b of visibleIframeBoxes.slice(0, 6)) {
        trace(`  iframe[${b.i}] x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} w=${b.w.toFixed(0)} h=${b.h.toFixed(0)}`);
      }

      // Assign values to iframes by vertical position.
      // Typical CKO layout (top to bottom): cardholder name, card number, expiry+CVV
      const cardFields: Array<{ value: string; key: keyof typeof checkoutComFrameFilled }> = [];
      if (!checkoutComFrameFilled.name && profile.card_name)
        cardFields.push({ value: profile.card_name, key: "name" });
      if (!checkoutComFrameFilled.number && profile.card_number)
        cardFields.push({ value: profile.card_number, key: "number" });
      if (!checkoutComFrameFilled.expiry && profile.card_expiry)
        cardFields.push({ value: profile.card_expiry, key: "expiry" });

      for (let i = 0; i < Math.min(cardFields.length, visibleIframeBoxes.length); i++) {
        const box = visibleIframeBoxes[i];
        const field = cardFields[i];
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        try {
          // Use page.click(x,y) — Stagehand page is a CDP wrapper, not Playwright.
          // page.mouse is undefined on Stagehand pages; page.click(x,y) dispatches CDP mouse events directly.
          await (page as unknown as { click: (x: number, y: number) => Promise<void> }).click(cx, cy);
          await new Promise(r => setTimeout(r, 300));
          // Select all + type — Stagehand page has page.keyboard (like Playwright)
          await page.keyboard.press("Control+a");
          await new Promise(r => setTimeout(r, 100));
          await page.keyboard.type(field.value, { delay: 50 });
          await new Promise(r => setTimeout(r, 200));
          checkoutComFrameFilled[field.key] = true;
          trace(`CKO visible iframe[${box.i}]: ${field.key} filled via page.click(${cx.toFixed(0)},${cy.toFixed(0)}) + keyboard`);
        } catch (err) {
          trace(`CKO visible iframe[${box.i}]: ${field.key} error — ${(err as Error).message?.slice(0, 50)}`);
        }
      }
    } catch (visErr) {
      trace(`CKO visible iframe scan error: ${(visErr as Error).message?.slice(0, 60)}`);
    }
  }

  // ── Strategy 3: placeholder-parent click → keyboard ───────────────────────
  // Walk up DOM from each hidden placeholder until we find a parent with visible
  // bounding box. Click its center — the overlying CKO iframe should receive the
  // focus and keyboard.type() then types into the iframe.
  const needsParentClimbFill = !checkoutComFrameFilled.number || !checkoutComFrameFilled.expiry;
  if (needsParentClimbFill) {
    const parentCoords = await page.evaluate(() => {
      const walk = (startId: string): { x: number; y: number } | null => {
        let el: HTMLElement | null = document.getElementById(startId);
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 120) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
          el = el.parentElement;
        }
        return null;
      };
      return {
        name: walk("chn-input-placeholder"),
        number: walk("pan-input-placeholder"),
        expiry: walk("expiry-input-placeholder"),
      };
    }).catch(() => ({ name: null, number: null, expiry: null }));

    trace(`CKO parent-climb coords: name=${JSON.stringify(parentCoords.name)}, number=${JSON.stringify(parentCoords.number)}, expiry=${JSON.stringify(parentCoords.expiry)}`);

    const parentFillPairs: Array<[typeof parentCoords.name, string, keyof typeof checkoutComFrameFilled]> = [
      [parentCoords.name, profile.card_name ?? "", "name"],
      [parentCoords.number, profile.card_number ?? "", "number"],
      [parentCoords.expiry, profile.card_expiry ?? "", "expiry"],
    ];
    for (const [coord, value, key] of parentFillPairs) {
      if (checkoutComFrameFilled[key] || !coord || !value) continue;
      try {
        await (page as unknown as { click: (x: number, y: number) => Promise<void> }).click(coord.x, coord.y);
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.press("Control+a");
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.type(value, { delay: 50 });
        await new Promise(r => setTimeout(r, 200));
        checkoutComFrameFilled[key] = true;
        trace(`CKO parent-climb: ${key} filled via page.click(${coord.x.toFixed(0)},${coord.y.toFixed(0)}) + keyboard`);
      } catch (err) {
        trace(`CKO parent-climb: ${key} error — ${(err as Error).message?.slice(0, 50)}`);
      }
    }
  }

  // Only run the heavy iframe scan + inline fallback if CKO strategies didn't fill everything
  const skipIframeScanning = checkoutComFrameFilled.name && checkoutComFrameFilled.number && checkoutComFrameFilled.expiry;

  // Wait for payment widget iframes to load (Checkout.com iframes appear with the page).
  // If already loaded (>15 frames present), skip polling. Otherwise poll up to 2s.
  const iframesBefore = page.frames().length;
  if (!skipIframeScanning) {
    trace(`Expedia card: checking payment widget iframes (currently ${iframesBefore} frame(s))...`);
    if (iframesBefore < 15) {
      // Payment widget not yet loaded — poll briefly
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 500));
        const now = page.frames().length;
        if (now > iframesBefore) {
          trace(`Expedia card: new iframe(s) detected (${iframesBefore} → ${now}) — settling 800ms`);
          await new Promise(r => setTimeout(r, 800));
          break;
        }
      }
    } else {
      trace("Expedia card: payment widget already loaded — proceeding immediately");
    }
  }

  // Dismiss modal one final time right before card fill — it may have reappeared
  // after protection-plan selection or "Card" tab click.
  await dismissExpediaAlmostYoursModal(page, trace, 300);

  // Merge CKO results with iframe scan result (pass empty strings for already-filled fields)
  let iframeFilledFields = checkoutComFrameFilled;
  if (!skipIframeScanning) {
    const iframeResult = await fillCardFieldsInPaymentIframes(
      page,
      checkoutComFrameFilled.name ? "" : (profile.card_name ?? ""),
      checkoutComFrameFilled.number ? "" : (profile.card_number ?? ""),
      checkoutComFrameFilled.expiry ? "" : (profile.card_expiry ?? ""),
      trace
    );
    // Merge: a field is filled if either CKO or iframe scan succeeded
    iframeFilledFields = {
      name: checkoutComFrameFilled.name || iframeResult.name,
      number: checkoutComFrameFilled.number || iframeResult.number,
      expiry: checkoutComFrameFilled.expiry || iframeResult.expiry,
    };
  }

  // For each field NOT filled by the iframe strategy, attempt inline fill.
  // If the field is in an iframe, page.locator() returns count=0 → no-op (safe).
  // If the field is inline (Hotels.com or non-Checkout.com forms), this fills it.
  if (!iframeFilledFields.name && profile.card_name) {
    trace("Expedia payment: card name not filled via iframe — trying inline selector");
    await findAndFillExpediaField(page,
      ["Name on card", "Cardholder name", "Card holder name"],
      EXPEDIA_GROUP_CARD_NAME_SELECTORS, profile.card_name, "cardholder name", trace);
  }

  // ── Inline card number + expiry: use page.evaluate() with strict placeholder selectors ──
  // Why: findAndFillExpediaField() can fill the WRONG field — e.g. the expiry field gets
  // the card number value ("8888888888888888" → masked as "88/88") because CSS selectors
  // are too broad. Using placeholder="0000 0000 0000 0000" and placeholder="MM/YY" is
  // unambiguous: each placeholder is unique to exactly one field in the form.
  // This runs BEFORE the locator fallback; the locator fallback runs only if this fails.
  const nativeFillInline = async (sel: string, val: string, fieldLabel: string): Promise<boolean> => {
    const ok = await page.evaluate(({ selector, value }: { selector: string; value: string }) => {
      const el = document.querySelector<HTMLInputElement>(selector);
      if (!el || el.disabled || el.offsetParent === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      el.focus();
      if (setter) { setter.call(el, ""); setter.call(el, value); }
      else { el.value = ""; el.value = value; }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    }, { selector: sel, value: val }).catch(() => false);
    if (ok) trace(`Expedia payment: filled ${fieldLabel} via page.evaluate placeholder selector`);
    return ok;
  };

  if (!iframeFilledFields.number && profile.card_number) {
    trace("Expedia payment: card number not filled via iframe — trying inline selector");
    // First: precise placeholder-based evaluate fill (Hotels.com inline form)
    const numOk = await nativeFillInline('input[placeholder="0000 0000 0000 0000"]', profile.card_number, "card number");
    if (!numOk) {
      // Fallback: locator-based fill (Expedia or other forms)
      await findAndFillExpediaField(page,
        ["Card number", "Credit card number"],
        EXPEDIA_GROUP_CARD_NUMBER_SELECTORS, profile.card_number, "card number", trace, true);
    }
  }
  if (!iframeFilledFields.expiry && profile.card_expiry) {
    trace("Expedia payment: card expiry not filled via iframe — trying inline selector");
    // First: precise placeholder-based evaluate fill (Hotels.com inline form)
    const expOk = await nativeFillInline('input[placeholder="MM/YY"]', profile.card_expiry, "expiry date");
    if (!expOk) {
      // Fallback: locator-based fill
      await findAndFillExpediaField(page,
        ["Expiration date", "Expiry date", "Expiry"],
        EXPEDIA_GROUP_CARD_EXPIRY_SELECTORS, profile.card_expiry, "expiry date", trace);
    }
  }

  // "This booking is almost yours!" modal appears AFTER card fields are filled.
  // Dismiss it now before attempting billing ZIP fill.
  await dismissExpediaAlmostYoursModal(page, trace, 400);

  // Fill billing ZIP code via page.evaluate + native setter.
  // Uses the same technique as guest form filling (which we know works on Stagehand proxy).
  // locator.evaluate() is not available on Stagehand proxy, so we must use page.evaluate()
  // with document.querySelector to trigger React's state update.
  const billingZip = profile.billing_zip ?? profile.zip;
  if (billingZip) {
    const zipFilled = await page.evaluate(({ zip, selectors }: { zip: string; selectors: string[] }) => {
      const nativeFill = (el: HTMLInputElement, v: string): boolean => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        el.focus();
        if (setter) { setter.call(el, ""); setter.call(el, v); }
        else { el.value = ""; el.value = v; }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
        return el.value === v;
      };
      // Try each selector
      for (const sel of selectors) {
        const el = document.querySelector<HTMLInputElement>(sel);
        if (el && el.offsetParent !== null && !el.disabled) {
          return nativeFill(el, zip);
        }
      }
      // Fallback: find by label text
      const labels = Array.from(document.querySelectorAll<HTMLLabelElement>("label"));
      for (const lbl of labels) {
        const text = lbl.textContent?.toLowerCase() ?? "";
        if (!text.includes("zip") && !text.includes("postal")) continue;
        const forId = lbl.getAttribute("for");
        const input = forId ? document.getElementById(forId) as HTMLInputElement :
          lbl.querySelector("input") as HTMLInputElement;
        if (input && input.offsetParent !== null) return nativeFill(input, zip);
      }
      return false;
    }, { zip: billingZip, selectors: EXPEDIA_BILLING_ZIP_SELECTORS }).catch(() => false);

    if (zipFilled) {
      trace(`Expedia payment: filled billing ZIP "${billingZip}" via page.evaluate`);
    } else {
      trace("Expedia payment: billing ZIP page.evaluate failed — trying locator fallback");
      await findAndFillExpediaField(page,
        ["Billing ZIP code", "ZIP code", "Postal code"],
        EXPEDIA_BILLING_ZIP_SELECTORS, billingZip, "billing ZIP", trace, true);
    }
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
    // Also check iframes (including cross-origin payment processor frames)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const rawUrl: unknown = frame.url;
      const frameUrl = (typeof rawUrl === "function" ? (rawUrl as () => string)() : (rawUrl as string) ?? "").toLowerCase();
      if (!frameUrl || frameUrl === "about:blank") continue;
      for (const sel of selectors) {
        const val = await frame.evaluate((s) => {
          const el = document.querySelector<HTMLInputElement>(s);
          return el ? el.value : null;
        }, sel).catch(() => null);
        if (val !== null) {
          trace(`Expedia payment verify (iframe ${frameUrl.slice(0, 40)}): ${fieldName} = "${val.length > 0 ? "[filled]" : "[empty]"}"`);
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
    const lower = url.toLowerCase();
    return lower.includes("expedia.com") && !lower.includes("hotels.com");
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

    // Guest details step: on checkout and guest info fields are visible
    // NOTE: some Expedia hotels combine guest + payment on /checkout/session (single-page checkout)
    const guestDetailsStep = isCheckout && await page.evaluate(() => {
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
