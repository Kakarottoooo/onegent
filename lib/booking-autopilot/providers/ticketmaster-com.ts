import fs from "fs";
import path from "path";
import type { Page, Frame } from "playwright";
import { registerProvider } from "./registry";
import type { BrowserProvider, ProviderStageSignals } from "./types";
import { fillGuestFormWithAI, auditAndRefillEmptyFields } from "../ai-loop/fill-form";
import { buildEffectiveProfile } from "../core/profile";
import type { BookingProfile } from "../types";

interface TicketmasterProfile {
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

// US + DC abbreviation ↔ full name lookup. Ticketmaster's State combobox
// displays full names ("Tennessee"), so typing "TN" filters to zero items.
// We try both forms per retry attempt.
const US_STATE_FULL: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

function buildStateSearchCandidates(raw: string): string[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  const upper = trimmed.toUpperCase();
  const cands: string[] = [trimmed];
  if (trimmed.length === 2 && US_STATE_FULL[upper]) {
    // "TN" → also try "Tennessee"
    cands.push(US_STATE_FULL[upper]);
  } else {
    // Full name → find abbreviation
    const entry = Object.entries(US_STATE_FULL).find(
      ([, name]) => name.toLowerCase() === trimmed.toLowerCase()
    );
    if (entry) cands.push(entry[0]);
  }
  return cands;
}

export const ticketmasterProvider: BrowserProvider = {
  id: "ticketmaster-com",

  matchesUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("ticketmaster.com") || lower.includes("ticketmaster.ca");
  },

  async setup(page: Page, context: unknown, _trace: (msg: string) => void): Promise<void> {
    const trace = (msg: string) => { console.log(msg); _trace(msg); };
    // Inject saved session cookies so the autopilot starts pre-logged-in.
    // Ticketmaster forces login for most shows (Hamilton etc.), so without
    // these the flow hits auth.ticketmaster.com and stalls until the user
    // logs in by hand. Fingerprint-sensitive: cookies saved from Playwright
    // Chromium are trusted because the runtime browser is also Playwright
    // Chromium; cookies copied from the user's system Chrome may not be.
    try {
      const cookiesPath = path.join(process.cwd(), ".ticketmaster-cookies.json");
      if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf-8")) as unknown[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (context as any).addCookies(cookies);
        trace(`[ticketmaster] Injected ${cookies.length} session cookies from .ticketmaster-cookies.json`);
      } else {
        trace("[ticketmaster] No .ticketmaster-cookies.json — run: node scripts/save-ticketmaster-cookies.mjs");
      }
    } catch (err) {
      trace(`[ticketmaster] Cookie injection failed: ${(err as Error).message?.slice(0, 100)}`);
    }

    // Ticketmaster shows: OneTrust cookie banner (#onetrust-accept-btn-handler),
    // plus occasional "Enable cookies" / privacy modals. Best-effort dismiss.
    try {
      await page.evaluate(() => {
        const tryClick = (selector: string) => {
          const el = document.querySelector<HTMLElement>(selector);
          if (el) { el.click(); return true; }
          return false;
        };
        if (tryClick("#onetrust-accept-btn-handler")) return;
        if (tryClick("button#accept-cookies")) return;

        const pattern = /accept all|accept cookies|i agree|got it|ok|close/i;
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button"));
        for (const btn of btns) {
          const label = (btn.textContent ?? "").trim();
          if (!label) continue;
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (pattern.test(label)) { btn.click(); return; }
        }
      });
    } catch (err) {
      trace(`[ticketmaster] cookie dismiss skipped: ${(err as Error).message?.slice(0, 60)}`);
    }
  },

  async getStageSignals(page: Page, url: string, _text: string): Promise<ProviderStageSignals> {
    const lower = url.toLowerCase();

    // Event page: /event/{id}, or artist/attraction page, or search landing.
    // All three show some kind of "Find Tickets" / "Buy" / showtime list.
    const eventPage =
      lower.includes("/event/") ||
      lower.includes("/artist/") ||
      lower.includes("/attraction/") ||
      /ticketmaster\.(com|ca)\/[a-z0-9-]+(\/?$|\?)/.test(lower);

    // Checkout / purchase flow — Ticketmaster uses checkout.ticketmaster.com
    // or /checkout on main domain.
    const isCheckoutUrl =
      lower.includes("checkout.ticketmaster") ||
      lower.includes("/checkout") ||
      lower.includes("/purchase") ||
      lower.includes("/order");

    // Guest details: identity inputs visible on checkout-like URL.
    const guestDetailsStep = isCheckoutUrl && await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
        .filter(el => el.type !== "hidden" && !el.disabled && el.offsetParent !== null);
      const hasName = inputs.some(el => {
        const ph = (el.placeholder || "").toLowerCase();
        const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
        const ac = (el.autocomplete || "").toLowerCase();
        const id = (el.id || "").toLowerCase();
        return ph.includes("first") || ph.includes("last") ||
               lbl.includes("first") || lbl.includes("last") ||
               ac.includes("given-name") || ac.includes("family-name") ||
               id.includes("firstname") || id.includes("lastname");
      });
      const hasEmail = inputs.some(el =>
        el.type === "email" || (el.placeholder || "").toLowerCase().includes("email")
      );
      return hasName || hasEmail;
    }).catch(() => false);

    // Payment step: card number input visible.
    const paymentStep = isCheckoutUrl && await page.evaluate(() => {
      const cardSelectors = [
        'input[autocomplete="cc-number"]',
        'input[name*="cardNumber" i]',
        'input[id*="cardNumber" i]',
        'input[id*="card-number" i]',
        'input[placeholder*="card number" i]',
        'iframe[title*="card number" i]',
        'iframe[name*="cardnumber" i]',
      ];
      for (const sel of cardSelectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && (el as HTMLElement).offsetParent !== null) return true;
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
    _trace: (msg: string) => void
  ): Promise<void> {
    const trace = (msg: string) => { console.log(msg); _trace(msg); };
    const p = profile as TicketmasterProfile;
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

        const firstEl = inputs.find(el => matches(el, ["first", "given-name", "firstname"]));
        res.firstName = firstEl ? nativeFill(firstEl, first) : "not_found";

        const lastEl = inputs.find(el => matches(el, ["last", "family-name", "surname", "lastname"]));
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
      trace(`[ticketmaster] guest form evaluate failed: ${err.message?.slice(0, 80)}`);
      return {} as Record<string, boolean | string>;
    });

    trace(`[ticketmaster] guest form filled: firstName=${results.firstName} lastName=${results.lastName} email=${results.email} phone=${results.phone} zip=${results.zip}`);

    // ── Layer 2: AI fill for missed fields ────────────────────────────────────
    if (stagehand) {
      const missed = [results.firstName, results.lastName, results.email, results.phone].filter(v => v === "not_found" || v === false);
      if (missed.length > 0) {
        trace(`[ticketmaster] ${missed.length} field(s) missed — running AI fill`);
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        try {
          const aiResult = await fillGuestFormWithAI(stagehand, effectiveProfile, trace);
          trace(`[ticketmaster] AI fill: filled=${aiResult.filled.join(",")} failed=${aiResult.failed.join(",")}`);
        } catch (e) { trace(`[ticketmaster] AI fill error: ${(e as Error).message?.slice(0, 80)}`); }
      }
      // ── Layer 3: AI audit pass ─────────────────────────────────────────────
      try {
        const effectiveProfile = buildEffectiveProfile(p as BookingProfile, "");
        const audit = await auditAndRefillEmptyFields(stagehand, rawPage, effectiveProfile, trace);
        if (audit.refilled.length) trace(`[ticketmaster] audit refilled: ${audit.refilled.join(",")}`);
      } catch (e) { trace(`[ticketmaster] audit error: ${(e as Error).message?.slice(0, 80)}`); }
    }

    // Try to advance the guest step — user still reviews payment.
    await new Promise(r => setTimeout(r, 800));
    const submitted = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const pattern = /continue|next|proceed to payment|proceed to checkout/i;
      const btn = Array.from(document.querySelectorAll<HTMLElement>('button[type="submit"], button'))
        .find(el => isVisible(el) && pattern.test((el.textContent ?? "").trim()));
      if (btn) { btn.click(); return (btn.textContent ?? "").trim().slice(0, 40); }
      return null;
    }).catch(() => null);

    if (submitted) {
      trace(`[ticketmaster] clicked continue: "${submitted}"`);
    } else {
      trace("[ticketmaster] continue button not found — leaving form for user");
    }
  },

  async fillPaymentForm(
    page: Page,
    profile: unknown,
    _helpers: unknown,
    _trace: (msg: string) => void
  ): Promise<void> {
    const trace = (msg: string) => { console.log(msg); _trace(msg); };
    const p = profile as TicketmasterProfile;
    const cardNumberDigits = (p.card_number ?? "").replace(/\D/g, "");
    const cardExpiry = p.card_expiry ?? "";
    const cardName = p.card_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    const phoneDigits = (p.phone ?? "").replace(/\D/g, "");

    // Payment form lives in <iframe id="credit-card-iframe"> (src=payments-cc.
    // ticketmaster.com). Inputs use stable IDs: #cardNumber-input,
    // #expirationDate-input, #country-input, etc. Discovered via [diag] run on
    // 2026-04-22. Stagehand's wrapped Page doesn't expose full Locator.waitFor
    // API, so we find the target Frame by probing each for #cardNumber-input
    // and use frame.evaluate() which is proven to work for this site.
    let cardFrame: Frame | null = null;
    for (const f of page.frames()) {
      try {
        const hit = await f.evaluate(() => !!document.getElementById("cardNumber-input"));
        if (hit) { cardFrame = f; break; }
      } catch { /* frame main world not ready — skip */ }
    }
    if (!cardFrame) {
      trace("[ticketmaster] credit-card-iframe not located in frames list — user must fill payment manually");
      return;
    }

    const fillResult = await cardFrame.evaluate(
      (args: {
        cardName: string; cardNumber: string; expiry: string;
        address: string; city: string; postalCode: string; phone: string;
        country: string;
      }) => {
        // Returns the post-fill element value (Ticketmaster reformats card
        // number "8888888888888888" → "8888 8888 8888 8888" and expiry
        // "0130" → "01/30"), so strict equality gives false negatives.
        const nativeFill = (el: HTMLInputElement, val: string): string => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return el.value;
        };
        const fill = (id: string, val: string, opts?: { digitsOnly?: boolean }): string => {
          if (!val) return "empty";
          const el = document.getElementById(id);
          if (!(el instanceof HTMLInputElement)) return "not_found";
          const result = nativeFill(el, val);
          el.blur();
          if (opts?.digitsOnly) {
            const got = result.replace(/\D/g, "");
            const want = val.replace(/\D/g, "");
            if (got === want) return "ok";
            return got.length > 0 ? `ok_formatted(${result.slice(0, 24)})` : "fill_failed";
          }
          if (result === val) return "ok";
          return result.length > 0 ? `ok_partial(${result.slice(0, 24)})` : "fill_failed";
        };

        const res: Record<string, string> = {};
        res.cardName   = fill("nameOnCard-input",     args.cardName);
        res.cardNumber = fill("cardNumber-input",     args.cardNumber, { digitsOnly: true });
        res.expiry     = fill("expirationDate-input", args.expiry,     { digitsOnly: true });
        // CVV (#securityCode-input) deliberately skipped — Ticketmaster gates
        // the CVV input behind Luhn validation of the card number, so it only
        // enables after a real (valid) card number is entered. Test numbers
        // like 8888... fail Luhn and leave CVV disabled.
        res.address    = fill("address-input",        args.address);
        res.city       = fill("city-input",           args.city);
        res.postalCode = fill("postalCode-input",     args.postalCode);
        res.phone      = fill("phone-input",          args.phone);

        // Country: autocomplete combobox. Type the value, dispatch input, and
        // leave the dropdown open for the user to confirm with a click. We
        // don't synthesize Enter here because frameworks often ignore synthetic
        // KeyboardEvents that weren't tied to real OS input.
        if (args.country) {
          const el = document.getElementById("country-input");
          if (el instanceof HTMLInputElement) {
            nativeFill(el, args.country);
            res.country = "typed";
          } else {
            res.country = "not_found";
          }
        } else {
          res.country = "empty";
        }

        return res;
      },
      {
        cardName,
        cardNumber: cardNumberDigits,
        expiry: cardExpiry,
        address: p.address_line1 ?? "",
        city: p.city ?? "",
        postalCode: p.zip ?? "",
        phone: phoneDigits,
        country: p.country ?? "",
      }
    ).catch((err: Error) => {
      trace(`[ticketmaster] payment frame.evaluate failed: ${err.message?.slice(0, 80)}`);
      return null;
    });

    if (!fillResult) return;

    // Country needs a second pass: after typing, Ticketmaster renders a
    // suggestion dropdown in the main document (sometimes portal'd outside the
    // iframe, often inside). Try clicking the first matching listbox option.
    if (fillResult.country === "typed" && p.country) {
      await new Promise(r => setTimeout(r, 800));
      const clickRes = await cardFrame!.evaluate((countryName: string) => {
        const norm = (s: string) => s.trim().toLowerCase();
        const target = norm(countryName);
        // Common combobox patterns: [role=option], [role=listbox] children,
        // or <li> inside a list that appears right after the input.
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(
          '[role="option"], [role="listbox"] > *, ul[class*="option" i] > li, ul[class*="suggestion" i] > li, li[class*="option" i], div[class*="option" i][class*="item" i]'
        )).filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (candidates.length === 0) return "no_candidates";
        // Prefer exact match, then startsWith, then includes.
        const exact = candidates.find(el => norm(el.textContent ?? "") === target);
        const starts = candidates.find(el => norm(el.textContent ?? "").startsWith(target));
        const partial = candidates.find(el => norm(el.textContent ?? "").includes(target));
        const pick = exact ?? starts ?? partial ?? candidates[0];
        pick.click();
        return `clicked:"${(pick.textContent ?? "").trim().slice(0, 40)}"`;
      }, p.country).catch((err: Error) => `click_failed(${err.message?.slice(0, 50)})`);
      fillResult.country = `typed→${clickRes}`;
    }

    // Third pass: State field renders dynamically only after Country=US (or
    // other country with subdivisions) is selected. Phone sometimes gets
    // cleared by the country-dropdown click re-render, so re-verify it here.
    await new Promise(r => setTimeout(r, 800));
    const secondPass = await cardFrame!.evaluate(
      (args: { state: string; phone: string }) => {
        const nativeFill = (el: HTMLInputElement, val: string): string => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          el.focus();
          if (setter) { setter.call(el, ""); setter.call(el, val); }
          else { el.value = ""; el.value = val; }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return el.value;
        };

        const res: Record<string, string> = {};

        // Diagnostic: dump every input/select that looks state-related so we
        // can confirm the selector on the next run.
        const stateCandidates: string[] = [];
        const all = Array.from(document.querySelectorAll<HTMLElement>("input, select"));
        for (const el of all) {
          const id = (el.id || "").toLowerCase();
          const name = ((el as HTMLInputElement).name || "").toLowerCase();
          const ph = ((el as HTMLInputElement).placeholder || "").toLowerCase();
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          const hit = id.includes("state") || id.includes("region") || id.includes("province") ||
                      name.includes("state") || name.includes("region") || name.includes("province") ||
                      ph.includes("state") || ph.includes("region") || ph.includes("province") ||
                      lbl.includes("state") || lbl.includes("region") || lbl.includes("province");
          if (hit && !id.includes("statement")) {
            const r = el.getBoundingClientRect();
            stateCandidates.push(
              `${el.tagName.toLowerCase()}#${el.id || "?"} nm="${(el as HTMLInputElement).name || ""}" ph="${(el as HTMLInputElement).placeholder || ""}" vis=${r.width > 0 && r.height > 0}`
            );
          }
        }
        res.stateDiag = stateCandidates.length > 0 ? stateCandidates.join(" | ").slice(0, 200) : "no_state_field";

        // State fill: try <select> first, then combobox input.
        if (args.state) {
          const selectEl = document.querySelector<HTMLSelectElement>(
            "select#state-input, select#state, select[name='state'], select[name='region']"
          );
          if (selectEl) {
            const target = args.state.trim().toLowerCase();
            const match = Array.from(selectEl.options).find(opt =>
              (opt.value || "").toLowerCase() === target ||
              (opt.textContent || "").trim().toLowerCase() === target ||
              (opt.textContent || "").trim().toLowerCase().startsWith(target)
            );
            if (match) {
              selectEl.value = match.value;
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
              res.state = `select_ok:"${(match.textContent || "").trim().slice(0, 30)}"`;
            } else {
              res.state = "select_no_match";
            }
          } else {
            // Combobox: handled entirely in outer retry loop (needs awaits +
            // repeated queries; keep inner evaluate synchronous/simple).
            const inputEl = document.querySelector<HTMLInputElement>(
              "input#stateCode-input, input[name='stateCode'], input#state-input, input#state, input[name='state'], input[name='region']"
            );
            res.state = inputEl ? "combobox_pending" : "not_found";
          }
        } else {
          res.state = "empty";
        }

        // Phone re-verify: if country click re-rendered and cleared it, refill.
        const phoneEl = document.getElementById("phone-input");
        if (phoneEl instanceof HTMLInputElement) {
          const cur = phoneEl.value.replace(/\D/g, "");
          if (cur.length === 0 && args.phone) {
            nativeFill(phoneEl, args.phone);
            phoneEl.blur();
            const after = phoneEl.value.replace(/\D/g, "");
            res.phone2 = after === args.phone ? "refilled_ok" : `refilled_partial(${phoneEl.value.slice(0, 24)})`;
          } else {
            res.phone2 = `kept(${cur.slice(0, 16)})`;
          }
        } else {
          res.phone2 = "phone_input_missing";
        }

        return res;
      },
      { state: p.state ?? "", phone: phoneDigits }
    ).catch((err: Error) => ({ error: err.message?.slice(0, 80) } as Record<string, string>));

    // State combobox retry loop. Stagehand wraps Frame too (no .fill/.type/
    // .click/.press), so we do everything inside one async evaluate which
    // retains focus across setTimeout awaits. Up to 3 attempts — each opens
    // the dropdown, types the state char-by-char (dispatching input +
    // keydown/keyup so React-controlled comboboxes actually filter), then
    // scrolls the matching option into view and clicks it.
    if (p.state && secondPass.state === "combobox_pending") {
      // Each attempt types a different search string. For "TN" we try ["TN",
      // "Tennessee"]; both forms are also passed as matchTargets so the option
      // click picks whichever one the dropdown actually renders.
      const searchCandidates = buildStateSearchCandidates(p.state);
      const matchTargets = searchCandidates.map(s => s.toLowerCase());
      let attempt = 0;
      let lastResult: { state: string; diag?: string } = { state: "never_ran" };
      while (attempt < Math.max(3, searchCandidates.length)) {
        attempt++;
        const typeValue = searchCandidates[(attempt - 1) % searchCandidates.length];
        lastResult = await cardFrame!.evaluate(
          async (args: { typeValue: string; matchTargets: string[]; attempt: number }) => {
            const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
            const norm = (s: string) => s.trim().toLowerCase();
            const targets = args.matchTargets; // e.g., ["tn", "tennessee"]
            const matchesAny = (text: string) => {
              const t = norm(text);
              return targets.some(tg => t === tg || t.startsWith(tg) || t.includes(tg));
            };

            const inputEl = document.querySelector<HTMLInputElement>(
              "input#stateCode-input, input[name='stateCode']"
            );
            if (!inputEl) return { state: "input_not_found" };

            // Clear any residue via native setter.
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            inputEl.focus();
            if (setter) setter.call(inputEl, "");
            else inputEl.value = "";
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));

            // Dispatch a proper pointer+mouse click sequence so React listeners
            // on mousedown/pointerdown fire (plain .click() only triggers
            // `click` event, some components open on mousedown instead).
            const rect = inputEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const mkMouse = (type: string) => new MouseEvent(type, {
              bubbles: true, cancelable: true, view: window,
              clientX: cx, clientY: cy, button: 0,
            });
            inputEl.dispatchEvent(mkMouse("pointerdown"));
            inputEl.dispatchEvent(mkMouse("mousedown"));
            inputEl.dispatchEvent(mkMouse("pointerup"));
            inputEl.dispatchEvent(mkMouse("mouseup"));
            inputEl.dispatchEvent(mkMouse("click"));
            await sleep(400);

            // Type char-by-char, dispatching keydown+input+keyup after each.
            for (const ch of args.typeValue) {
              inputEl.focus();
              const prev = inputEl.value;
              if (setter) setter.call(inputEl, prev + ch);
              else inputEl.value = prev + ch;
              inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
              inputEl.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
              inputEl.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
              await sleep(40);
            }
            await sleep(500);

            // Find option candidates — retry up to 5x to let React render.
            const sels = [
              '[role="option"]',
              '[role="listbox"] [role="option"]',
              '[role="listbox"] li',
              '[role="listbox"] div',
              'ul[class*="option" i] li',
              'ul[class*="menu" i] li',
              'ul[class*="dropdown" i] li',
              'ul[class*="suggestion" i] li',
              'ul[class*="list" i] li',
              'li[class*="option" i]',
              'div[class*="option" i]',
              'div[class*="menu-item" i]',
              'div[class*="item" i]',
              'button[role="menuitem"]',
              '[data-testid*="state" i]',
              '[data-testid*="option" i]',
            ].join(",");

            let candidates: HTMLElement[] = [];
            for (let i = 0; i < 5; i++) {
              candidates = Array.from(document.querySelectorAll<HTMLElement>(sels))
                .filter(el => {
                  const r = el.getBoundingClientRect();
                  if (r.width === 0 || r.height === 0) return false;
                  const text = (el.textContent || "").trim();
                  return text.length > 0 && text.length < 80;
                });
              if (candidates.length > 0) break;
              await sleep(300);
            }

            if (candidates.length === 0) {
              // Diagnostic dump so we can tune on next run.
              const diag = Array.from(document.querySelectorAll<HTMLElement>("*"))
                .filter(el => {
                  if (el.children.length > 0) return false;
                  const r = el.getBoundingClientRect();
                  if (r.width === 0 || r.height === 0) return false;
                  const text = (el.textContent || "").trim();
                  return text.length > 2 && text.length < 40;
                })
                .slice(0, 50)
                .map(el => `${el.tagName.toLowerCase()}[${el.getAttribute("role") || "-"}]:"${(el.textContent || "").trim().slice(0, 28)}"`)
                .join(" | ");
              return { state: `no_candidates_a${args.attempt}`, diag: diag.slice(0, 600) };
            }

            // Double-sided match: option text might be "TN" OR "Tennessee";
            // search string might be the other. Try exact, startsWith, includes
            // against every target form we have.
            const exact = candidates.find(el =>
              targets.some(tg => norm(el.textContent ?? "") === tg)
            );
            const starts = candidates.find(el =>
              targets.some(tg => norm(el.textContent ?? "").startsWith(tg))
            );
            const partial = candidates.find(el => matchesAny(el.textContent ?? ""));
            const pick = exact ?? starts ?? partial;

            if (!pick) {
              const sample = candidates.slice(0, 8)
                .map(el => `"${(el.textContent || "").trim().slice(0, 24)}"`)
                .join(",");
              return { state: `no_match_a${args.attempt}(n=${candidates.length})`, diag: sample.slice(0, 400) };
            }

            pick.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
            await sleep(150);
            // Dispatch mouse sequence on the option too — some listbox items
            // only respond to mousedown, not click.
            const pRect = pick.getBoundingClientRect();
            const pcx = pRect.left + pRect.width / 2;
            const pcy = pRect.top + pRect.height / 2;
            const mkPick = (type: string) => new MouseEvent(type, {
              bubbles: true, cancelable: true, view: window,
              clientX: pcx, clientY: pcy, button: 0,
            });
            pick.dispatchEvent(mkPick("pointerdown"));
            pick.dispatchEvent(mkPick("mousedown"));
            pick.dispatchEvent(mkPick("pointerup"));
            pick.dispatchEvent(mkPick("mouseup"));
            pick.dispatchEvent(mkPick("click"));
            pick.click();
            await sleep(200);

            // Verify: input value should reflect either form (abbr or full).
            const after = (inputEl.value || "").trim();
            const ok = matchesAny(after);
            return {
              state: ok
                ? `clicked_a${args.attempt}(typed="${args.typeValue}"):"${(pick.textContent || "").trim().slice(0, 30)}"`
                : `clicked_but_value="${after.slice(0, 30)}"`,
            };
          },
          { typeValue, matchTargets, attempt }
        ).catch((err: Error) => ({ state: `err_a${attempt}:${err.message?.slice(0, 60)}` }));

        if (lastResult.state.startsWith("clicked_a")) break;
        await new Promise(r => setTimeout(r, 400));
      }
      secondPass.state = lastResult.state;
      if (lastResult.diag) secondPass.stateDiag2 = lastResult.diag;
    }

    const statusLine = Object.entries({ ...fillResult, ...secondPass })
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    trace(`[ticketmaster] payment filled (credit-card-iframe): ${statusLine} (CVV left for user — gated by Luhn)`);
  },

  getBotPatterns(): string[] {
    return [
      "press and hold",
      "verify you are human",
      "please confirm you are human",
      "you are in line",
      "waiting room",
      "please wait in line",
      "access denied",
      "enable cookies",
    ];
  },
};

registerProvider(ticketmasterProvider);
