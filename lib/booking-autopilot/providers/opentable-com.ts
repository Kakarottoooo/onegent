import type { Page } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, PaymentFillResult, ProviderStageSignals } from "./types";
import { fillGuestFormWithAI, auditAndRefillEmptyFields } from "../ai-loop/fill-form";
import { buildEffectiveProfile } from "../core/profile";
import type { BookingProfile } from "../types";
import { shouldStopForDryRun, DRY_RUN_BOUNDARY_MARKER } from "../dry-run";

interface OpenTableProfile {
  full_name?: string;
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

type OpenTableDinerField = "firstName" | "lastName" | "email" | "phone";

interface OpenTableDinerFormState {
  present: OpenTableDinerField[];
  filled: OpenTableDinerField[];
  empty: OpenTableDinerField[];
  verificationGate: boolean;
  submitVisible: boolean;
}

async function fillOpenTableFieldFallback(
  page: Page,
  field: OpenTableDinerField,
  value: string,
): Promise<boolean> {
  if (!value) return false;
  return page.evaluate(
    ({ field, value }: { field: OpenTableDinerField; value: string }) => {
      const nativeFill = (el: HTMLInputElement, val: string): boolean => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        el.scrollIntoView({ block: "center", inline: "center" });
        el.focus();
        if (setter) {
          setter.call(el, "");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          setter.call(el, val);
        } else {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.value = val;
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: val }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        el.blur();
        const actual = el.value.trim();
        return field === "phone" ? actual.replace(/\D/g, "").length >= 10 : actual.length > 0;
      };
      const isShown = (el: HTMLElement): boolean => {
        if (el.hidden || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const labelText = (el: HTMLInputElement): string => {
        const labels = Array.from(el.labels ?? []).map((label) => label.textContent ?? "");
        const closestText = el.closest("label, div, li, section")?.textContent ?? "";
        return [...labels, closestText].join(" ");
      };
      const classify = (el: HTMLInputElement): OpenTableDinerField | null => {
        const haystack = [
          el.type,
          el.placeholder,
          el.getAttribute("aria-label"),
          el.id,
          el.name,
          el.autocomplete,
          el.getAttribute("inputmode"),
          labelText(el),
        ].join(" ").toLowerCase();
        if (haystack.includes("country") || haystack.includes("code")) return null;
        if (haystack.includes("first") || haystack.includes("given-name")) return "firstName";
        if (haystack.includes("last") || haystack.includes("family-name")) return "lastName";
        if (el.type === "email" || haystack.includes("email")) return "email";
        if (
          el.type === "tel" ||
          haystack.includes("phone") ||
          haystack.includes("mobile") ||
          haystack.includes("telephone") ||
          haystack.includes("tel")
        ) {
          return "phone";
        }
        return null;
      };
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter((el) => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && isShown(el));
      const target = inputs.find((el) => classify(el) === field);
      return target ? nativeFill(target, value) : false;
    },
    { field, value },
  ).catch(() => false);
}

async function readOpenTableDinerFormState(page: Page): Promise<OpenTableDinerFormState> {
  return page.evaluate(() => {
    type Field = "firstName" | "lastName" | "email" | "phone";
    const isShown = (el: HTMLElement): boolean => {
      if (el.hidden || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const classify = (el: HTMLInputElement): Field | null => {
      const haystack = [
        el.type,
        el.placeholder,
        el.getAttribute("aria-label"),
        el.id,
        el.name,
        el.autocomplete,
      ].join(" ").toLowerCase();
      if (haystack.includes("country") || haystack.includes("code")) return null;
      if (haystack.includes("first") || haystack.includes("given-name")) return "firstName";
      if (haystack.includes("last") || haystack.includes("family-name")) return "lastName";
      if (el.type === "email" || haystack.includes("email")) return "email";
      if (el.type === "tel" || haystack.includes("phone") || haystack.includes("tel")) return "phone";
      return null;
    };

    const present = new Set<Field>();
    const filled = new Set<Field>();
    const empty = new Set<Field>();
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .filter((el) => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && isShown(el));

    for (const input of inputs) {
      const field = classify(input);
      if (!field) continue;
      present.add(field);
      if (input.value.trim().length > 0) filled.add(field);
      else empty.add(field);
    }

    const text = (document.body?.innerText ?? "").toLowerCase();
    const verificationGate =
      text.includes("verify your account") ||
      text.includes("verification code") ||
      text.includes("receive a text message") ||
      text.includes("receive an email message");
    const submitVisible = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"], button'))
      .some((button) => isShown(button) && /complete reservation|confirm reservation|reserve now|book now/i.test((button.textContent ?? "").trim()));

    return {
      present: Array.from(present),
      filled: Array.from(filled),
      empty: Array.from(empty),
      verificationGate,
      submitVisible,
    };
  }).catch(() => ({
    present: [],
    filled: [],
    empty: ["email"],
    verificationGate: false,
    submitVisible: false,
  }));
}

/**
 * Auto-advance OpenTable's `/booking/seating-options` and `/booking/specials`
 * intermediate pages to the real `/booking/details` guest-form page.
 *
 * Used by:
 *   - fillGuestForm (legacy entry — kept for callers that arrive directly)
 *   - stagehand-executor's recovery-loop intermediate_gate hook (so the
 *     executor can advance OT intermediates even when stage-assessment
 *     never routes into fillGuestForm — see B1 fix in stage-assessment.ts).
 *
 * Returns advanced=true when the URL has left both intermediate paths.
 * Caller is expected to re-run stage assessment after a true return.
 */
export async function runOpenTableIntermediatePreflight(
  rawPage: Page,
  trace: (msg: string) => void
): Promise<{ advanced: boolean; finalUrl: string; reason: string }> {
  for (let preflightStep = 0; preflightStep < 2; preflightStep += 1) {
    const url = (rawPage.url() ?? "").toLowerCase();

    // ── DOM-based seating-options detection (URL-independent) ──────────────
    // OT now sometimes renders the seating-options modal inline on the
    // venue detail page (vanity URLs like /wild-west-village) WITHOUT
    // navigating to /booking/seating-options. Without DOM detection the
    // URL-only check below misses this case entirely and the executor
    // loops on listing → reserve click → no progress. User screenshot
    // (run 10 case 002): "Available seating options" modal with Standard/
    // Outdoor Select buttons on /wild-west-village.
    const seatingModalAdvanced = await rawPage.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        if (!(el as HTMLElement).isConnected) return false;
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el as HTMLElement);
        return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
      };
      // Locate the seating-options heading. Match anchored phrase to avoid
      // false positives in cancellation policy / footer copy.
      const headings = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, [role='heading']"))
        .filter((el) => isVisible(el));
      const seatingHeading = headings.find((h) =>
        /^\s*available seating options?\s*$/i.test((h.textContent ?? "").trim())
      );
      if (!seatingHeading) return null;
      // Within the modal/section containing this heading, find Select buttons
      // adjacent to a "Standard" label (preferred) — fall back to first.
      const modal = seatingHeading.closest(
        "[role='dialog'], [class*='modal' i], [class*='Modal'], section, div"
      ) ?? document;
      const selectBtns = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"))
        .filter((b) => isVisible(b) && /^\s*select\s*$/i.test((b.textContent ?? "").trim()));
      // Iterate select buttons and prefer the row whose nearest text ancestor
      // contains "standard"; never auto-pick a row containing "$" (paid).
      for (const b of selectBtns) {
        const row = b.closest("li, tr, [class*='row' i], [class*='option' i], div") ?? b.parentElement;
        const rowText = (row?.textContent ?? "").toLowerCase();
        if (/\$\d/.test(rowText)) continue;
        if (rowText.includes("standard")) {
          b.click();
          return "Standard (DOM modal)";
        }
      }
      // Fallback: first non-paid Select.
      for (const b of selectBtns) {
        const row = b.closest("li, tr, [class*='row' i], [class*='option' i], div") ?? b.parentElement;
        const rowText = (row?.textContent ?? "").toLowerCase();
        if (/\$\d/.test(rowText)) continue;
        b.click();
        const label = row?.querySelector("h3, h4, p, strong, span")?.textContent?.trim().slice(0, 30) ?? "first option";
        return `${label} (DOM modal)`;
      }
      return null;
    }).catch(() => null);
    if (seatingModalAdvanced) {
      trace(`[opentable] preflight ${preflightStep + 1}: DOM modal handled — clicked "${seatingModalAdvanced}"`);
      await rawPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));
      continue; // re-check on the next iteration (URL may now be /booking/details)
    }

    if (url.includes("/booking/seating-options")) {
      trace(`[opentable] preflight ${preflightStep + 1}: seating-options page — auto-selecting Standard`);
      const picked = await rawPage.evaluate(() => {
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const selectBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .filter((b) => isVisible(b) && /^\s*select\s*$/i.test((b.textContent ?? "").trim()));
        for (const b of selectBtns) {
          const section = b.closest("section, [class*='section'], div, li");
          const sectionText = (section?.textContent ?? "").toLowerCase();
          if (sectionText.includes("standard")) {
            b.click();
            return "Standard";
          }
        }
        if (selectBtns[0]) {
          selectBtns[0].click();
          const section = selectBtns[0].closest("section, [class*='section'], div, li");
          const label =
            section?.querySelector("h3, h4, p, span, strong")?.textContent?.trim().slice(0, 30) ?? "first option";
          return label;
        }
        return null;
      }).catch(() => null);
      if (picked) {
        trace(`[opentable] preflight: clicked seating "${picked}" — waiting for navigation`);
        await rawPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      trace(`[opentable] preflight: no Select button found on seating-options page`);
      break;
    }
    if (url.includes("/booking/specials")) {
      trace(`[opentable] preflight ${preflightStep + 1}: specials page — looking for standard/skip/continue`);
      const picked = await rawPage.evaluate(() => {
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        // ── Priority 1: "Standard Reservation" card → Select button ─────
        // Tao Downtown / Le Bernardin / Carbone-tier venues offer 2-3 paid
        // upgrade specials ("$98 Veuve Cliquot", "$60 Espresso Martini")
        // alongside the free "Standard Reservation" option. Find the card
        // whose heading text mentions "Standard Reservation" and click its
        // own Select button. Run 14 case 010 (Tao) hit this — the agent
        // looped on "Skip to main content" (a11y link, not a continue
        // action) for 3+ minutes because the old skipPatterns regex
        // matched "skip" first.
        const allSelectBtns = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).filter(
          (b) => isVisible(b) && /^\s*select\s*$/i.test((b.textContent ?? "").trim()),
        );
        for (const btn of allSelectBtns) {
          const card = btn.closest("section, article, [class*='card'], [class*='Section'], li, div");
          if (!card) continue;
          const cardText = (card.textContent ?? "").toLowerCase();
          if (/standard\s+reservation/i.test(cardText)) {
            btn.click();
            return `standard-select`;
          }
        }
        // Fallback: a Select button in a card that has no $-price (i.e. free
        // / no add-on tier). Distinguishes from paid upgrade cards.
        for (const btn of allSelectBtns) {
          const card = btn.closest("section, article, [class*='card'], [class*='Section'], li, div");
          if (!card) continue;
          const cardText = (card.textContent ?? "").toLowerCase();
          if (
            /no add-?on|no special|free|complimentary/i.test(cardText) &&
            !/\$\d/.test(cardText)
          ) {
            btn.click();
            return `no-addon-select`;
          }
        }

        // ── Priority 2: explicit "No thanks / Continue without / Maybe later" ──
        // These are real continue-without-extras buttons. EXCLUDE "Skip to
        // main content" — that's an a11y skip-link, not a flow action,
        // clicking it does nothing for the booking step.
        const explicitSkipPatterns =
          /^(\s*no\s*thanks\s*|\s*continue\s*without[^$]*|\s*maybe\s*later\s*|\s*skip\s+(?:this|extras|add-?ons)\s*)$/i;
        const skipEl = Array.from(document.querySelectorAll<HTMLElement>("a, button"))
          .filter((b) => isVisible(b))
          .find((b) => {
            const t = (b.textContent ?? "").trim();
            // Hard-exclude the a11y skip-to-content link by exact text or
            // common id/class patterns.
            if (/skip\s+to\s+(main\s+)?content/i.test(t)) return false;
            if (b.id?.toLowerCase().includes("skip-to-content")) return false;
            if ((b.className?.toLowerCase() ?? "").includes("skip-link")) return false;
            return explicitSkipPatterns.test(t);
          });
        if (skipEl) {
          skipEl.click();
          return `skip:${(skipEl.textContent ?? "").trim().slice(0, 40)}`;
        }

        return null;
      }).catch(() => null);
      if (picked) {
        trace(`[opentable] preflight: handled specials via "${picked}" — waiting for navigation`);
        await rawPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      trace(`[opentable] preflight: specials page has only paid add-ons — leaving for boundary`);
      break;
    }
    break;
  }
  const finalUrl = (rawPage.url() ?? "").toLowerCase();
  // Still stuck on a /booking/{seating-options,specials} URL → not advanced.
  if (
    finalUrl.includes("/booking/seating-options") ||
    finalUrl.includes("/booking/specials")
  ) {
    return { advanced: false, finalUrl, reason: "still on intermediate URL" };
  }
  // Modal might still be open on a vanity URL (URL didn't navigate).
  // If the "Available seating options" modal text is still visible we
  // haven't actually advanced — the click missed or got intercepted.
  const modalStillOpen = await rawPage.evaluate(() => {
    const text = document.body?.innerText ?? "";
    return /available seating options?/i.test(text);
  }).catch(() => false);
  if (modalStillOpen) {
    return { advanced: false, finalUrl, reason: "seating-options modal still visible after click" };
  }
  return { advanced: true, finalUrl, reason: "advanced past intermediate gate" };
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
      .filter(el => {
        if (el.type === "hidden" || el.disabled) return false;
        // RC C fix: don't use offsetParent — it's null for fixed-position
        // modal inputs (OT renders the reservation modal with position:fixed,
        // so offsetParent-based visibility checks rejected every form field
        // and benchmark runs walked past payment_gate without filling
        // anything). Use bounding-rect + computed-style instead, which works
        // for modals AND normal flow.
        if (!el.isConnected || el.hidden) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      });
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
    const isBookingDetailsUrl =
      lowerUrl.includes("/booking/details") ||
      lowerUrl.includes("/booking/seating-options") ||
      lowerUrl.includes("/booking/experiences-details");
    const hasReservationForm = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      const visible = inputs.filter((el) => {
        if (el.type === "hidden" || el.disabled) return false;
        // Same RC C visibility fix as hasCreditCardSection: modal inputs
        // have offsetParent === null because they're position:fixed inside
        // a portal/dialog. Use rect + computed style so we actually find them.
        if (!el.isConnected || el.hidden) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      });
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
    const fullNameParts = (p.full_name ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = p.first_name ?? fullNameParts[0] ?? "";
    const lastName = p.last_name ?? fullNameParts.slice(1).join(" ");
    const email = p.email ?? "";
    // OT validates phone format strictly: plain "5555550100" gets rejected
    // with "Your phone number format is invalid". 10-digit US numbers must
    // be formatted as "(555) 555-0100". Strip to digits, drop a leading "1"
    // (country code lives in a separate +1 dropdown), then format. Run 12
    // case 016 (The Modern) hit this — guest form filled per our trace,
    // but the form bombed on submit.
    const rawDigits = (p.phone ?? "").replace(/\D/g, "");
    const tenDigit = rawDigits.length === 11 && rawDigits.startsWith("1")
      ? rawDigits.slice(1)
      : rawDigits.slice(-10);
    const phoneDigits = tenDigit.length === 10
      ? `(${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`
      : rawDigits; // non-US / unexpected length — fall back to raw digits
    trace(
      `[opentable] guest fill profile input: first=${firstName.length > 0} ` +
      `last=${lastName.length > 0} email=${email.length > 0} phoneDigits=${rawDigits.length}`,
    );
    // Extract stagehand + rawPage from helpers (injected by executor)
    const h = helpers as { stagehand?: { act: (s: string) => Promise<unknown> }; rawPage?: Page } | null;
    const stagehand = h?.stagehand;
    const rawPage = h?.rawPage ?? page;

    // Preflight intermediate pages (seating-options / specials). Extracted
    // to runOpenTableIntermediatePreflight so the stagehand-executor's
    // intermediate_gate hook can call it too — see B1 fix.
    const preflight = await runOpenTableIntermediatePreflight(rawPage, trace);
    if (!preflight.advanced) {
      trace(`[opentable] preflight: still on intermediate page (${preflight.finalUrl.slice(0, 80)}) — aborting fillGuestForm`);
      throw new Error("opentable_intermediate_page_unhandled");
    }

    // Step 1: detect which form type is showing.
    // OpenTable unauthenticated flow shows a phone-only form first.
    // Clicking "Use email instead" reveals the full name/email form.
    const formType = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => {
        if (el.type === "hidden" || el.disabled) return false;
        // RC C fix: don't use offsetParent — it's null for fixed-position
        // modal inputs (OT renders the reservation modal with position:fixed,
        // so offsetParent-based visibility checks rejected every form field
        // and benchmark runs walked past payment_gate without filling
        // anything). Use bounding-rect + computed-style instead, which works
        // for modals AND normal flow.
        if (!el.isConnected || el.hidden) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      });
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

    // Step 2: if phone-only form, fill phone directly when possible.
    // OpenTable currently shows phone as the native verification gate. The
    // "Use email instead" branch is flaky in Chromium and left fields blank
    // in founder E2E, so only switch to email when we do not have a phone.
    if (formType.hasPhone && !formType.hasName && phoneDigits) {
      trace("[opentable] phone-only form detected - filling phone directly");
      const phoneFilled = await page.evaluate((phone: string) => {
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
        const isShown = (el: HTMLElement): boolean => {
          if (el.hidden || !el.isConnected) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };
        const phoneEl = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && !el.disabled && isShown(el))
          .find(el =>
            (el.placeholder || "").toLowerCase().includes("phone") ||
            (el.getAttribute("aria-label") || "").toLowerCase().includes("phone") ||
            el.type === "tel"
        );
        return phoneEl ? nativeFill(phoneEl, phone) : false;
      }, phoneDigits).catch(() => false);
      trace(`[opentable] phone-only direct fill result: ${phoneFilled}`);
    } else if (formType.hasPhone && !formType.hasName && formType.hasEmailLink) {
      trace("[opentable] phone-only form detected without usable phone - clicking 'Use email instead'");
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
        const isShown = (el: HTMLElement): boolean => {
          if (el.hidden || !el.isConnected) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && isShown(el));
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
      { first: firstName, last: lastName, email, phone: phoneDigits }
    ).catch((err: Error) => {
      trace(`[opentable] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[opentable] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone}`);

    const fallbackFilled: string[] = [];
    if (results.firstName !== true && await fillOpenTableFieldFallback(page, "firstName", firstName)) {
      fallbackFilled.push("firstName");
    }
    if (results.lastName !== true && await fillOpenTableFieldFallback(page, "lastName", lastName)) {
      fallbackFilled.push("lastName");
    }
    if (results.email !== true && await fillOpenTableFieldFallback(page, "email", email)) {
      fallbackFilled.push("email");
    }
    if (results.phone !== true && await fillOpenTableFieldFallback(page, "phone", phoneDigits)) {
      fallbackFilled.push("phone");
    }
    if (fallbackFilled.length > 0) {
      trace(`[opentable] locator fallback filled: ${fallbackFilled.join(",")}`);
    }

    let dinerFormState = await readOpenTableDinerFormState(page);

    // Step 4: AI fill for any fields the programmatic pass missed.
    if (stagehand) {
      if (dinerFormState.empty.length > 0) {
        trace(`[opentable] still-empty diner field(s) after programmatic fill: ${dinerFormState.empty.join(",")} - running AI fill`);
        const effectiveProfile = buildEffectiveProfile({ ...p, first_name: firstName, last_name: lastName, email } as BookingProfile, "");
        try {
          const aiResult = await fillGuestFormWithAI(stagehand, effectiveProfile, trace);
          trace(`[opentable] AI fill: filled=${aiResult.filled.join(",")} failed=${aiResult.failed.join(",")}`);
        } catch (e) {
          trace(`[opentable] AI fill error: ${(e as Error).message?.slice(0, 80)}`);
        }
      }
      // Step 5: audit - catch any still-empty fields.
      try {
        const effectiveProfile = buildEffectiveProfile({ ...p, first_name: firstName, last_name: lastName, email } as BookingProfile, "");
        const audit = await auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace);
        if (audit.refilled.length) trace(`[opentable] audit refilled: ${audit.refilled.join(",")}`);
      } catch (e) {
        trace(`[opentable] audit error: ${(e as Error).message?.slice(0, 80)}`);
      }
    }

    dinerFormState = await readOpenTableDinerFormState(page);
    trace(
      `[opentable] diner form state: present=${dinerFormState.present.join(",") || "none"} ` +
      `filled=${dinerFormState.filled.join(",") || "none"} empty=${dinerFormState.empty.join(",") || "none"} ` +
      `verificationGate=${dinerFormState.verificationGate} submitVisible=${dinerFormState.submitVisible}`,
    );
    if (dinerFormState.empty.length > 0) {
      throw new Error(`opentable_guest_form_incomplete:${dinerFormState.empty.join(",")}`);
    }

    // Step 6: stop before the final submit.
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

    trace("[opentable] final confirmation button left for user - submit click skipped by policy");
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
        const isShown = (el: HTMLElement): boolean => {
          if (el.hidden || !el.isConnected) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && isShown(el));

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
