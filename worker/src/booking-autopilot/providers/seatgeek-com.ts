import type { Page } from "playwright";
import fs from "fs";
import path from "path";
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
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  card_name?: string;
  card_number?: string;
  card_expiry?: string;
}

// US states: SeatGeek's State dropdown uses full names (e.g. "California"),
// but our profile may carry either "CA" or "California". This table lets us
// normalise to a match. Matching is case-insensitive on both abbr and name.
const US_STATES: Array<{ abbr: string; name: string }> = [
  { abbr: "AL", name: "Alabama" },      { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" },      { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" },   { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" },  { abbr: "DE", name: "Delaware" },
  { abbr: "DC", name: "District of Columbia" },
  { abbr: "FL", name: "Florida" },      { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" },       { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" },     { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" },         { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" },     { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" },        { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" },{ abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" },    { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" },     { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" },     { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" },{ abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" },   { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" },{ abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" },         { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" },       { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" }, { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" }, { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" },        { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" },      { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" },   { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" },    { abbr: "WY", name: "Wyoming" },
];

function expandStateName(state: string): string[] {
  const s = (state ?? "").trim();
  if (!s) return [];
  const entry = US_STATES.find(
    r => r.abbr.toLowerCase() === s.toLowerCase() || r.name.toLowerCase() === s.toLowerCase()
  );
  if (!entry) return [s];
  return [entry.name, entry.abbr]; // try full name first (SG uses full names)
}

function expandCountryName(country: string): string[] {
  const s = (country ?? "").trim();
  if (!s) return [];
  const lower = s.toLowerCase();
  if (lower === "us" || lower === "usa" || lower === "united states" || lower === "united states of america") {
    return ["United States of America", "United States", "USA", "US"];
  }
  return [s];
}

/**
 * Parse card_expiry flexibly. Accepts:
 *   "MM/YY", "M/YY", "MM/YYYY", "M/YYYY"
 *   "MM-YY", "MM-YYYY"
 *   "MMYY"   (4 digits, no separator — e.g. "0130" → 01/2030)
 *   "MMYYYY" (6 digits, no separator — e.g. "012030" → 01/2030)
 */
function parseExpiry(expiry: string): { month: string; year: string } | null {
  const s = (expiry ?? "").trim();
  if (!s) return null;

  // With separator: / or -
  const sep = s.match(/^\s*(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})\s*$/);
  if (sep) {
    const month = sep[1].padStart(2, "0");
    let year = sep[2];
    if (year.length === 2) year = "20" + year;
    return { month, year };
  }

  // No separator, digits only.
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) {
    // MMYY
    const month = digits.slice(0, 2);
    const year = "20" + digits.slice(2, 4);
    if (parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) return { month, year };
  }
  if (digits.length === 6) {
    // MMYYYY
    const month = digits.slice(0, 2);
    const year = digits.slice(2, 6);
    if (parseInt(month, 10) >= 1 && parseInt(month, 10) <= 12) return { month, year };
  }
  return null;
}

export const seatgeekProvider: BrowserProvider = {
  id: "seatgeek-com",

  matchesUrl(url: string): boolean {
    return url.toLowerCase().includes("seatgeek.com");
  },

  async setup(page: Page, context: unknown, trace: (msg: string) => void): Promise<void> {
    // Inject saved SeatGeek session cookies if present. Run
    // `node scripts/save-seatgeek-cookies.mjs` once to capture them.
    // NOTE: When real-Chrome mode is active (USE_REAL_CHROME_FOR=seatgeek),
    // the persistent profile supplies cookies — the JSON file is optional.
    try {
      const cookiesPath = path.join(process.cwd(), ".seatgeek-cookies.json");
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf-8")) as unknown[];
        await (context as { addCookies: (c: unknown[]) => Promise<void> }).addCookies(cookies);
        trace(`[seatgeek] Injected ${cookies.length} session cookies from .seatgeek-cookies.json`);
      }
    } catch (err) {
      trace(`[seatgeek] Cookie injection failed: ${(err as Error).message?.slice(0, 100)}`);
    }

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

    // Payment step: inline card number input visible (the Add new card modal).
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

    // ── Layer 1: programmatic native-setter fill for text inputs ──────────────
    // Key guard: SG's DOM uses attribute names like `billing_address_first_name`
    // that match BOTH "first" and "address" needles. Without exclusion + dedup,
    // the address lookup wrongly overwrites First name. So we: (1) score each
    // input against positive + negative needles, (2) assign highest-scored
    // input to each field, (3) mark it used so later fields can't reuse it.
    const textResults = await page.evaluate(
      ({ first, last, email, phone, zip, address, city, apt }: {
        first: string; last: string; email: string; phone: string;
        zip: string; address: string; city: string; apt: string;
      }) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          // Capture success BEFORE dispatching events. The setter assignment
          // is synchronous, so el.value === val at this point proves the DOM
          // accepted our write. Libraries like Downshift (SG's address1 uses
          // it) mutate el.value on subsequent input/change events, which
          // caused false-negative "address=false" logs even though the field
          // was visually filled. Post-event checks are unreliable.
          const setOk = el.value === val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          return setOk;
        };

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && !el.disabled && el.offsetParent !== null);

        // Full attribute string of an input — all places SG might encode meaning.
        const attrs = (el: HTMLInputElement) => ([
          (el.placeholder || ""),
          (el.getAttribute("aria-label") || ""),
          (el.id || ""),
          (el.name || ""),
          (el.autocomplete || ""),
          (el.type || ""),
          (el.getAttribute("data-testid") || ""),
        ].join(" ")).toLowerCase();

        const used = new Set<HTMLInputElement>();

        // Pick the input with highest (positiveMatches - negativeMatches) score.
        // Requires at least one positive hit and score >= 1. Skips used inputs.
        const pick = (positives: string[], negatives: string[] = []): HTMLInputElement | null => {
          let best: HTMLInputElement | null = null;
          let bestScore = 0;
          for (const el of inputs) {
            if (used.has(el)) continue;
            const a = attrs(el);
            const posHits = positives.reduce((acc, n) => acc + (a.includes(n) ? 1 : 0), 0);
            if (posHits === 0) continue;
            const negHits = negatives.reduce((acc, n) => acc + (a.includes(n) ? 1 : 0), 0);
            const score = posHits - negHits;
            if (score > bestScore) { bestScore = score; best = el; }
          }
          if (best) used.add(best);
          return best;
        };

        // Diagnostics — log all candidate inputs so we can see SG's DOM shape.
        const diag = inputs.map((el, i) => `#${i} type=${el.type} ${attrs(el).trim().slice(0, 100)}`);

        const res: Record<string, string | boolean> = { _diag: diag.join(" || ") };

        // Order matters: more specific fields FIRST so they claim their inputs
        // before broader ones (address) try to grab them.
        const emailEl = inputs.find(el => !used.has(el) && (el.type === "email" || attrs(el).includes("email")));
        if (emailEl) { used.add(emailEl); res.email = nativeFill(emailEl, email); } else res.email = "not_found";

        const phoneEl = inputs.find(el => !used.has(el) &&
          (el.type === "tel" || attrs(el).includes("phone") || attrs(el).includes("tel")) &&
          !attrs(el).includes("country")
        );
        if (phoneEl) { used.add(phoneEl); res.phone = nativeFill(phoneEl, phone); } else res.phone = "not_found";

        // Name fields: exclude anything hinting at email/phone/address/etc.
        const nameNegatives = ["email", "phone", "tel", "address", "street", "city", "state", "zip", "postal", "country", "cardholder", "card", "cvv", "cvc"];
        const firstEl = pick(["first", "given-name", "forename"], [...nameNegatives, "last", "family", "surname"]);
        res.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";
        const lastEl = pick(["last", "family-name", "surname"], [...nameNegatives, "first", "given", "forename"]);
        res.lastName = lastEl ? nativeFill(lastEl, last) : "not_found";

        // Zip + city before address — both are "address_level*" so can eat address's slot.
        const zipEl = pick(["zip", "postal", "postcode"], ["address1", "address-line1", "street", "city", "state", "country"]);
        res.zip = zipEl ? nativeFill(zipEl, zip) : "not_found";
        const cityEl = pick(["city", "address-level2"], ["state", "country", "zip", "postal", "street", "address1", "address-line1"]);
        res.city = cityEl ? nativeFill(cityEl, city) : "not_found";

        // Apt / line2 before address1. apt is optional — if profile has no
        // address_line2, log "skipped" instead of "not_found" so it doesn't
        // look like a bug.
        const aptEl = pick(["address2", "address-line2", "apt", "suite", "unit"], ["city", "state", "zip", "country", "first", "last", "email", "phone"]);
        if (!apt) {
          res.apt = "skipped (optional)";
        } else if (aptEl) {
          res.apt = nativeFill(aptEl, apt);
        } else {
          res.apt = "not_found";
        }

        // Address LAST — now that everything else is claimed, "address" needle
        // can only hit the true street-address input. Exclude all other fields.
        const addressEl = pick(
          ["address1", "address-line1", "street", "address"],
          ["address2", "address-line2", "apt", "suite", "unit", "city", "state", "zip", "postal", "country", "first", "last", "given", "family", "email", "phone", "tel", "cardholder", "card"]
        );
        res.address = addressEl ? nativeFill(addressEl, address) : "not_found";

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
        apt: p.address_line2 ?? "",
      }
    ).catch((err: Error) => {
      trace(`[seatgeek] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[seatgeek] text fields: firstName=${textResults.firstName} lastName=${textResults.lastName} email=${textResults.email} phone=${textResults.phone} zip=${textResults.zip} address=${textResults.address} city=${textResults.city} apt=${textResults.apt}`);
    if (textResults._diag) {
      trace(`[seatgeek] input DOM diag: ${String(textResults._diag).slice(0, 500)}`);
    }

    // ── Layer 1b: State dropdown (native <select> OR custom combobox) ─────────
    const stateCandidates = expandStateName(p.state ?? "");
    if (stateCandidates.length > 0) {
      const stateResult = await selectDropdownByText(page, ["state", "region", "province", "address-level1"], stateCandidates, trace);
      trace(`[seatgeek] state dropdown: ${stateResult}`);
    }

    // ── Layer 1c: Country dropdown (default for US; often pre-filled) ─────────
    const countryCandidates = expandCountryName(p.country ?? "United States");
    if (countryCandidates.length > 0) {
      const countryResult = await selectDropdownByText(page, ["country"], countryCandidates, trace);
      trace(`[seatgeek] country dropdown: ${countryResult}`);
    }

    // ── Layer 1d: Close Downshift address autocomplete dropdown ───────────────
    // SG's address1 input uses Downshift. Our input/change event dispatch pops
    // the suggestion list open, and blur() doesn't reliably close it. The open
    // list overlaps the card/CVV fields below, blocking the user's manual
    // entry. Strategy: wait briefly for Downshift to render options, click the
    // first option (which also canonicalizes the address). Fall back to
    // Escape if no option appears.
    if (textResults.address === true) {
      try {
        await new Promise((r) => setTimeout(r, 250));
        const firstOption = page.locator('[role="option"], [role="listbox"] li').first();
        const optionCount = await firstOption.count().catch(() => 0);
        if (optionCount > 0) {
          await firstOption.click({ timeout: 600 }).catch(() => null);
          trace("[seatgeek] address suggestion auto-selected (Downshift dropdown closed)");
        } else {
          await page.keyboard.press("Escape").catch(() => null);
          trace("[seatgeek] address suggestion dropdown: no options visible — dismissed via Escape");
        }
      } catch (err) {
        trace(`[seatgeek] address dropdown cleanup skipped: ${(err as Error).message?.slice(0, 80)}`);
      }
    }

    // ── Layer 2: AI fill for anything missed (mostly for edge cases) ──────────
    // Only trigger AI fill when a *core identity* field (first/last name) is
    // missing. email/phone are absent-by-design from SG's Add new card modal
    // (they live as read-only text in the Contact section above), so treating
    // them as "missed" would burn OpenAI quota on a guaranteed-to-fail fill.
    if (stagehand) {
      const coreMissed = [textResults.firstName, textResults.lastName].filter(v => v === "not_found" || v === false);
      const structurallyAbsent = [textResults.email, textResults.phone].filter(v => v === "not_found").length;
      if (structurallyAbsent > 0) {
        trace(`[seatgeek] email/phone absent from Add-card modal (shown in Contact section) — skipping AI fill for those`);
      }
      if (coreMissed.length > 0) {
        trace(`[seatgeek] ${coreMissed.length} core field(s) missed — running AI fill`);
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
    // No Continue click — SG's modal submit is the same Save button that
    // requires CVV. We always stop at CVV per CLAUDE.md's payment rule.
  },

  async fillPaymentForm(
    page: Page,
    profile: unknown,
    _helpers: unknown,
    trace: (msg: string) => void
  ): Promise<void> {
    // SG "Add new card" modal. Card fields are all visible inputs + dropdowns
    // on the same modal as billing. We fill everything EXCEPT CVV (user types).
    const p = profile as SeatGeekProfile;
    const cardNumberDigits = (p.card_number ?? "").replace(/\D/g, "");
    const parsedExpiry = parseExpiry(p.card_expiry ?? "");

    // SG's card number + CVV fields are rendered inside cross-origin Spreedly
    // iframes (core.spreedly.com/v1/embedded/number-frame, cvv-frame). Confirmed
    // via one-shot B-diag run: the "Credit card number" label's nearestIframe
    // points at a sameOrigin=false Spreedly frame. PCI DSS tokenization — the
    // main page can't touch these inputs, so both card number AND CVV must be
    // typed by the user. We still attempt to fill, but expect not_found and
    // log it as "skipped" rather than an error.
    //
    // Card number input — fallback detection still runs in case SG ever moves
    // to an inline input, but default outcome for the live site is:
    // card number: skipped (Spreedly iframe — user must type)
    const numberResult = await page.evaluate(
      ({ number }: { number: string }) => {
        const nativeFill = (el: HTMLInputElement, val: string): boolean => {
          if (!val) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
          return el.value === val || el.value.replace(/\s+/g, "") === val;
        };

        const attrs = (el: HTMLInputElement) => ([
          (el.placeholder || ""),
          (el.getAttribute("aria-label") || ""),
          (el.id || ""),
          (el.name || ""),
          (el.autocomplete || ""),
          (el.type || ""),
          (el.getAttribute("data-testid") || ""),
        ].join(" ")).toLowerCase();

        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
        const diag = inputs.map((el, i) => `#${i} type=${el.type} ${attrs(el).trim().slice(0, 100)}`);

        const needles = ["cardnumber", "card-number", "card number", "cc-number", "ccnumber", "credit card"];
        const negatives = ["cvv", "cvc", "cid", "security", "exp", "expir", "month", "year", "name on card", "cardholder", "zip", "postal", "city", "state", "country", "address", "street", "apt", "suite", "first", "last", "email", "phone"];

        // Attempt 1: attribute-based match.
        let numEl: HTMLInputElement | undefined = inputs.find(el => {
          const a = attrs(el);
          if (negatives.some(n => a.includes(n))) return false;
          return needles.some(n => a.includes(n));
        });
        let matchMethod = numEl ? "attr" : "";

        // Attempt 2: label-proximity — SG strips placeholder/id/name/aria-label
        // from the card number field (anti-autofill). Find the visible text
        // "Credit card number" or "Card number" and walk up to find the nearest
        // input below it.
        if (!numEl) {
          const labelPattern = /(credit\s*card\s*number|card\s*number)/i;
          const allEls = Array.from(document.querySelectorAll<HTMLElement>("label, span, div, p"))
            .filter(el => el.offsetParent !== null);
          // Prefer the tightest label: shortest text that still matches.
          const candidates = allEls
            .filter(el => {
              const t = (el.textContent ?? "").trim();
              return t.length > 0 && t.length < 60 && labelPattern.test(t);
            })
            .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));

          for (const lbl of candidates) {
            // If <label for=...>, resolve via id.
            if (lbl.tagName === "LABEL") {
              const forId = (lbl as HTMLLabelElement).htmlFor;
              if (forId) {
                const byId = document.getElementById(forId) as HTMLInputElement | null;
                if (byId && byId.tagName === "INPUT" && byId.offsetParent !== null && !byId.disabled) {
                  numEl = byId;
                  matchMethod = "label-for";
                  break;
                }
              }
            }
            // Walk up parents, looking for an input descendant that is visible,
            // not disabled, and not matching a negative (e.g. CVV).
            let walker: HTMLElement | null = lbl;
            for (let depth = 0; depth < 6 && walker && !numEl; depth++) {
              const descendants = Array.from(walker.querySelectorAll<HTMLInputElement>("input"))
                .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
              const picked = descendants.find(el => {
                const a = attrs(el);
                return !negatives.some(n => a.includes(n));
              });
              if (picked) {
                numEl = picked;
                matchMethod = `label-proximity-d${depth}`;
                break;
              }
              walker = walker.parentElement;
            }
            if (numEl) break;
          }
        }

        if (!numEl) return { status: "not_found" as const, diag: diag.join(" || "), matchMethod: "" };
        const ok = nativeFill(numEl, number);
        return {
          status: ok ? "ok" as const : "fill_failed" as const,
          diag: diag.join(" || "),
          attr: attrs(numEl).slice(0, 100),
          matchMethod,
        };
      },
      { number: cardNumberDigits }
    ).catch((err: Error) => {
      trace(`[seatgeek] card number fill failed: ${err.message?.slice(0, 80)}`);
      return { status: "error" as const, diag: "", attr: "", matchMethod: "" };
    });
    const rAny = numberResult as { status: string; diag?: string; attr?: string; matchMethod?: string };
    if (rAny.status === "not_found") {
      // Expected on the live site: SG uses Spreedly cross-origin iframe for
      // card number. Log it clearly instead of making it look like a bug.
      trace(`[seatgeek] card number: skipped (Spreedly cross-origin iframe — user must type manually, PCI compliance)`);
    } else {
      trace(`[seatgeek] card number: ${rAny.status}${rAny.matchMethod ? ` via=${rAny.matchMethod}` : ""}${rAny.attr ? ` attrs="${rAny.attr}"` : ""}`);
    }
    // Keep DOM diag only when we actually found something unexpected; it's
    // noise when the normal Spreedly-iframe path runs.
    if (rAny.diag && rAny.status !== "not_found") {
      trace(`[seatgeek] payment DOM diag: ${rAny.diag.slice(0, 500)}`);
    }

    // Exp month + exp year as TWO dropdowns. SG uses React Select-style
    // combobox most of the time (not native <select>), so we try both.
    if (parsedExpiry) {
      const monthNumeric = parsedExpiry.month; // "05"
      const monthNumericNoPad = String(parseInt(parsedExpiry.month, 10)); // "5"
      const monthCandidates = [monthNumeric, monthNumericNoPad];

      const yearFull = parsedExpiry.year;           // "2026"
      const yearShort = parsedExpiry.year.slice(-2); // "26"
      const yearCandidates = [yearFull, yearShort];

      const monthRes = await selectDropdownByText(page, ["month", "exp-month", "cc-exp-month", "expmonth"], monthCandidates, trace);
      trace(`[seatgeek] exp month dropdown: ${monthRes}`);

      const yearRes = await selectDropdownByText(page, ["year", "exp-year", "cc-exp-year", "expyear"], yearCandidates, trace);
      trace(`[seatgeek] exp year dropdown: ${yearRes}`);
    } else {
      trace(`[seatgeek] card_expiry "${p.card_expiry ?? ""}" did not parse — skipping exp fields`);
    }

    trace("[seatgeek] payment fill complete — CVV left for user");
  },

  getBotPatterns(): string[] {
    return [
      "press and hold",
      "verify you are human",
      "please confirm you are human",
    ];
  },
};

/**
 * Select a value in a dropdown-like control whose label/id/name matches one of
 * the given `labelNeedles`. Tries in order:
 *   1. Native <select> — set value by option label/value match.
 *   2. Custom combobox (role="combobox" or clickable input) — click to open,
 *      then click a visible option whose text matches any of the `valueCandidates`.
 *
 * Returns a human-readable status string for the trace log.
 */
async function selectDropdownByText(
  page: Page,
  labelNeedles: string[],
  valueCandidates: string[],
  trace: (msg: string) => void,
): Promise<string> {
  // Path 1: native <select>.
  const nativeResult = await page.evaluate(
    ({ needles, values }: { needles: string[]; values: string[] }) => {
      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"))
        .filter(el => !el.disabled && el.offsetParent !== null);

      const matches = (el: HTMLSelectElement) => {
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        const id = (el.id || "").toLowerCase();
        const nm = (el.name || "").toLowerCase();
        const ac = (el.autocomplete || "").toLowerCase();
        // Check associated <label for={id}> text too.
        let labelText = "";
        if (el.id) {
          const lblEl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
          if (lblEl) labelText = (lblEl.textContent ?? "").toLowerCase();
        }
        return needles.some(n => lbl.includes(n) || id.includes(n) || nm.includes(n) || ac.includes(n) || labelText.includes(n));
      };

      const sel = selects.find(matches);
      if (!sel) return { kind: "native-not-found" as const };

      for (const val of values) {
        const opt = Array.from(sel.options).find(o => {
          const txt = (o.textContent ?? "").trim().toLowerCase();
          const v = (o.value ?? "").trim().toLowerCase();
          return txt === val.toLowerCase() || v === val.toLowerCase() ||
                 txt.startsWith(val.toLowerCase()) || v === val.toLowerCase().padStart(2, "0");
        });
        if (opt) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
          if (setter) setter.call(sel, opt.value); else sel.value = opt.value;
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return { kind: "native-ok" as const, value: opt.value, text: (opt.textContent ?? "").trim() };
        }
      }
      return { kind: "native-no-option" as const };
    },
    { needles: labelNeedles, values: valueCandidates }
  ).catch(() => ({ kind: "native-error" as const }));

  if (nativeResult.kind === "native-ok") {
    return `native <select>: "${"text" in nativeResult ? nativeResult.text : ""}"`;
  }

  // Path 2: custom combobox (role="combobox") or clickable label/button that
  // opens a listbox. We locate a labelled trigger, click it, wait for options,
  // and click the option whose text matches.
  const opened = await page.evaluate(
    ({ needles }: { needles: string[] }) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const matchesLabel = (el: HTMLElement): boolean => {
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        const id = (el.id || "").toLowerCase();
        const nm = (el.getAttribute("name") || "").toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const textStart = (el.textContent ?? "").trim().toLowerCase().slice(0, 40);
        let labelText = "";
        if (el.id) {
          const lblEl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
          if (lblEl) labelText = (lblEl.textContent ?? "").toLowerCase();
        }
        // Labels often wrap the trigger — walk up to 3 ancestors.
        let ancLabel = "";
        let parent: HTMLElement | null = el.parentElement;
        for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
          const anc = parent.querySelector<HTMLElement>("label, [class*='label' i]");
          if (anc) { ancLabel = (anc.textContent ?? "").toLowerCase(); break; }
        }
        const hay = `${lbl} ${id} ${nm} ${role} ${labelText} ${ancLabel} ${textStart}`;
        return needles.some(n => hay.includes(n));
      };

      // Candidate triggers: role=combobox, clickable readonly inputs, buttons
      // that look like dropdowns (have chevron icons).
      const triggers = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="combobox"], [role="listbox"], [aria-haspopup="listbox"], [aria-haspopup="true"], button, input'
      )).filter(isVisible).filter(matchesLabel);

      if (triggers.length === 0) return { opened: false, label: null };

      const trigger = triggers[0];
      trigger.scrollIntoView({ behavior: "auto", block: "center" });
      // Fire full pointer sequence — React-based comboboxes listen for pointerdown/mousedown,
      // not click alone.
      const rect = trigger.getBoundingClientRect();
      const opts: PointerEventInit = {
        bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        button: 0, pointerType: "mouse",
      };
      trigger.dispatchEvent(new PointerEvent("pointerdown", opts));
      trigger.dispatchEvent(new MouseEvent("mousedown", opts));
      trigger.dispatchEvent(new PointerEvent("pointerup", opts));
      trigger.dispatchEvent(new MouseEvent("mouseup", opts));
      trigger.dispatchEvent(new MouseEvent("click", opts));
      if ((trigger as HTMLInputElement).focus) trigger.focus();

      return { opened: true, label: (trigger.getAttribute("aria-label") || trigger.id || trigger.textContent?.slice(0, 40) || "trigger") };
    },
    { needles: labelNeedles }
  ).catch(() => ({ opened: false, label: null as string | null }));

  if (!opened.opened) {
    return `no trigger matched (${labelNeedles.join("/")})`;
  }

  // Wait for the listbox / options popup to render.
  await page.waitForTimeout(400);

  const picked = await page.evaluate(
    ({ values }: { values: string[] }) => {
      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // Options: role=option, or <li> inside role=listbox, or simple divs with
      // text that exactly matches our candidates.
      const options = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="option"], [role="listbox"] li, [role="listbox"] [role="option"], ul[role="listbox"] > *, [data-value]'
      )).filter(isVisible);

      for (const val of values) {
        const vLower = val.toLowerCase();
        const opt = options.find(el => {
          const txt = (el.textContent ?? "").trim().toLowerCase();
          const data = ((el as HTMLElement).getAttribute("data-value") ?? "").toLowerCase();
          return txt === vLower || data === vLower ||
                 txt.startsWith(vLower + " ") || txt === vLower;
        });
        if (opt) {
          opt.scrollIntoView({ behavior: "auto", block: "center" });
          const rect = opt.getBoundingClientRect();
          const pOpts: PointerEventInit = {
            bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            button: 0, pointerType: "mouse",
          };
          opt.dispatchEvent(new PointerEvent("pointerdown", pOpts));
          opt.dispatchEvent(new MouseEvent("mousedown", pOpts));
          opt.dispatchEvent(new PointerEvent("pointerup", pOpts));
          opt.dispatchEvent(new MouseEvent("mouseup", pOpts));
          opt.dispatchEvent(new MouseEvent("click", pOpts));
          return { ok: true, label: (opt.textContent ?? "").trim().slice(0, 60) };
        }
      }
      return { ok: false, label: null, available: options.length };
    },
    { values: valueCandidates }
  ).catch(() => ({ ok: false, label: null as string | null, available: 0 }));

  if (picked.ok) {
    return `combobox option: "${picked.label}"`;
  }
  void trace;
  return `combobox opened but no option matched [${valueCandidates.join(",")}] (${"available" in picked ? picked.available : 0} visible)`;
}

registerProvider(seatgeekProvider);
