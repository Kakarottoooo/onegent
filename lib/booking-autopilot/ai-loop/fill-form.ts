/**
 * fill-form.ts — Phase 3: AI-driven guest form filling.
 *
 * Replaces the hardcoded Booking.com selector approach with
 * stagehand.act() calls for each field. Works on any website.
 *
 * Payment fields (card_number, card_expiry, CVV) are intentionally
 * excluded — the flow stops before payment so the user completes it.
 */

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

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}
