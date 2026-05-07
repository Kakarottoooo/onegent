import type { ConversationalScenario } from "@/lib/agent/nlu-v2";

function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBool(obj: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (/^(true|yes|1|round.?trip)$/i.test(value)) return true;
      if (/^(false|no|0|one.?way)$/i.test(value)) return false;
    }
  }
  return null;
}

function buildFlightPlanQuery(constraints: Record<string, unknown>): string {
  const origin = readString(constraints, "departure_city", "origin", "origin_city", "origin_airport", "from_city");
  const destination = readString(constraints, "arrival_city", "dest", "destination", "destination_city", "dest_airport", "to_city");
  const date = readString(constraints, "date", "departure_date", "date_from");
  const returnDate = readString(constraints, "return_date", "date_to");
  const passengers = readNumber(constraints, "passengers", "travelers", "party_size", "guests");
  const cabinClass = readString(constraints, "cabin_class", "cabin");
  const roundTrip = readBool(constraints, "is_round_trip", "round_trip");
  const preferDirect = readBool(constraints, "prefer_direct", "nonstop", "direct");

  const parts = ["Find a flight"];
  if (origin && destination) {
    parts.push(`from ${origin} to ${destination}`);
  } else if (destination) {
    parts.push(`to ${destination}`);
  } else if (origin) {
    parts.push(`from ${origin}`);
  }
  if (date) parts.push(`on ${date}`);
  if (returnDate) parts.push(`returning ${returnDate}`);
  if (passengers) parts.push(`for ${passengers} ${passengers === 1 ? "passenger" : "passengers"}`);
  if (cabinClass) parts.push(`in ${cabinClass} class`);
  if (roundTrip === true) parts.push("round trip");
  if (roundTrip === false) parts.push("one way");
  if (preferDirect === true) parts.push("nonstop if available");
  return parts.join(" ").trim();
}

function buildActivityPlanQuery(constraints: Record<string, unknown>): string {
  const eventName = readString(constraints, "event_name", "activity_name", "title", "name");
  const eventType = readString(constraints, "event_type", "activity_type", "genre", "category");
  const city = readString(constraints, "city", "venue_city", "location");
  const date = readString(constraints, "event_date", "date", "date_from", "event_date_from");
  const tickets = readNumber(constraints, "num_tickets", "tickets", "quantity", "party_size", "travelers");

  const parts = ["Find tickets"];
  if (eventName) {
    parts.push(`for ${eventName}`);
    if (eventType) parts.push(eventType);
  } else if (eventType) {
    parts.push(`for a ${eventType} event`);
  } else {
    parts.push("for an event");
  }
  if (city) parts.push(`in ${city}`);
  if (date) parts.push(`on ${date}`);
  if (tickets) parts.push(`for ${tickets} ${tickets === 1 ? "ticket" : "tickets"}`);
  return parts.join(" ").trim();
}

export function buildPlanQueryFromConstraints(
  scenario: ConversationalScenario,
  constraints: Record<string, unknown>,
): string {
  if (scenario === "flight") return buildFlightPlanQuery(constraints);
  if (scenario === "activity") return buildActivityPlanQuery(constraints);

  const city = readString(constraints, "city", "hotel_city", "arrival_city");
  const date = readString(constraints, "date", "check_in", "departure_date");
  const cuisine = readString(constraints, "cuisine", "cuisine_hint");
  const pieces: string[] = [];
  if (scenario === "restaurant") {
    pieces.push(cuisine ? `Find a ${cuisine} restaurant` : "Find a restaurant");
  } else if (scenario === "hotel") {
    pieces.push("Find a hotel");
  } else {
    pieces.push("Plan a trip");
  }
  if (city) pieces.push(`in ${city}`);
  if (date) pieces.push(`on ${date}`);
  return pieces.join(" ").trim();
}
