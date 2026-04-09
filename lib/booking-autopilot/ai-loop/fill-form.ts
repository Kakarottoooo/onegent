/**
 * fill-form.ts — Phase 3: AI-driven guest form filling.
 *
 * Replaces the hardcoded Booking.com selector approach with
 * stagehand.act() calls for each field. Works on any website.
 *
 * Payment fields (card_number, card_expiry, CVV) are intentionally
 * excluded — the flow stops before payment so the user completes it.
 */

import type { Page } from "playwright";
import type { EffectiveProfile } from "../core/profile";

/** Minimal interface: only .act() is needed for form filling. */
type Actable = { act: (instruction: string) => Promise<unknown> };

export type FillResult = {
  filled: string[];
  failed: string[];
};

/**
 * Core contact fields (no billing address, no payment).
 * Used for sites like Booking.com where only name/email/phone/country appear.
 */
function buildContactFields(p: EffectiveProfile): Record<string, string> {
  const fields: Record<string, string> = {};
  if (p.first_name) fields["first name"]    = p.first_name;
  if (p.last_name)  fields["last name"]     = p.last_name;
  if (p.email)      fields["email address"] = p.email;
  if (p.phone)      fields["phone number"]  = p.phone;
  if (p.country)    fields["country"]       = p.country;
  return fields;
}

/**
 * Full guest fields including billing address.
 * Used for sites that show a billing address section in checkout.
 */
function buildGuestFields(p: EffectiveProfile): Record<string, string> {
  const fields = buildContactFields(p);
  if (p.address_line1) fields["street address"]     = p.address_line1;
  if (p.city)          fields["city"]               = p.city;
  if (p.state)         fields["state or province"]  = p.state;
  if (p.zip)           fields["zip or postal code"] = p.zip;
  return fields;
}

/**
 * Fill guest contact form fields using stagehand.act() (AI-driven).
 *
 * @param includeAddress  Pass true only for sites that show a billing address
 *   section (street/city/state/zip). Booking.com's checkout form does NOT have
 *   these fields — enabling them causes Stagehand to mis-fill the "Special
 *   requests" textarea instead. Defaults to false (contact fields only).
 */
export async function fillGuestFormWithAI(
  stagehand: Actable,
  profile: EffectiveProfile,
  trace: (msg: string) => void,
  { includeAddress = false }: { includeAddress?: boolean } = {},
): Promise<FillResult> {
  const fields = includeAddress ? buildGuestFields(profile) : buildContactFields(profile);
  return fillFieldsWithAI(stagehand, fields, trace);
}

/**
 * Fill arbitrary fields using stagehand.act().
 * Used internally and exported for ad-hoc use.
 */
export async function fillFieldsWithAI(
  stagehand: Actable,
  fields: Record<string, string>,
  trace: (msg: string) => void,
): Promise<FillResult> {
  const filled: string[] = [];
  const failed: string[] = [];

  for (const [label, value] of Object.entries(fields)) {
    if (!value) continue;
    const displayValue = label.toLowerCase().includes("card")
      ? value.replace(/\d(?=\d{4})/g, "*")
      : value;
    trace(`[fill-form] filling "${label}" = "${displayValue}"`);

    try {
      await stagehand.act(`Fill the ${label} field with "${value}"`);
      filled.push(label);
      await sleep(350);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace(`[fill-form] FAILED "${label}": ${msg.slice(0, 80)}`);
      failed.push(label);
    }
  }

  trace(`[fill-form] done — filled=${filled.length} failed=${failed.length}`);
  return { filled, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Form audit: detect empty fields after AI fill, then targeted re-fill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each visible form field reduced to what we need for matching.
 * The `desc` is a lower-cased concatenation of all identifying attributes.
 */
interface FieldAuditEntry {
  desc: string;   // name + id + placeholder + aria-label + <label> text, lowercased
  value: string;  // current DOM value
  type: string;   // input type: text | email | tel | select | textarea | ...
}

/** Scan all visible text-like inputs/selects/textareas on the page. */
async function scanFormFields(rawPage: Page): Promise<FieldAuditEntry[]> {
  return rawPage.evaluate(() => {
    const isVisible = (el: Element): boolean => {
      const s = window.getComputedStyle(el as HTMLElement);
      const r = (el as HTMLElement).getBoundingClientRect();
      return (
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        s.opacity !== "0" &&
        r.width > 0 &&
        r.height > 0
      );
    };

    const els = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        [
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
          ':not([type="submit"]):not([type="button"]):not([type="image"]):not([type="file"])',
          "select",
          "textarea",
        ].join("")
      )
    ).filter(isVisible);

    return els.map(el => {
      const name        = (el.getAttribute("name")         ?? "").toLowerCase();
      const id          = (el.id                           ?? "").toLowerCase();
      const placeholder = ((el as HTMLInputElement).placeholder ?? "").toLowerCase();
      const ariaLabel   = (el.getAttribute("aria-label")  ?? "").toLowerCase();
      const labelEl     = el.id
        ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`)
        : null;
      const labelText   = (labelEl?.textContent ?? "").trim().toLowerCase();
      const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase();

      const desc = [name, id, placeholder, ariaLabel, labelText, autocomplete]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const type  = el instanceof HTMLSelectElement  ? "select"
                  : el instanceof HTMLTextAreaElement ? "textarea"
                  : (el.type || "text");
      const value = el instanceof HTMLSelectElement
        ? (el.selectedIndex > 0 ? el.value : "")   // empty if nothing chosen
        : (el.value ?? "");

      return { desc, value, type };
    });
  }).catch(() => [] as FieldAuditEntry[]);
}

/**
 * Pattern list that maps field descriptions to EffectiveProfile keys.
 * Ordered from most-specific to least-specific.
 */
const PROFILE_PATTERNS: Array<{
  patterns: RegExp[];
  field: keyof EffectiveProfile;
  /** When true, only match if the input `type` matches this string */
  typeHint?: string;
}> = [
  // email — type hint takes priority
  { patterns: [/.*/],                                       field: "email",        typeHint: "email" },
  { patterns: [/e.?mail/],                                  field: "email" },
  // phone — type hint takes priority
  { patterns: [/.*/],                                       field: "phone",        typeHint: "tel" },
  { patterns: [/phone|mobile|cellular|tel(?:ephone)?/],     field: "phone" },
  // name — split before full
  { patterns: [/first.?name|given.?name|forename|firstname/],  field: "first_name" },
  { patterns: [/last.?name|family.?name|surname|lastname/],    field: "last_name" },
  { patterns: [/\bname\b|full.?name|your.?name/],              field: "full_name" },
  // address
  { patterns: [/address.?(line.?1|1)|street.?address|address1/], field: "address_line1" },
  { patterns: [/\bcity\b|\btown\b/],                           field: "city" },
  { patterns: [/\bstate\b|\bprovince\b|\bregion\b/],           field: "state" },
  { patterns: [/zip|postal.?code|postcode/],                   field: "zip" },
  { patterns: [/country/],                                     field: "country" },
];

/**
 * Try to match a field description + type to a profile value.
 * Returns [humanLabel, value] or null if no match / no profile data.
 */
function matchToProfile(
  desc: string,
  type: string,
  profile: EffectiveProfile,
): [string, string] | null {
  for (const { patterns, field, typeHint } of PROFILE_PATTERNS) {
    if (typeHint && type !== typeHint) continue;
    if (patterns.some(p => p.test(desc))) {
      const value = profile[field];
      if (value && typeof value === "string") {
        return [field.replace(/_/g, " "), value];
      }
    }
  }
  return null;
}

/**
 * After initial AI fill + JS fallbacks, scan the form for empty fields and
 * re-fill only those using targeted stagehand.act() calls.
 *
 * This catches fields that the AI skipped (wrong element focus, schema error,
 * element not visible during initial fill, etc.) without running a full RPA pass.
 *
 * Skipped field types:
 * - Selects (handled separately by React flush + RPA country select)
 * - Fields already containing a value
 * - Fields that don't map to any known profile key
 *
 * @returns list of field names that were refilled
 */
export async function auditAndRefillEmptyFields(
  stagehand: Actable,
  rawPage: Page,
  profile: EffectiveProfile,
  trace: (msg: string) => void,
): Promise<{ refilled: string[] }> {
  const entries = await scanFormFields(rawPage);

  // Build a deduplicated map of fieldLabel → value for empty fields only.
  // Skip selects (they're handled by the React flush + RPA country step).
  const toRefill: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.type === "select") continue;       // handled elsewhere
    if (entry.value.trim())      continue;       // already has a value
    if (!entry.desc)             continue;       // no identifying info

    const match = matchToProfile(entry.desc, entry.type, profile);
    if (!match) continue;

    const [label, value] = match;
    if (!toRefill[label]) {
      toRefill[label] = value;
    }
  }

  const count = Object.keys(toRefill).length;
  if (count === 0) {
    trace("[form-audit] all text fields have values — no targeted refill needed");
    return { refilled: [] };
  }

  trace(`[form-audit] ${count} empty field(s) detected: ${Object.keys(toRefill).join(", ")}`);
  const { filled } = await fillFieldsWithAI(stagehand, toRefill, trace);
  trace(`[form-audit] targeted refill done — refilled: ${filled.join(", ") || "none"}`);
  return { refilled: filled };
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}
