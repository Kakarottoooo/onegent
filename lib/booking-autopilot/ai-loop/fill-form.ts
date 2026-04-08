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
 * Guest contact fields only (no payment data).
 * Maps EffectiveProfile fields → natural-language labels for stagehand.act().
 */
function buildGuestFields(p: EffectiveProfile): Record<string, string> {
  const fields: Record<string, string> = {};

  if (p.first_name) fields["first name"] = p.first_name;
  if (p.last_name)  fields["last name"]  = p.last_name;
  if (p.email)      fields["email address"] = p.email;
  if (p.phone)      fields["phone number"]  = p.phone;
  if (p.country)    fields["country"]       = p.country;

  // Billing address — optional, only include if present
  if (p.address_line1) fields["street address"] = p.address_line1;
  if (p.city)          fields["city"]            = p.city;
  if (p.state)         fields["state or province"] = p.state;
  if (p.zip)           fields["zip or postal code"] = p.zip;

  return fields;
}

/**
 * Fill guest contact form fields using stagehand.act() (AI-driven).
 * Skips empty fields. Returns lists of filled and failed field names.
 */
export async function fillGuestFormWithAI(
  stagehand: Actable,
  profile: EffectiveProfile,
  trace: (msg: string) => void,
): Promise<FillResult> {
  const fields = buildGuestFields(profile);
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
