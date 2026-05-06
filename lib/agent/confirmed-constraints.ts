import type {
  CategoryType,
  HotelIntent,
  MultilingualQueryContext,
  ParsedIntent,
} from "../types";

function readString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value)) return undefined;
  const clean = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return clean.length > 0 ? clean : undefined;
}

function inferInputLanguage(message: string): MultilingualQueryContext["input_language"] {
  const cjk = /[\u3040-\u30ff\u3400-\u9fff]/.test(message);
  const latin = /[A-Za-z]/.test(message);
  if (cjk && latin) return "mixed";
  if (cjk) return "zh";
  if (latin) return "en";
  return "unknown";
}

function inferOutputLanguage(message: string): MultilingualQueryContext["output_language"] {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(message) ? "zh" : "en";
}

function calcNights(checkIn?: string, checkOut?: string): number | undefined {
  if (!checkIn || !checkOut) return undefined;
  const start = new Date(`${checkIn}T00:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function buildConfirmedQueryContext(
  message: string,
  categoryHint: CategoryType,
  constraints: Record<string, unknown>,
  fallbackLocation?: string,
): MultilingualQueryContext {
  const location = readString(
    constraints,
    "location",
    "city",
    "hotel_city",
    "destination_city",
    "arrival_city",
  ) ?? fallbackLocation;
  const dateText = readString(constraints, "date", "date_from", "check_in", "departure_date", "event_date");

  return {
    input_language: inferInputLanguage(message),
    output_language: inferOutputLanguage(message),
    normalized_query: message.trim(),
    intent_summary: message.trim(),
    category_hint: categoryHint,
    scenario_hint: null,
    location_hint: location,
    date_text_hint: dateText,
  };
}

export function buildConfirmedHotelIntent(
  constraints: Record<string, unknown>,
  cityFullName: string,
): HotelIntent {
  const checkIn = readString(constraints, "check_in", "date", "date_from");
  const checkOut = readString(constraints, "check_out", "date_to", "end_date");
  const budgetPerNight = readNumber(
    constraints,
    "budget_per_night",
    "budget_max_per_night",
    "budget",
    "budget_max",
  );
  const guests = readNumber(constraints, "guests", "travelers", "party_size");
  const starRating = readNumber(constraints, "star_rating", "stars", "min_stars", "star_rating_min");

  const intent: HotelIntent = {
    category: "hotel",
    location:
      readString(constraints, "location", "city", "hotel_city", "destination_city") ??
      cityFullName,
    check_in: checkIn,
    check_out: checkOut,
    nights: readNumber(constraints, "nights") ?? calcNights(checkIn, checkOut),
    guests,
    star_rating: starRating,
    room_type: readString(constraints, "room_type"),
    amenities: readStringArray(constraints, "amenities"),
    neighborhood: readString(constraints, "neighborhood", "area", "hotel_neighborhood"),
    purpose: readString(constraints, "purpose"),
    constraints: readStringArray(constraints, "constraints"),
    priorities: readStringArray(constraints, "priorities"),
  };

  if (budgetPerNight !== undefined) {
    intent.budget_per_person = budgetPerNight;
  }

  return intent;
}

export function buildConfirmedIntentFromConstraints(
  categoryHint: CategoryType | undefined,
  constraints: Record<string, unknown> | undefined,
  cityFullName: string,
): ParsedIntent | null {
  if (!constraints || categoryHint !== "hotel") return null;
  return buildConfirmedHotelIntent(constraints, cityFullName);
}
