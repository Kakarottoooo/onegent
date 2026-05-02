import type { BookingProfile } from "@/lib/booking-autopilot/types";
import type {
  ExecutionParams,
  NeedsProfileDataPayload,
  ProfileFieldId,
} from "./types";

const COMMON_REQUIRED_FIELDS: readonly ProfileFieldId[] = [
  "first_name",
  "last_name",
  "email",
  "phone",
];

const ADDRESS_REQUIRED_FIELDS: readonly ProfileFieldId[] = [
  "address_line1",
  "city",
  "state",
  "zip",
  "country",
];

const PASSPORT_REQUIRED_FIELDS: readonly ProfileFieldId[] = [
  "passport_number",
  "passport_expiry",
  "passport_country",
];

// Broad enough for common Onegent routes; conservative unknowns do not require passport.
const US_AIRPORT_CODES = new Set([
  "ABE", "ABQ", "ACK", "ALB", "ANC", "ATL", "AUS", "BDL", "BHM", "BNA",
  "BOI", "BOS", "BUF", "BUR", "BWI", "CHS", "CLE", "CLT", "CMH", "CVG",
  "DAL", "DCA", "DEN", "DFW", "DTW", "EGE", "EWR", "FLL", "GEG", "HNL",
  "HOU", "HPN", "IAD", "IAH", "IND", "JAC", "JAX", "JFK", "KOA", "LAS",
  "LAX", "LGA", "LIH", "MCI", "MCO", "MDW", "MEM", "MHT", "MIA", "MKE",
  "MSN", "MSP", "MSY", "OAK", "OGG", "OKC", "OMA", "ONT", "ORD", "ORF",
  "PBI", "PDX", "PHL", "PHX", "PIT", "PNS", "PSP", "PWM", "RDU", "RIC",
  "RNO", "ROC", "RSW", "SAN", "SAT", "SAV", "SDF", "SEA", "SFO", "SJC",
  "SJU", "SLC", "SMF", "SNA", "STL", "TPA", "TUS",
]);

const US_CITY_HINTS = [
  "atlanta", "austin", "boston", "chicago", "dallas", "denver", "houston",
  "las vegas", "los angeles", "miami", "nashville", "new york", "orlando",
  "philadelphia", "phoenix", "san diego", "san francisco", "seattle",
  "washington", "washington dc",
];

const INTERNATIONAL_HINTS = [
  "amsterdam", "athens", "bangkok", "barcelona", "beijing", "berlin",
  "cancun", "dubai", "dublin", "hong kong", "istanbul", "london", "madrid",
  "mexico city", "milan", "montreal", "munich", "paris", "rome", "seoul",
  "shanghai", "singapore", "taipei", "tokyo", "toronto", "vancouver",
];

export function buildProfileGap(
  execution: ExecutionParams,
  profile: BookingProfile,
): NeedsProfileDataPayload | null {
  const required = new Set<ProfileFieldId>(COMMON_REQUIRED_FIELDS);

  switch (execution.scenario) {
    case "hotel":
    case "activity":
      for (const field of ADDRESS_REQUIRED_FIELDS) required.add(field);
      break;
    case "flight":
      required.add("date_of_birth");
      if (isInternationalFlight(execution.params.origin, execution.params.dest)) {
        for (const field of PASSPORT_REQUIRED_FIELDS) required.add(field);
      }
      break;
    case "restaurant":
      break;
  }

  const missing = [...required].filter((field) => !hasProfileValue(profile, field));
  if (missing.length === 0) return null;

  const message = buildProfileGapMessage(execution.scenario, missing);
  return {
    kind: "needs_profile_data",
    scenario: execution.scenario,
    missing,
    message,
  };
}

function hasProfileValue(profile: BookingProfile, field: ProfileFieldId): boolean {
  const value = profile[field as keyof BookingProfile];
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function buildProfileGapMessage(
  scenario: ExecutionParams["scenario"],
  missing: readonly ProfileFieldId[],
): string {
  const label = scenarioLabel(scenario);
  return `I need your ${formatMissingFields(missing)} to continue this ${label} booking. Add it to your booking profile, then retry.`;
}

function scenarioLabel(scenario: ExecutionParams["scenario"]): string {
  switch (scenario) {
    case "restaurant":
      return "restaurant";
    case "hotel":
      return "hotel";
    case "flight":
      return "flight";
    case "activity":
      return "activity";
  }
}

function formatMissingFields(fields: readonly ProfileFieldId[]): string {
  return fields.map((field) => field.replace(/_/g, " ")).join(", ");
}

function isInternationalFlight(origin: string, dest: string): boolean {
  const originCode = parseIataCode(origin);
  const destCode = parseIataCode(dest);
  if (originCode && destCode) {
    return !US_AIRPORT_CODES.has(originCode) || !US_AIRPORT_CODES.has(destCode);
  }

  const originText = normalizeLocation(origin);
  const destText = normalizeLocation(dest);
  if (hasAnyHint(originText, INTERNATIONAL_HINTS) || hasAnyHint(destText, INTERNATIONAL_HINTS)) {
    return true;
  }

  if (hasUsHint(originText) && hasUsHint(destText)) {
    return false;
  }

  return false;
}

function parseIataCode(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const exact = /^[A-Z]{3}$/.exec(trimmed);
  if (exact) return trimmed;
  const match = /\b[A-Z]{3}\b/.exec(trimmed);
  return match ? match[0] : null;
}

function normalizeLocation(value: string): string {
  return value.trim().toLowerCase();
}

function hasUsHint(value: string): boolean {
  return hasAnyHint(value, US_CITY_HINTS) || value.includes("united states") || /\busa\b/.test(value);
}

function hasAnyHint(value: string, hints: readonly string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}
