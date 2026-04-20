import { FlightIntent, FlightRecommendationCard, Flight } from "../../types";
import { searchFlights, resolveMultiAirport } from "../../tools";

// ─── G-1: Time-of-day filtering helpers ───────────────────────────────────────

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function filterByTime(flights: Flight[], intent: FlightIntent): Flight[] {
  const avoidRedEye = intent.avoid_red_eye;
  const earliest = intent.earliest_departure ? parseHHMM(intent.earliest_departure) : null;
  const latest = intent.latest_departure ? parseHHMM(intent.latest_departure) : null;

  if (!avoidRedEye && earliest === null && latest === null) return flights;

  const filtered = flights.filter((f) => {
    // SerpAPI returns departure_time as "10:30 AM" or "HH:MM" — normalise
    if (!f.departure_time) return true; // no data, keep
    let minutes: number;
    if (f.departure_time.toUpperCase().includes("PM") || f.departure_time.toUpperCase().includes("AM")) {
      // 12-hour format
      const [hm, period] = f.departure_time.split(/\s+/);
      const [hh, mm] = hm.split(":").map(Number);
      let hour = hh % 12;
      if (period?.toUpperCase() === "PM") hour += 12;
      minutes = hour * 60 + (mm ?? 0);
    } else {
      const raw = f.departure_time.trim();
      minutes = parseHHMM(raw);
    }
    if (avoidRedEye && minutes >= 0 && minutes < 6 * 60) return false;
    if (earliest !== null && minutes < earliest) return false;
    if (latest !== null && minutes > latest) return false;
    return true;
  });

  // Never return empty — fall back to unfiltered if all flights are filtered out
  return filtered.length > 0 ? filtered : flights;
}

// ─── Phase 8: Flight Pipeline ─────────────────────────────────────────────────

export async function runFlightPipeline(
  intent: FlightIntent,
): Promise<{ flightRecommendations: FlightRecommendationCard[]; missing_fields: string[]; no_direct_available: boolean }> {
  // Check required fields
  const missing: string[] = [];
  if (!intent.departure_city) missing.push("departure city");
  if (!intent.arrival_city) missing.push("destination city");
  if (!intent.date) missing.push("travel date");

  console.log("[flight-pipeline] intent:", JSON.stringify({ dep: intent.departure_city, arr: intent.arrival_city, date: intent.date, prefer_direct: intent.prefer_direct }));

  if (missing.length > 0) {
    console.log("[flight-pipeline] missing fields:", missing);
    return { flightRecommendations: [], missing_fields: missing, no_direct_available: false };
  }

  const searchParams = {
    arrival_city: intent.arrival_city!,
    date: intent.date!,
    return_date: intent.return_date,
    is_round_trip: intent.is_round_trip,
    passengers: intent.passengers,
    cabin_class: intent.cabin_class,
    prefer_direct: intent.prefer_direct,
    max_stops: intent.max_stops,
  };

  // Multi-airport city handling: search primary airport + cheapest from alternates
  const depMulti = resolveMultiAirport(intent.departure_city!);
  const arrMulti = resolveMultiAirport(intent.arrival_city!);

  let flights: Flight[];

  if (depMulti && depMulti.all.length > 1) {
    // Parallel search: primary airport + each alternate airport
    const alternates = depMulti.all.filter((code) => code !== depMulti.primary);
    const [primaryFlights, ...altFlightGroups] = await Promise.all([
      searchFlights({ ...searchParams, departure_city: depMulti.primary, maxResults: 8 }),
      ...alternates.map((alt) =>
        searchFlights({ ...searchParams, departure_city: alt, maxResults: 4 })
      ),
    ]);

    // Take best 5 from primary airport
    const primaryBest = primaryFlights.slice(0, 5);

    // Find cheapest flight from any alternate airport (only if cheaper than primary cheapest)
    const primaryCheapest = primaryFlights.reduce((min, f) => (f.price > 0 && f.price < min ? f.price : min), Infinity);
    const allAltFlights = altFlightGroups.flat().filter((f) => f.price > 0);
    const cheapestAlt = allAltFlights.sort((a, b) => a.price - b.price)[0];

    if (cheapestAlt && cheapestAlt.price < primaryCheapest) {
      flights = [...primaryBest, cheapestAlt];
    } else {
      // Also add a 1-stop / 2-stop from alternates if available
      const altOneStop = allAltFlights.find((f) => f.stops === 1);
      flights = altOneStop ? [...primaryBest, altOneStop] : primaryBest;
    }
  } else if (arrMulti && arrMulti.all.length > 1) {
    // Multi-airport arrival (less common but handled symmetrically)
    const [primaryFlights, ...altFlightGroups] = await Promise.all([
      searchFlights({ ...searchParams, departure_city: intent.departure_city!, arrival_city: arrMulti.primary, maxResults: 8 }),
      ...arrMulti.all
        .filter((c) => c !== arrMulti.primary)
        .map((alt) =>
          searchFlights({ ...searchParams, departure_city: intent.departure_city!, arrival_city: alt, maxResults: 4 })
        ),
    ]);
    const primaryBest = primaryFlights.slice(0, 5);
    const allAltFlights = altFlightGroups.flat().filter((f) => f.price > 0);
    const cheapestAlt = allAltFlights.sort((a, b) => a.price - b.price)[0];
    const primaryCheapest = primaryFlights.reduce((min, f) => (f.price > 0 && f.price < min ? f.price : min), Infinity);
    flights = cheapestAlt && cheapestAlt.price < primaryCheapest
      ? [...primaryBest, cheapestAlt]
      : primaryBest;
  } else {
    flights = await searchFlights({
      ...searchParams,
      departure_city: intent.departure_city!,
      maxResults: 8,
    });
  }

  // Apply time-of-day filters (red-eye avoidance, departure window)
  flights = filterByTime(flights, intent);

  if (flights.length === 0) {
    return { flightRecommendations: [], missing_fields: [], no_direct_available: false };
  }

  const wantedNonstop = intent.prefer_direct === true || intent.max_stops === 0;
  const no_direct_available = wantedNonstop && flights.every((f) => f.stops > 0);

  // Identify cheapest flight (only when not filtering by stop preference)
  const isFiltered = wantedNonstop || intent.max_stops === 1;
  const cheapestId = !isFiltered && flights.length > 0
    ? flights.filter(f => f.price > 0).sort((a, b) => a.price - b.price)[0]?.id
    : null;

  const cards: FlightRecommendationCard[] = flights.map((flight, i) => {
    const isCheapest = !isFiltered && flight.id === cheapestId;
    const group: FlightRecommendationCard["group"] = isCheapest
      ? "cheapest"
      : flight.stops === 0 ? "direct" : flight.stops === 1 ? "one_stop" : "two_stop";

    const why = isCheapest
      ? `Lowest price found — $${flight.price}${flight.stops > 0 ? ` with ${flight.stops} stop${flight.stops > 1 ? "s" : ""}` : ", nonstop"}`
      : flight.stops === 0
      ? `Nonstop flight — fastest option at ${flight.duration}`
      : flight.stops === 1
      ? `1 stop via ${flight.layover_city ?? "connecting city"} (${flight.layover_duration ?? ""} layover)`
      : `${flight.stops} stops — most affordable option`;

    return {
      flight,
      rank: i + 1,
      group,
      why_recommended: why,
    };
  });

  return { flightRecommendations: cards, missing_fields: [], no_direct_available };
}
