import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";
import { fillGuestFormWithAI, auditAndRefillEmptyFields } from "../ai-loop/fill-form";
import { buildEffectiveProfile } from "../core/profile";
import type { BookingProfile } from "../types";

interface SeatGeekProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
}

export const seatgeekProvider: BrowserProvider = {
  id: "seatgeek-com",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("seatgeek.com");
  },

  async setup(page: Page, _context: unknown, trace: (msg: string) => void): Promise<void> {
    // Best-effort: dismiss the privacy/cookie banner that SeatGeek often shows
    // on first load. The buttons are generic ("Accept", "Got it").
    try {
      await page.evaluate(() => {
        const pattern = /accept|got it|agree|i understand/i;
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button"));
        for (const btn of btns) {
          const label = (btn.textContent ?? "").trim();
          if (!label) continue;
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (pattern.test(label)) {
            btn.click();
            break;
          }
        }
      });
    } catch (err) {
      trace(`[seatgeek] cookie dismiss skipped: ${(err as Error).message?.slice(0, 60)}`);
    }
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lower = url.toLowerCase();

    // Event listing page: /{slug}-tickets/... — has a ticket list in the sidebar.
    const eventPage =
      /seatgeek\.com\/[a-z0-9-]+-tickets\//.test(lower) ||
      /seatgeek\.com\/event\//.test(lower) ||
      /seatgeek\.com\/[a-z0-9-]+-tickets(\?|$)/.test(lower);

    // Checkout / buy step URLs.
    const isCheckoutUrl =
      lower.includes("/buy/") ||
      lower.includes("/checkout") ||
      lower.includes("/order");

    // Guest details: on a checkout-like URL with identity inputs visible.
    const guestDetailsStep = isCheckoutUrl && await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
      const hasName = inputs.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        const ac = (el.autocomplete || "").toLowerCase();
        return ph.includes("first") || ph.includes("last") ||
               lbl.includes("first") || lbl.includes("last") ||
               ac.includes("given-name") || ac.includes("family-name");
      });
      const hasEmail = inputs.some(el => el.type === "email" || (el.placeholder || "").toLowerCase().includes("email"));
      return hasName || hasEmail;
    }).catch(() => false);

    // Payment step: inline card number input visible.
    const paymentStep = isCheckoutUrl && await page.evaluate(() => {
      const cardSelectors = [
        'input[autocomplete="cc-number"]',
        'input[name*="cardNumber" i]',
        'input[id*="cardNumber" i]',
        'input[id*="card-number" i]',
        'input[placeholder*="card number" i]',
      ];
      for (const sel of cardSelectors) {
        const el = document.querySelector<HTMLInputElement>(sel);
        if (el && el.offsetParent !== null) return true;
      }
      return false;
    }).catch(() => false);

    return {
      searchResults: false,
      hotelDetail: eventPage,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: paymentStep as boolean,
    };
  },

  async fillGuestForm(
    page: Page,
    profile: unknown,
    helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    const p = profile as SeatGeekProfile;
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");
    const h = helpers as { stagehand?: { act: (s: string) => Promise<unknown> }; rawPage?: Page } | null;
    const stagehand = h?.stagehand;
    const rawPage = h?.rawPage ?? page;

    // ── Layer 1: programmatic native-setter fill ──────────────────────────────
    const results = await page.evaluate(
      ({ first, last, email, phone, zip, address, city, state }: {
        first: string; last: string; email: string; phone: string;
        zip: string; address: string; city: string; state: string;
      }) => {
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

        const matches = (el: HTMLInputElement, needles: string[]) => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          const id = (el.id || "").toLowerCase();
          const name = (el.name || "").toLowerCase();
          const ac = (el.autocomplete || "").toLowerCase();
          return needles.some(n => ph.includes(n) || lbl.includes(n) || id.includes(n) || name.includes(n) || ac.includes(n));
        };

        const res: Record<string, boolean | string> = {};

        const firstEl = inputs.find(el => matches(el, ["first", "given-name"]));
        res.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

        const lastEl = inputs.find(el => matches(el, ["last", "family-name", "surname"]));
        res.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

        const emailEl = inputs.find(el => el.type === "email" || matches(el, ["email"]));
        res.email = emailEl ? nativeFill(emailEl, email) : "not_found";

        const phoneEl = inputs.find(el =>
          (el.type === "tel" || matches(el, ["phone", "tel"])) &&
          !(el.id || "").toLowerCase().includes("country")
        );
        res.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

        const zipEl = inputs.find(el => matches(el, ["zip", "postal", "postcode"]));
        res.zip = zipEl ? nativeFill(zipEl, zip) : "not_found";

        const addressEl = inputs.find(el => matches(el, ["address1", "address-line1", "street"]));
        res.address = addressEl ? nativeFill(addressEl, address) : "not_found";

        const cityEl = inputs.find(el => matches(el, ["city", "address-level2"]));
        res.city = cityEl ? nativeFill(cityEl, city) : "not_found";

        const stateEl = inputs.find(el => matches(el, ["state", "region", "address-level1"]));
        res.state = stateEl ? nativeFill(stateEl, state) : "not_found";

        return res;
      },
      {
        first: p.first_name ?? "",
        last: p.last_name ?? "",
        email: p.email ?? "",
        phone: phoneDigits,
        zip: p.zip ?? "",
        address: p.address_line1 ?? "",
        city: p.city ?? "",
        state: p.state ?? "",
      }
    ).catch((err: Error) => {
      trace(`[seatgeek] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[seatgeek] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone} zip=${results.zip}`);

    // ── Layer 2: AI fill for missed fields ────────────────────────────────────
    if (stagehand) {
      const missed = [results.firstName, results.lastName, results.email, results.phone].filter(v => v === "not_found" || v === false);
      if (missed.length > 0) {
        trace(`[seatgeek] ${missed.length} field(s) missed — running AI fill`);
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        try {
          const aiResult = await fillGuestFormWithAI(stagehand, effectiveProfile, trace);
          trace(`[seatgeek] AI fill: filled=${aiResult.filled.join(",")} failed=${aiResult.failed.join(",")}`);
        } catch (e) { trace(`[seatgeek] AI fill error: ${(e as Error).message?.slice(0, 80)}`); }
      }
      // ── Layer 3: AI audit pass — re-fill anything still empty ──────────────
      try {
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        const audit = await auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace);
        if (audit.refilled.length) trace(`[seatgeek] audit refilled: ${audit.refilled.join(",")}`);
      } catch (e) { trace(`[seatgeek] audit error: ${(e as Error).message?.slice(0, 80)}`); }
    }

    // Click "Continue" / "Next" on the guest step — the user still reviews payment.
    await new Promise(r => setTimeout(r, 800));
    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /continue|next|proceed to payment/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"], button'))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) { btn.click(); return (btn.textContent ?? "").trim().slice(0, 40); }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[seatgeek] clicked continue: "${submitted}"`);
    } else {
      trace("[seatgeek] continue button not found — leaving form for user");
    }
  },

  async fillPaymentForm(
    page: Page,
    profile: unknown,
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    // Programmatic fill for card fields. Stop before CVV — the Payer must enter
    // that themselves per CLAUDE.md's three-layer architecture rules.
    const p = profile as SeatGeekProfile;
    const cardNumberDigits = (p.card_number ?? "").replace(/\D/g, "");
    const cardExpiry = p.card_expiry ?? "";
    const cardName = p.card_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    const zip = p.zip ?? "";

    const result = await page.evaluate(
      ({ name, number, expiry, zipCode }: { name: string; number: string; expiry: string; zipCode: string }) => {
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

        const pickInput = (needles: string[]): HTMLInputElement | null => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
            .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
          return inputs.find(el => {
            const ph = (el.placeholder || "").toLowerCase();
            const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
            const id = (el.id || "").toLowerCase();
            const nm = (el.name || "").toLowerCase();
            const ac = (el.autocomplete || "").toLowerCase();
            return needles.some(n => ph.includes(n) || lbl.includes(n) || id.includes(n) || nm.includes(n) || ac.includes(n));
          }) ?? null;
        };

        const out: Record<string, boolean | string> = {};
        const nameEl = pickInput(["cardholder", "card-name", "cc-name", "name on card"]);
        out.name = nameEl ? nativeFill(nameEl, name) : "not_found";

        const numEl = pickInput(["cardnumber", "card-number", "cc-number"]);
        out.number = numEl ? nativeFill(numEl, number) : "not_found";

        const expEl = pickInput(["cc-exp", "expiry", "expiration"]);
        out.expiry = expEl ? nativeFill(expEl, expiry) : "not_found";

        const zipEl = pickInput(["zip", "postal", "postcode"]);
        out.zip = zipEl ? nativeFill(zipEl, zipCode) : "not_found";

        return out;
      },
      { name: cardName, number: cardNumberDigits, expiry: cardExpiry, zipCode: zip }
    ).catch((err: Error) => {
      trace(`[seatgeek] payment form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[seatgeek] payment filled: name=${result.name} number=${result.number} expiry=${result.expiry} zip=${result.zip} (CVV left for user)`);
  },

  getBotPatterns(): string[] {
    return [
      "press and hold",
      "verify you are human",
      "please confirm you are human",
    ];
  },
};

registerProvider(seatgeekProvider);
