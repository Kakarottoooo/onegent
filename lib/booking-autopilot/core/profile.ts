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
};

export function extractTargetHotelName(task: string): string | undefined {
  const patterns = [
    /book\s+["“](.+?)["”]\s+for/i,
    /book\s+'(.+?)'\s+for/i,
    /find\s+(.+?)\s+hotel\s+in\s+.+?\s+and\s+book/i,
    /book a room at\s+(.+?)(?:\.|preferred|check-?in|check in|$)/i,
    /hotel\s*:\s*(.+?)(?:\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = task.match(pattern)?.[1]?.trim();
    if (match) return match;
  }

  return undefined;
}

export function extractTargetHotelNameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const ss = parsed.searchParams.get("ss")?.trim();
    if (ss) return ss;
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
