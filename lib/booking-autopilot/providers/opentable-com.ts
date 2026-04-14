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

    // Guest details step: reservation form visible (first-name input present)
    const guestDetailsStep = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      const visible = inputs.filter(
        (el) => el.type !== "hidden" && !el.disabled && el.offsetParent !== null
      );
      return visible.some((el) => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        return (
          ph.includes("first") ||
          ph.includes("last") ||
          lbl.includes("first name") ||
          lbl.includes("last name")
        );
      });
    }).catch(() => false);

    return {
      searchResults,
      hotelDetail: restaurantDetail,   // reuse hotelDetail slot for restaurant detail page
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep: false,              // standard OpenTable reservations require no payment
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

    const results = await page.evaluate(
      ({
        first,
        last,
        email,
        phone,
      }: {
        first: string;
        last: string;
        email: string;
        phone: string;
      }) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )?.set;
          el.focus();
          if (setter) {
            setter.call(el, "");
            setter.call(el, val);
          } else {
            el.value = "";
            el.value = val;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          return el.value === val;
        };

        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>("input")
        ).filter(
          (el) =>
            el.type !== "hidden" &&
            el.type !== "checkbox" &&
            el.type !== "radio" &&
            !el.disabled &&
            el.offsetParent !== null
        );

        const res: Record<string, boolean | string> = {};

        // First name
        const firstEl = inputs.find((el) => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          const id = (el.id || "").toLowerCase();
          return (
            ph.includes("first") ||
            lbl.includes("first name") ||
            id.includes("first")
          );
        });
        res.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

        // Last name
        const lastEl = inputs.find((el) => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          const id = (el.id || "").toLowerCase();
          return (
            ph.includes("last") ||
            lbl.includes("last name") ||
            id.includes("last")
          );
        });
        res.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

        // Email
        const emailEl = inputs.find((el) => el.type === "email");
        res.email = emailEl ? nativeFill(emailEl, email) : "not_found";

        // Phone
        const phoneEl = inputs.find(
          (el) =>
            el.type === "tel" &&
            !el.id.toLowerCase().includes("country") &&
            !el.id.toLowerCase().includes("code")
        );
        res.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

        return res;
      },
      {
        first: p.first_name ?? "",
        last: p.last_name ?? "",
        email: p.email ?? "",
        phone: phoneDigits,
      }
    ).catch((err: Error) => {
      trace(`[opentable] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(
      `[opentable] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone}`
    );

    // Click the submit / "Complete reservation" button
    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern =
        /complete reservation|confirm reservation|reserve|find a time|book now/i;
      const btn = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button[type="submit"], button'
        )
      ).find((el) => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) {
        btn.click();
        return (btn.textContent ?? "").trim().slice(0, 40);
      }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[opentable] clicked submit button: "${submitted}"`);
    } else {
      trace("[opentable] submit button not found — may need manual confirmation");
    }
  },

  getBotPatterns(): string[] {
    return [];
  },
};

// Register with the global provider registry
registerProvider(openTableProvider);
