import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";

interface OpenTableProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export const openTableProvider: BrowserProvider = {
  id: "opentable-com",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("opentable.com");
  },

  async setup(): Promise<void> {
    // No-op: OpenTable doesn't need cookie injection or search-bar disabling
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lowerUrl = url.toLowerCase();

    // Search results: /s? with term= query param
    const searchResults =
      lowerUrl.includes("/s?") && lowerUrl.includes("term=");

    // Restaurant detail page: /r/<slug> or /restaurant/profile/<id>
    const restaurantDetail =
      /opentable\.com\/r\//.test(lowerUrl) ||
      lowerUrl.includes("/restaurant/profile/");

    // Guest details step:
    // 1. URL is the booking details page (opentable.com/booking/details?...)
    // 2. URL is the seating options page (opentable.com/booking/seating-options?...)
    // 3. OR reservation form is visible (first-name OR phone-number input present)
    const isBookingDetailsUrl = lowerUrl.includes("/booking/details") || lowerUrl.includes("/booking/seating-options");
    const hasReservationForm = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      const visible = inputs.filter(
        (el) => el.type !== "hidden" && !el.disabled && el.offsetParent !== null
      );
      return visible.some((el) => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        // Phone-only form (unauthenticated OpenTable)
        if (ph.includes("phone") || lbl.includes("phone")) return true;
        // Full name/email form
        if (ph.includes("first") || ph.includes("last") || el.type === "email") return true;
        if (lbl.includes("first name") || lbl.includes("last name")) return true;
        return false;
      });
    }).catch(() => false);

    const guestDetailsStep = isBookingDetailsUrl || hasReservationForm;

    return {
      searchResults,
      hotelDetail: restaurantDetail,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: false, // standard OpenTable reservations require no payment
    };
  },

  async fillGuestForm(
    page: Page,
    profile: unknown,
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    const p = profile as OpenTableProfile;
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");

    // ── Step 1: detect which form type is showing ─────────────────────────────
    // OpenTable unauthenticated flow shows a phone-only form first.
    // Clicking "Use email instead" reveals the full name/email form.
    const formType = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
      const hasPhone = inputs.some(el =>
        (el.placeholder || "").toLowerCase().includes("phone") ||
        (el.getAttribute("aria-label") || "").toLowerCase().includes("phone") ||
        el.type === "tel"
      );
      const hasName = inputs.some(el =>
        (el.placeholder || "").toLowerCase().includes("first") ||
        (el.placeholder || "").toLowerCase().includes("last")
      );
      const hasEmail = inputs.some(el => el.type === "email");
      // Check for "Use email instead" link
      const emailLink = Array.from(document.querySelectorAll<HTMLElement>("a, button, span"))
        .find(el => /use email instead/i.test((el.textContent || "").trim()));
      return { hasPhone, hasName, hasEmail, hasEmailLink: !!emailLink };
    }).catch(() => ({ hasPhone: false, hasName: false, hasEmail: false, hasEmailLink: false }));

    trace(`[opentable] form type: phone=${formType.hasPhone} name=${formType.hasName} email=${formType.hasEmail} emailLink=${formType.hasEmailLink}`);

    // ── Step 2: if phone-only form, click "Use email instead" for guest checkout ──
    if (formType.hasPhone && !formType.hasName && formType.hasEmailLink) {
      trace("[opentable] phone-only form detected — clicking 'Use email instead'");
      const clicked = await page.evaluate(() => {
        const link = Array.from(document.querySelectorAll<HTMLElement>("a, button, span"))
          .find(el => /use email instead/i.test((el.textContent || "").trim()));
        if (link) { link.click(); return true; }
        return false;
      }).catch(() => false);
      if (clicked) {
        await new Promise(r => setTimeout(r, 1500));
        trace("[opentable] switched to email form");
      }
    } else if (formType.hasPhone && !formType.hasName) {
      // Phone-only form without email link — just fill the phone field
      trace("[opentable] phone-only form — filling phone directly");
      await page.evaluate((phone: string) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          el.focus();
          if (setter) { setter.call(el, ''); setter.call(el, val); }
          else { el.value = ''; el.value = val; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          return el.value.replace(/\D/g, '').length > 0;
        };
        const phoneEl = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
          .filter(el => el.type !== 'hidden' && !el.disabled && el.offsetParent !== null)
          .find(el =>
            (el.placeholder || '').toLowerCase().includes('phone') ||
            (el.getAttribute('aria-label') || '').toLowerCase().includes('phone') ||
            el.type === 'tel'
          );
        return phoneEl ? nativeFill(phoneEl, phone) : false;
      }, phoneDigits).catch(() => false);
    }

    // ── Step 3: fill name / email / phone on the full form ────────────────────
    const results = await page.evaluate(
      ({ first, last, email, phone }: { first: string; last: string; email: string; phone: string }) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          el.focus();
          if (setter) { setter.call(el, ''); setter.call(el, val); }
          else { el.value = ''; el.value = val; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          return el.value === val;
        };

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
          .filter(el => el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio' && !el.disabled && el.offsetParent !== null);
        const res: Record<string, boolean | string> = {};

        const firstEl = inputs.find(el => {
          const ph = (el.placeholder || '').toLowerCase();
          const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
          return ph.includes('first') || lbl.includes('first name') || (el.id || '').toLowerCase().includes('first');
        });
        res.firstName = firstEl ? nativeFill(firstEl, first) : 'not_found';

        const lastEl = inputs.find(el => {
          const ph = (el.placeholder || '').toLowerCase();
          const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
          return ph.includes('last') || lbl.includes('last name') || (el.id || '').toLowerCase().includes('last');
        });
        res.lastName = lastEl ? nativeFill(lastEl, last) : 'not_found';

        const emailEl = inputs.find(el => el.type === 'email' || (el.placeholder || '').toLowerCase().includes('email'));
        res.email = emailEl ? nativeFill(emailEl, email) : 'not_found';

        const phoneEl = inputs.find(el =>
          (el.type === 'tel' || (el.placeholder || '').toLowerCase().includes('phone')) &&
          !(el.id || '').toLowerCase().includes('country') &&
          !(el.id || '').toLowerCase().includes('code')
        );
        res.phone = phoneEl ? nativeFill(phoneEl, phone) : 'not_found';

        return res;
      },
      { first: p.first_name ?? '', last: p.last_name ?? '', email: p.email ?? '', phone: phoneDigits }
    ).catch((err: Error) => {
      trace(`[opentable] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[opentable] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone}`);

    // ── Step 4: click the submit / "Complete reservation" button ─────────────
    // Wait briefly so the form can validate before we submit
    await new Promise(r => setTimeout(r, 800));
    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /complete reservation|confirm reservation|reserve now|book now/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"], button'))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? '').trim()));
      if (btn) { btn.click(); return (btn.textContent ?? '').trim().slice(0, 40); }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[opentable] clicked submit button: "${submitted}"`);
    } else {
      trace('[opentable] submit button not found — may need manual confirmation');
    }
  },

  getBotPatterns(): string[] {
    return [];
  },
};

// Register with the global provider registry
registerProvider(openTableProvider);
