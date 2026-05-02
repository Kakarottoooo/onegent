/**
 * Per-field metadata: how to render, validate, and explain each field
 * the ProfileGapCard might ask for.
 *
 * Keep the map dense and the component dumb — no special-cases in
 * FieldRow.tsx. Adding a new field = adding one entry here.
 */

import type { FieldSensitivity, ProfileFieldId } from "./types";

export interface FieldDefinition {
  /** Stable id (matches the key on profile records / API). */
  id: ProfileFieldId;
  /** Form-row label, e.g. "Date of birth". */
  label: string;
  /** HTML input type — keeps the component switch trivial. */
  inputType: "text" | "email" | "tel" | "date" | "select";
  /** Helper text under the input (small, muted). */
  helper?: string;
  /** Placeholder copy when empty. */
  placeholder?: string;
  /** Sensitivity bucket — payment fields short-circuit to PaymentRedirect. */
  sensitivity: FieldSensitivity;
  /** Optional value list for select-type inputs. */
  options?: { value: string; label: string }[];
  /** Optional pure-fn validator. Returns an error message or undefined. */
  validate?: (value: string) => string | undefined;
}

/* ─── Validators ────────────────────────────────────────────────────────── */

const required = (label: string) => (v: string) =>
  v.trim().length === 0 ? `${label} is required` : undefined;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (v: string) =>
  v.trim().length === 0
    ? "Email is required"
    : !emailRe.test(v)
    ? "Enter a valid email"
    : undefined;

const phoneMinDigits = (v: string) => {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 0) return "Phone is required";
  if (digits.length < 7) return "Enter a valid phone number";
  return undefined;
};

const isPastDate = (v: string) => {
  if (!v) return "Date is required";
  const d = Date.parse(v);
  if (Number.isNaN(d)) return "Enter a valid date";
  if (d >= Date.now()) return "Date must be in the past";
  return undefined;
};

const isFutureDate = (v: string) => {
  if (!v) return "Date is required";
  const d = Date.parse(v);
  if (Number.isNaN(d)) return "Enter a valid date";
  if (d <= Date.now()) return "Date must be in the future";
  return undefined;
};

/* ─── Country options (short list — covers ~95% of bookings) ───────────── */

const COMMON_COUNTRIES = [
  "US",
  "CN",
  "GB",
  "CA",
  "MX",
  "JP",
  "KR",
  "IN",
  "AU",
  "FR",
  "DE",
  "IT",
  "ES",
  "BR",
  "SG",
  "TH",
  "TR",
  "AE",
] as const;

const countryOptions = COMMON_COUNTRIES.map((c) => ({ value: c, label: c }));

/* ─── Registry ─────────────────────────────────────────────────────────── */

export const FIELD_DEFINITIONS: Record<ProfileFieldId, FieldDefinition> = {
  // ── Personal ───────────────────────────────────────────────
  full_name: {
    id: "full_name",
    label: "Full name",
    inputType: "text",
    helper: "As it appears on your travel documents.",
    placeholder: "Jane Doe",
    sensitivity: "personal",
    validate: required("Name"),
  },
  email: {
    id: "email",
    label: "Email",
    inputType: "email",
    helper: "Used for booking confirmations.",
    placeholder: "you@example.com",
    sensitivity: "personal",
    validate: isEmail,
  },
  phone: {
    id: "phone",
    label: "Phone",
    inputType: "tel",
    helper: "Some venues require a phone number for SMS confirmations.",
    placeholder: "+1 555 555 5555",
    sensitivity: "personal",
    validate: phoneMinDigits,
  },

  // ── Travel documents ──────────────────────────────────────
  date_of_birth: {
    id: "date_of_birth",
    label: "Date of birth",
    inputType: "date",
    helper: "Required for flights — TSA needs this. Domestic + international.",
    sensitivity: "travel",
    validate: isPastDate,
  },
  passport_number: {
    id: "passport_number",
    label: "Passport number",
    inputType: "text",
    helper: "International flights only. Domestic US (e.g. JFK→LAX) doesn't need this.",
    placeholder: "A1234567",
    sensitivity: "travel",
    validate: required("Passport number"),
  },
  passport_expiry: {
    id: "passport_expiry",
    label: "Passport expiry",
    inputType: "date",
    helper: "Most countries require 6+ months validity at travel.",
    sensitivity: "travel",
    validate: isFutureDate,
  },
  passport_country: {
    id: "passport_country",
    label: "Country of issue",
    inputType: "select",
    options: countryOptions,
    sensitivity: "travel",
    validate: required("Country"),
  },
  ktn: {
    id: "ktn",
    label: "TSA Known Traveler Number",
    inputType: "text",
    helper: "Optional — speeds up US airport security.",
    placeholder: "9 digits",
    sensitivity: "travel",
  },

  // ── Address ───────────────────────────────────────────────
  address_line1: {
    id: "address_line1",
    label: "Street address",
    inputType: "text",
    placeholder: "123 Main St",
    sensitivity: "address",
    validate: required("Address"),
  },
  address_line2: {
    id: "address_line2",
    label: "Apt / suite",
    inputType: "text",
    placeholder: "Optional",
    sensitivity: "address",
  },
  city: {
    id: "city",
    label: "City",
    inputType: "text",
    sensitivity: "address",
    validate: required("City"),
  },
  state: {
    id: "state",
    label: "State / region",
    inputType: "text",
    sensitivity: "address",
  },
  zip: {
    id: "zip",
    label: "ZIP / postal code",
    inputType: "text",
    sensitivity: "address",
    validate: required("ZIP"),
  },
  country: {
    id: "country",
    label: "Country",
    inputType: "select",
    options: countryOptions,
    sensitivity: "address",
    validate: required("Country"),
  },

  // ── Payment (LOCKED — handled by PaymentRedirect, never inline) ──
  card_number: {
    id: "card_number",
    label: "Card number",
    inputType: "text",
    sensitivity: "payment",
  },
  card_expiry: {
    id: "card_expiry",
    label: "Card expiry",
    inputType: "text",
    sensitivity: "payment",
  },
  billing_address: {
    id: "billing_address",
    label: "Billing address",
    inputType: "text",
    sensitivity: "payment",
  },
};

/* ─── Helpers ──────────────────────────────────────────────────────────── */

export function isPaymentField(id: ProfileFieldId): boolean {
  return FIELD_DEFINITIONS[id].sensitivity === "payment";
}

/** Partition missing fields into (inline-collectable, payment-redirect). */
export function partitionMissing(
  missing: ProfileFieldId[],
): { inline: ProfileFieldId[]; payment: ProfileFieldId[] } {
  const inline: ProfileFieldId[] = [];
  const payment: ProfileFieldId[] = [];
  for (const id of missing) {
    if (isPaymentField(id)) payment.push(id);
    else inline.push(id);
  }
  return { inline, payment };
}
