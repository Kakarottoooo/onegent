import type { BrowserTaskInput } from "../types";

export type EffectiveProfile = {
  full_name?: string;
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
  // Travel documents
  date_of_birth?: string;
  nationality?: string;
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  known_traveler_number?: string;
  driver_license_number?: string;
  driver_license_state?: string;
};

export function extractTargetHotelName(task: string): string | undefined {
  const patterns = [
    /book\s+[“”](.+?)[“”]\s+for/i,
    /book\s+'(.+?)'\s+for/i,
    /find\s+(.+?)\s+hotel\s+in\s+.+?\s+and\s+book/i,
    /book a room at\s+(.+?)(?:\.|preferred|check-?in|check in|$)/i,
    /hotel\s*:\s*(.+?)(?:\n|$)/i,
    // Restaurant patterns: “Find Urban Grub restaurant in Nashville and book a table”
    /find\s+(.+?)\s+restaurant\s+in\s+.+?\s+and\s+book/i,
    /reservation\s+at\s+(.+?)(?:\.|,|$)/i,
    /book\s+a\s+table\s+at\s+(.+?)(?:\.|,|for)/i,
    /make\s+a\s+reservation\s+at\s+(.+?)(?:\.|,|$)/i,
  ];

  for (const pattern of patterns) {
    const match = task.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  return undefined;
}

function normalizeTargetCity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .trim()
    .replace(/^[,\s]+|[,\s.]+$/g, "")
    .replace(/\s+/g, " ");
  return cleaned || undefined;
}

export function extractTargetCity(task: string): string | undefined {
  const explicitCity = normalizeTargetCity(extractTaskField(task, "City"));
  if (explicitCity) return explicitCity;

  const patterns = [
    /restaurant\s+in\s+(.+?)\s+and\s+book/i,
    /hotel\s+in\s+(.+?)\s+and\s+book/i,
    /reservation\s+at\s+.+?\s+in\s+(.+?)(?:\.|,|$)/i,
    /book\s+a\s+table\s+at\s+.+?\s+in\s+(.+?)(?:\.|,|for|$)/i,
    /make\s+a\s+reservation\s+at\s+.+?\s+in\s+(.+?)(?:\.|,|$)/i,
  ];

  for (const pattern of patterns) {
    const match = normalizeTargetCity(task.match(pattern)?.[1]);
    if (match) return match;
  }

  return undefined;
}

export function extractTargetHotelNameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const ss = parsed.searchParams.get('ss')?.trim();
    if (ss) return ss;
    const term = parsed.searchParams.get('term')?.trim();
    if (term) return term;
  } catch {
    // Ignore invalid URLs.
  }
  return undefined;
}

export function extractTaskField(task: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = task.match(new RegExp(`(?:^|\\n)\\s*-?\\s*${escapedLabel}\\s*:\\s*(.+)`, "im"));
  return match?.[1]?.trim() || undefined;
}

export function splitFullName(fullName?: string): { first_name?: string; last_name?: string } {
  if (!fullName) return {};
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first_name: parts[0] };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts.at(-1),
  };
}

export function buildEffectiveProfile(
  profile: BrowserTaskInput["profile"],
  task: string
): EffectiveProfile {
  const taskFullName = extractTaskField(task, "Full name");
  const taskCardholderName = extractTaskField(task, "Cardholder name");
  const splitName = splitFullName(taskFullName);

  const merged: EffectiveProfile = {
    full_name: taskFullName || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || undefined,
    first_name: profile.first_name || splitName.first_name,
    last_name: profile.last_name || splitName.last_name,
    email: profile.email || extractTaskField(task, "Email"),
    phone: profile.phone || extractTaskField(task, "Phone"),
    address_line1: profile.address_line1 || extractTaskField(task, "Street"),
    city: profile.city || extractTaskField(task, "City"),
    state: profile.state || extractTaskField(task, "State"),
    zip: profile.zip || extractTaskField(task, "ZIP"),
    country: profile.country || extractTaskField(task, "Country"),
    card_name: profile.card_name || taskCardholderName || taskFullName,
    card_number: profile.card_number || extractTaskField(task, "Card number"),
    card_expiry: profile.card_expiry || extractTaskField(task, "Expiry date"),
    // Travel documents
    date_of_birth: profile.date_of_birth,
    nationality: profile.nationality,
    passport_number: profile.passport_number,
    passport_expiry: profile.passport_expiry,
    passport_country: profile.passport_country,
    known_traveler_number: profile.known_traveler_number,
    driver_license_number: profile.driver_license_number,
    driver_license_state: profile.driver_license_state,
  };

  if (!merged.full_name) {
    merged.full_name = [merged.first_name, merged.last_name].filter(Boolean).join(" ") || undefined;
  }

  if (merged.phone) {
    const digits = merged.phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
      merged.phone = digits.slice(1);
    }
  }

  return merged;
}
