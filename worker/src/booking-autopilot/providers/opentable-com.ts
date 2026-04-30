import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, PaymentFillResult, ProviderStageSignals } from "./types";
import { fillGuestFormWithAI, auditAndRefillEmptyFields } from "../ai-loop/fill-form";
import { buildEffectiveProfile } from "../core/profile";
import type { BookingProfile } from "../types";
import { shouldStopForDryRun, DRY_RUN_BOUNDARY_MARKER } from "../dry-run";

interface OpenTableProfile {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
  billing_zip?: string;
  zip?: string;
}

/**
 * True when OpenTable's reservation form shows the "Credit card required"
 * section (high-end restaurants that ask for a deposit or guarantee card).
 * Detected by visible card-number / CVC / Zip / "Name on card" inputs, or
 * the "Credit card required" heading text.
 */
async function hasCreditCardSection(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
    const hasCardField = inputs.some(el => {
      const ph = (el.placeholder || "").toLowerCase();
      const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
      return /1234\s*1234\s*1234\s*1234/.test(ph) ||
        ph.includes("mm / yy") || ph.includes("mm/yy") ||
        ph === "cvc" || lbl === "cvc" ||
        ph.includes("name on card") || lbl.includes("name on card") ||
        ph.includes("zip code") || lbl.includes("zip code");
    });
    if (hasCardField) return true;
    const bodyText = document.body?.innerText?.toLowerCase() ?? "";
    return /credit card required|credit card is required/.test(bodyText);
  }).catch(() => false);
}

async function fillOpenTableCardNumberInFrames(
  page: Page,
  digits: string,
  trace: (msg: string) => void
): Promise<boolean> {
  const pageWithFrames = page as Page & { frames?: () => Array<{ evaluate: <T, A>(fn: (arg: A) => T, arg: A) => Promise<T>; url: () => string; name: () => string }> };
  const frames = typeof pageWithFrames.frames === "function" ? pageWithFrames.frames().slice(1) : [];
  trace(`[opentable-payment] frame scan: total=${frames.length}`);

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const frameName = frame.name?.() ?? "";
    const frameUrl = frame.url?.() ?? "";
    const result = await frame.evaluate((value: string) => {
      const normalize = (input: string) => input.toLowerCase().replace(/\s+/g, " ").trim();
      const isVisible = (element: Element | null): element is HTMLInputElement => {
        if (!(element instanceof HTMLInputElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return !element.disabled &&
          element.type !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden";
      };

      const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);
      const target = inputs.find((el) => {
        const ph = normalize(el.placeholder || "");
        const lbl = normalize(el.getAttribute("aria-label") || "");
        const name = normalize(el.getAttribute("name") || "");
        const id = normalize(el.id || "");
        const ac = normalize(el.autocomplete || "");
        return ac === "cc-number" ||
          ph.includes("1234 1234") ||
          ph.includes("card number") ||
          lbl.includes("card number") ||
          name.includes("cardnumber") ||
          id.includes("cardnumber");
      }) ?? (inputs.length === 1 ? inputs[0] : null);

      if (!target) {
        return { present: false, filled: false, valueLength: 0, hint: "" };
      }

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const setValue = (next: string) => {
        if (nativeSetter) nativeSetter.call(target, next);
        else target.value = next;
      };

      target.focus();
      setValue("");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));

      let current = "";
      for (const digit of value) {
        current += digit;
        setValue(current);
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }

      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.blur();

      const readBack = target.value ?? "";
      return {
        present: true,
        filled: readBack.replace(/\s+/g, "").length >= 12,
        valueLength: readBack.replace(/\s+/g, "").length,
        hint: `${target.placeholder || ""}|${target.getAttribute("aria-label") || ""}|${target.autocomplete || ""}`,
      };
    }, digits).catch((error: Error) => ({
      present: false,
      filled: false,
      valueLength: 0,
      hint: `error:${error.message}`,
    }));

    trace(`[opentable-payment] frame[${index}] name="${frameName}" url="${frameUrl.slice(0, 60)}" present=${result.present} filled=${result.filled} len=${result.valueLength} hint="${result.hint.slice(0, 80)}"`);
    if (result.filled) {
      return true;
    }
  }

  return false;
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

    // High-end restaurants gate reservations behind a "Credit card required"
    // section (deposit / no-show fee). Detect it so the executor can trigger
    // fillPaymentForm instead of blindly clicking "Complete reservation".
    const paymentStep = guestDetailsStep ? await hasCreditCardSection(page) : false;

    return {
      searchResults,
      hotelDetail: restaurantDetail,
      guestDetailsStep: guestDetailsStep as boolean,
      paymentStep,
    };
  },

  async fillGuestForm(
    page: Page,
    profile: unknown,
    helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    const p = profile as OpenTableProfile;
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");
    // Extract stagehand + rawPage from helpers (injected by executor)
    const h = helpers as { stagehand?: { act: (s: string) => Promise<unknown> }; rawPage?: Page } | null;
    const stagehand = h?.stagehand;
    const rawPage = h?.rawPage ?? page;

    // Step 1: detect which form type is showing.
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
      const emailLink = Array.from(document.querySelectorAll<HTMLElement>("a, button, span"))
        .find(el => /use email instead/i.test((el.textContent || "").trim()));
      return { hasPhone, hasName, hasEmail, hasEmailLink: !!emailLink };
    }).catch(() => ({ hasPhone: false, hasName: false, hasEmail: false, hasEmailLink: false }));

    trace(`[opentable] form type: phone=${formType.hasPhone} name=${formType.hasName} email=${formType.hasEmail} emailLink=${formType.hasEmailLink}`);

    // Step 2: if phone-only form, click "Use email instead" for guest checkout.
    if (formType.hasPhone && !formType.hasName && formType.hasEmailLink) {
      trace("[opentable] phone-only form detected - clicking 'Use email instead'");
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
      // Phone-only form without email link - just fill the phone field.
      trace("[opentable] phone-only form - filling phone directly");
      await page.evaluate((phone: string) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          return el.value.replace(/\D/g, "").length > 0;
        };
        const phoneEl = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null)
          .find(el =>
            (el.placeholder || "").toLowerCase().includes("phone") ||
            (el.getAttribute("aria-label") || "").toLowerCase().includes("phone") ||
            el.type === "tel"
          );
        return phoneEl ? nativeFill(phoneEl, phone) : false;
      }, phoneDigits).catch(() => false);
    }

    // Step 3: fill name / email / phone on the full form.
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
          !(el.id || "").toLowerCase().includes("country") &&
          !(el.id || "").toLowerCase().includes("code")
        );
        res.phone = phoneEl ? nativeFill(phoneEl, phone) : "not_found";

        return res;
      },
      { first: p.first_name ?? "", last: p.last_name ?? "", email: p.email ?? "", phone: phoneDigits }
    ).catch((err: Error) => {
      trace(`[opentable] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[opentable] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone}`);

    // Step 4: AI fill for any fields the programmatic pass missed.
    if (stagehand) {
      const missed = [results.firstName, results.lastName, results.email, results.phone].filter(v => v === "not_found" || v === false);
      if (missed.length > 0) {
        trace(`[opentable] ${missed.length} field(s) not found by programmatic fill - running AI fill`);
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        try {
          const aiResult = await fillGuestFormWithAI(stagehand, effectiveProfile, trace);
          trace(`[opentable] AI fill: filled=${aiResult.filled.join(",")} failed=${aiResult.failed.join(",")}`);
        } catch (e) {
          trace(`[opentable] AI fill error: ${(e as Error).message?.slice(0, 80)}`);
        }
      }
      // Step 5: audit - catch any still-empty fields.
      try {
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        const audit = await auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace);
        if (audit.refilled.length) trace(`[opentable] audit refilled: ${audit.refilled.join(",")}`);
      } catch (e) {
        trace(`[opentable] audit error: ${(e as Error).message?.slice(0, 80)}`);
      }
    }

    // Step 6: conditionally click submit.
    // If the restaurant requires a credit card (deposit / no-show guarantee),
    // DO NOT click "Complete reservation" here - the executor will call
    // fillPaymentForm next and leave the final submit to the user (after they
    // enter CVV). Clicking submit now would trigger client-side validation and
    // surface misleading red errors to the user.
    await new Promise(r => setTimeout(r, 800));
    const ccRequired = await hasCreditCardSection(page);
    if (ccRequired) {
      trace('[opentable] credit card section detected - skipping submit click (payment stage will handle it)');
      // For benchmark dry_run, also emit the boundary marker so the
      // classifier counts this as the dry_run end state (succeeded /
      // payment_stop), not executor_error. The payment stage will hand
      // off to the user regardless of dry_run flag.
      if (shouldStopForDryRun(helpers)) {
        trace(`[opentable] ${DRY_RUN_BOUNDARY_MARKER} - cc section reached, deposit-hold venue (benchmark_dry_run=true)`);
      }
      return;
    }

    // Benchmark dry_run boundary: if the caller flagged this run as dry_run,
    // stop before the reservation-committing click. Form is filled, button is
    // visible, but we never click — proves the full pipeline up to submit
    // without producing a real reservation.
    if (shouldStopForDryRun(helpers)) {
      trace(`[opentable] ${DRY_RUN_BOUNDARY_MARKER} - submit click skipped (benchmark_dry_run=true)`);
      return;
    }

    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /complete reservation|confirm reservation|reserve now|book now/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button[type=\"submit\"], button"))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) { btn.click(); return (btn.textContent ?? "").trim().slice(0, 40); }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[opentable] clicked submit button: "${submitted}"`);
    } else {
      trace("[opentable] submit button not found - may need manual confirmation");
    }
  },

  /**
   * Fill the "Credit card required" section on OpenTable's booking-details
   * page. Stops at CVV per the project's payment-safety rule - the user
   * enters CVV and clicks "Complete reservation" themselves.
   *
   * Also ticks the "I agree to the restaurant's terms and conditions"
   * checkbox, which is required before submit becomes active.
   */
  async fillPaymentForm(
    page: Page,
    profile: unknown,
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<PaymentFillResult | void> {
    const p = profile as OpenTableProfile;
    const zip = p.billing_zip ?? p.zip ?? "";

    if (!p.card_number && !p.card_name && !p.card_expiry) {
      trace("[opentable-payment] no card fields on profile - skipping (user will fill manually)");
      return;
    }

    // Scroll the card section into view so React keeps it mounted.
    await page.evaluate(() => {
      const anchor = Array.from(document.querySelectorAll<HTMLElement>("*"))
        .find(el => /credit card required/i.test((el.textContent ?? "").trim()));
      if (anchor) anchor.scrollIntoView({ block: "center" });
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));

    const filled = await page.evaluate(
      ({ cardName, cardNumber, cardExpiry, billingZip }: {
        cardName: string; cardNumber: string; cardExpiry: string; billingZip: string;
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
          return el.value.replace(/\s+/g, "").length > 0;
        };

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && el.offsetParent !== null);

        const match = (el: HTMLInputElement, needles: string[]): boolean => {
          const ph = (el.placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          const ac = (el.autocomplete || "").toLowerCase();
          return needles.some(n => ph.includes(n) || lbl.includes(n) || ac.includes(n));
        };

        const result = { name: false, number: false, expiry: false, zip: false };

        const nameEl = inputs.find(el =>
          match(el, ["name on card", "cardholder", "card name", "cc-name"])
        );
        if (nameEl) result.name = nativeFill(nameEl, cardName);

        const numberEl = inputs.find(el => {
          const ph = (el.placeholder || "").toLowerCase();
          const ac = (el.autocomplete || "").toLowerCase();
          return /1234\s*1234/.test(ph) ||
            ph.includes("card number") ||
            ac === "cc-number";
        });
        if (numberEl) result.number = nativeFill(numberEl, cardNumber);

        const expiryEl = inputs.find(el => {
          const ph = (el.placeholder || "").toLowerCase();
          const ac = (el.autocomplete || "").toLowerCase();
          return ph.includes("mm / yy") || ph.includes("mm/yy") || ph === "mm yy" || ac === "cc-exp";
        });
        if (expiryEl) result.expiry = nativeFill(expiryEl, cardExpiry);

        const zipEl = inputs.find(el => match(el, ["zip code", "zip", "postal"]));
        if (zipEl) result.zip = nativeFill(zipEl, billingZip);

        const agreeEl = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=\"checkbox\"]"))
          .find(el => {
            if (el.checked) return false;
            const container = el.closest("label, div, li, span");
            const text = (container?.textContent ?? "").toLowerCase();
            return text.includes("agree") && (text.includes("terms") || text.includes("conditions"));
          });
        let agreed = false;
        if (agreeEl) {
          agreeEl.click();
          agreed = agreeEl.checked;
        }

        return { ...result, agreed };
      },
      {
        cardName: p.card_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        cardNumber: p.card_number ?? "",
        cardExpiry: p.card_expiry ?? "",
        billingZip: zip,
      }
    ).catch((err: Error) => {
      trace(`[opentable-payment] evaluate failed: ${err.message?.slice(0, 80)}`);
      return { name: false, number: false, expiry: false, zip: false, agreed: false };
    });

    // Native setter fails on card-number on OpenTable (masked/controlled input
    // intercepts .value assignments). First try hosted payment iframes, then
    // fall back to main-document DOM-level sequential typing.
    if (!filled.number && p.card_number) {
      try {
        const frameFilled = await fillOpenTableCardNumberInFrames(page, p.card_number, trace);
        if (frameFilled) {
          filled.number = true;
          trace("[opentable-payment] typed card number fallback - filled via iframe scan");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace(`[opentable-payment] frame scan fallback failed: ${msg.slice(0, 120)}`);
      }
    }

    if (!filled.number && p.card_number) {
      try {
        const fallbackResult = await page.evaluate((digits) => {
          const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
          const isVisible = (element: Element | null): element is HTMLInputElement => {
            if (!(element instanceof HTMLInputElement)) return false;
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return !element.disabled &&
              element.type !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden";
          };

          const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible);
          const target = inputs.find((el) => {
            const ph = normalize(el.placeholder || "");
            const lbl = normalize(el.getAttribute("aria-label") || "");
            const name = normalize(el.getAttribute("name") || "");
            const id = normalize(el.id || "");
            const ac = normalize(el.autocomplete || "");
            return ac === "cc-number" ||
              ph.includes("1234 1234") ||
              ph.includes("card number") ||
              lbl.includes("card number") ||
              name.includes("cardnumber") ||
              id.includes("cardnumber");
          });

          if (!target) {
            return { ok: false, error: "card number input not found in DOM", value: "" };
          }

          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            const setValue = (value: string) => {
              if (nativeSetter) nativeSetter.call(target, value);
              else target.value = value;
            };

            target.focus();
            setValue("");
            target.dispatchEvent(new Event("input", { bubbles: true }));

            let current = "";
            for (const digit of digits) {
              current += digit;
              setValue(current);
              target.dispatchEvent(new Event("input", { bubbles: true }));
            }

            target.dispatchEvent(new Event("change", { bubbles: true }));
            target.blur();
            return { ok: true, error: "", value: target.value ?? "" };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              value: target.value ?? "",
            };
          }
        }, p.card_number);

        if (!fallbackResult.ok) {
          throw new Error(fallbackResult.error || "DOM sequential typing failed");
        }

        const readBack = fallbackResult.value ?? "";
        filled.number = readBack.replace(/\s+/g, "").length >= 12;
        trace(`[opentable-payment] typed card number fallback - readback length=${readBack.replace(/\s+/g, "").length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace(`[opentable-payment] typed card number fallback failed: ${msg.slice(0, 120)}`);
      }
    }

    trace(`[opentable-payment] filled: name=${filled.name} number=${filled.number} expiry=${filled.expiry} zip=${filled.zip} agreed=${filled.agreed} (CVV left for user)`);
    return filled;
  },

  getBotPatterns(): string[] {
    return [];
  },
};

registerProvider(openTableProvider);
