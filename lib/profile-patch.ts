import {
  createBookingProfile,
  getDefaultBookingProfile,
  updateBookingProfile,
  type BookingProfileRow,
} from "@/lib/db";

export type ProfilePatch = {
  label?: string;
  is_default?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  date_of_birth?: string;
  nationality?: string;
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  known_traveler_number?: string;
};

export type ProfilePatchParseResult =
  | { ok: true; value: ProfilePatch; updatedFields: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: Record<string, string>;
      };
    };

const ALLOWED_FIELDS = new Set([
  "label",
  "is_default",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "address_line1",
  "city",
  "state",
  "zip",
  "country",
  "date_of_birth",
  "dob",
  "nationality",
  "passport_number",
  "passport_expiry",
  "passport_country",
  "known_traveler_number",
  "ktn",
]);

const PAYMENT_FIELDS = new Set([
  "card_number",
  "card_expiry",
  "card_name",
  "billing_address",
]);

export function parseProfilePatch(raw: unknown): ProfilePatchParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        code: "invalid_profile_patch",
        message: "Profile patch must be a JSON object.",
      },
    };
  }

  const source = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const patch: ProfilePatch = {};
  const updatedFields = new Set<string>();

  for (const key of Object.keys(source)) {
    if (PAYMENT_FIELDS.has(key)) {
      errors[key] = "Payment fields must be managed from the secure permissions/settings flow.";
      continue;
    }
    if (!ALLOWED_FIELDS.has(key)) {
      errors[key] = "Unknown profile field.";
    }
  }

  const fullName = stringField(source.full_name);
  if (fullName && !source.first_name && !source.last_name) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      patch.first_name = parts[0];
      patch.last_name = parts.slice(1).join(" ") || "";
      updatedFields.add("first_name");
      updatedFields.add("last_name");
    }
  }

  copyString(source, patch, updatedFields, errors, "label");
  copyBoolean(source, patch, updatedFields, errors, "is_default");
  copyRequiredString(source, patch, updatedFields, errors, "first_name", "First name");
  copyRequiredString(source, patch, updatedFields, errors, "last_name", "Last name");
  copyRequiredString(source, patch, updatedFields, errors, "email", "Email");
  copyRequiredString(source, patch, updatedFields, errors, "phone", "Phone");
  copyString(source, patch, updatedFields, errors, "address_line1");
  copyString(source, patch, updatedFields, errors, "city");
  copyString(source, patch, updatedFields, errors, "state");
  copyString(source, patch, updatedFields, errors, "zip");
  copyString(source, patch, updatedFields, errors, "country");
  copyString(source, patch, updatedFields, errors, "nationality");
  copyString(source, patch, updatedFields, errors, "passport_number");
  copyString(source, patch, updatedFields, errors, "passport_country");
  copyString(source, patch, updatedFields, errors, "known_traveler_number");

  if (source.ktn !== undefined && source.known_traveler_number === undefined) {
    const value = stringField(source.ktn);
    if (value === undefined) {
      errors.ktn = "KTN must be a string.";
    } else {
      patch.known_traveler_number = value;
      updatedFields.add("known_traveler_number");
    }
  }

  copyDate(source, patch, updatedFields, errors, "date_of_birth");
  if (source.dob !== undefined && source.date_of_birth === undefined) {
    const value = dateField(source.dob);
    if (!value.ok) errors.dob = value.error;
    else {
      patch.date_of_birth = value.value;
      updatedFields.add("date_of_birth");
    }
  }
  copyDate(source, patch, updatedFields, errors, "passport_expiry");

  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
    errors.email = "Enter a valid email.";
  }
  if (patch.phone && patch.phone.replace(/\D/g, "").length < 7) {
    errors.phone = "Enter a valid phone number.";
  }
  if (patch.date_of_birth) {
    const dob = new Date(`${patch.date_of_birth}T00:00:00Z`);
    if (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now()) {
      errors.date_of_birth = "Date of birth must be a past date.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      error: {
        code: "invalid_profile_patch",
        message: "Profile patch contains invalid fields.",
        fields: errors,
      },
    };
  }

  if (updatedFields.size === 0) {
    return {
      ok: false,
      error: {
        code: "empty_profile_patch",
        message: "Provide at least one profile field to update.",
      },
    };
  }

  return { ok: true, value: patch, updatedFields: [...updatedFields] };
}

export async function upsertDefaultBookingProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<BookingProfileRow> {
  const existing = await getDefaultBookingProfile(userId);
  if (existing) {
    const updated = await updateBookingProfile(existing.id, userId, patch);
    if (updated) return updated;
  }
  return createBookingProfile(userId, { label: "Personal", is_default: true, ...patch });
}

export function toPublicBookingProfile(profile: BookingProfileRow) {
  return {
    id: profile.id,
    label: profile.label,
    isDefault: profile.is_default,
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
    address_line1: profile.address_line1,
    city: profile.city,
    state: profile.state,
    zip: profile.zip,
    country: profile.country,
    date_of_birth: profile.date_of_birth,
    nationality: profile.nationality,
    passport_expiry: profile.passport_expiry,
    passport_country: profile.passport_country,
    known_traveler_number: profile.known_traveler_number,
  };
}

function copyString(
  source: Record<string, unknown>,
  patch: ProfilePatch,
  updatedFields: Set<string>,
  errors: Record<string, string>,
  key: keyof ProfilePatch,
) {
  if (source[key] === undefined) return;
  const value = stringField(source[key]);
  if (value === undefined) {
    errors[key] = `${key} must be a string.`;
    return;
  }
  patch[key] = value as never;
  updatedFields.add(key);
}

function copyRequiredString(
  source: Record<string, unknown>,
  patch: ProfilePatch,
  updatedFields: Set<string>,
  errors: Record<string, string>,
  key: keyof ProfilePatch,
  label: string,
) {
  if (source[key] === undefined) return;
  const value = stringField(source[key]);
  if (value === undefined || value.length === 0) {
    errors[key] = `${label} is required.`;
    return;
  }
  patch[key] = value as never;
  updatedFields.add(key);
}

function copyBoolean(
  source: Record<string, unknown>,
  patch: ProfilePatch,
  updatedFields: Set<string>,
  errors: Record<string, string>,
  key: "is_default",
) {
  if (source[key] === undefined) return;
  if (typeof source[key] !== "boolean") {
    errors[key] = `${key} must be a boolean.`;
    return;
  }
  patch[key] = source[key];
  updatedFields.add(key);
}

function copyDate(
  source: Record<string, unknown>,
  patch: ProfilePatch,
  updatedFields: Set<string>,
  errors: Record<string, string>,
  key: "date_of_birth" | "passport_expiry",
) {
  if (source[key] === undefined) return;
  const value = dateField(source[key]);
  if (!value.ok) {
    errors[key] = value.error;
    return;
  }
  patch[key] = value.value;
  updatedFields.add(key);
}

function stringField(value: unknown): string | undefined {
  if (value === null) return "";
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function dateField(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = stringField(value);
  if (text === undefined) return { ok: false, error: "Date must be a string." };
  if (text.length === 0) return { ok: true, value: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  }
  return { ok: true, value: text };
}
