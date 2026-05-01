/**
 * Pre-filled deep link URL builders for booking actions.
 *
 * Each builder accepts optional structured fields (dates, guests, city)
 * from parsed intent and returns a URL that lands on a filtered results
 * page — not a generic homepage.
 */

/** Parse "YYYY-MM-DD" into year/month/day parts for query params. */
function parseDateParts(
  date: string
): { year: string; month: string; day: string } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: m[1],
    month: String(parseInt(m[2], 10)),
    day: String(parseInt(m[3], 10)),
  };
}

export interface GoogleHotelsOpts {
  hotelName?: string;
  city: string;
  checkin?: string; // YYYY-MM-DD
  checkout?: string; // YYYY-MM-DD
  adults?: number;
}

/**
 * Build a Google Hotels search URL pre-filled with city, dates, and guests.
 * Format: /travel/hotels?q={query}&dates={checkin}/{checkout}&adults={n}
 */
export function buildGoogleHotelsUrl(opts: GoogleHotelsOpts): string {
  const q = opts.hotelName
    ? `${opts.hotelName} ${opts.city}`
    : `hotels in ${opts.city}`;
  const params: Record<string, string> = { q };
  if (opts.checkin && opts.checkout) {
    params.dates = `${opts.checkin}/${opts.checkout}`;
  } else if (opts.checkin) {
    params.dates = opts.checkin;
  }
  if (opts.adults) params.adults = String(opts.adults);
  return `https://www.google.com/travel/hotels?${new URLSearchParams(params).toString()}`;
}

export interface BookingComOpts {
  hotelName?: string;
  city: string;
  checkin?: string; // YYYY-MM-DD
  checkout?: string; // YYYY-MM-DD
  adults?: number;
  rooms?: number;
}

/**
 * Build a Booking.com search URL pre-filled with city, checkin/checkout
 * dates, and number of adults.
 */
export function buildBookingComUrl(opts: BookingComOpts): string {
  const searchString = opts.hotelName
    ? `${opts.hotelName} ${opts.city}`.trim()
    : opts.city;
  const params: Record<string, string> = { ss: searchString };
  if (opts.checkin) {
    const d = parseDateParts(opts.checkin);
    if (d) {
      params.checkin_year = d.year;
      params.checkin_month = d.month;
      params.checkin_monthday = d.day;
    }
  }
  if (opts.checkout) {
    const d = parseDateParts(opts.checkout);
    if (d) {
      params.checkout_year = d.year;
      params.checkout_month = d.month;
      params.checkout_monthday = d.day;
    }
  }
  if (opts.adults) params.group_adults = String(opts.adults);
  if (opts.rooms) params.no_rooms = String(opts.rooms);
  // Use searchresults.html — the search.html endpoint can redirect to city/region pages
  // when the hotel name isn't found, whereas searchresults.html always stays on the results list.
  return `https://www.booking.com/searchresults.html?${new URLSearchParams(params).toString()}`;
}

/** Build an Expedia hotel search URL. */
export function buildExpediaUrl(opts: BookingComOpts): string {
  const dest = opts.hotelName ? `${opts.hotelName} ${opts.city}`.trim() : opts.city;
  const params: Record<string, string> = { destination: dest };
  if (opts.checkin)  params.startDate = opts.checkin;
  if (opts.checkout) params.endDate   = opts.checkout;
  if (opts.adults)   params.adults    = String(opts.adults);
  params.rooms = String(opts.rooms ?? 1);
  return `https://www.expedia.com/Hotel-Search?${new URLSearchParams(params).toString()}`;
}

/** Build a Hotels.com hotel search URL. */
export function buildHotelsComUrl(opts: BookingComOpts): string {
  const dest = opts.hotelName ? `${opts.hotelName} ${opts.city}`.trim() : opts.city;
  const params: Record<string, string> = { destination: dest };
  if (opts.checkin)  params.startDate = opts.checkin;
  if (opts.checkout) params.endDate   = opts.checkout;
  if (opts.adults)   params.adults    = String(opts.adults);
  params.rooms = String(opts.rooms ?? 1);
  return `https://www.hotels.com/search?${new URLSearchParams(params).toString()}`;
}

export interface GoogleFlightsOpts {
  origin: string; // IATA airport code preferred (e.g. "BNA"), city name as fallback
  dest: string; // IATA airport code preferred (e.g. "LAX"), city name as fallback
  date?: string; // YYYY-MM-DD (outbound)
  returnDate?: string; // YYYY-MM-DD (return leg) — omit for one-way
  passengers?: number; // number of adult passengers (default 1)
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

/**
 * Google Flights `#flt=` fragment format is deprecated — it only partially
 * fills the search form (origin city only). Use buildKayakFlightsUrl instead
 * for fully pre-filled searches.
 *
 * Kept for tests and as a fallback when IATA codes are unavailable.
 */
export function buildGoogleFlightsUrl(opts: GoogleFlightsOpts): string {
  if (opts.date) {
    const leg1 = `${opts.origin}.${opts.dest}.${opts.date}`;
    const leg2 = opts.returnDate
      ? `${opts.dest}.${opts.origin}.${opts.returnDate}`
      : "";
    const legs = [leg1, leg2].filter(Boolean).join("*");
    return `https://www.google.com/flights?hl=en#flt=${legs};c:USD;e:1`;
  }
  const q = `Flights from ${opts.origin} to ${opts.dest}`;
  return `https://www.google.com/travel/flights?${new URLSearchParams({ q }).toString()}`;
}

/** Kayak cabin class URL segments */
const KAYAK_CABIN: Record<string, string> = {
  economy: "economy",
  premium_economy: "premium",
  business: "business",
  first: "first",
};

/**
 * Build a Kayak flight search URL fully pre-filled with origin, destination,
 * dates, passenger count, and cabin class.
 *
 * Format (round trip):
 *   https://www.kayak.com/flights/{ORIG}-{DEST}/{DEP_DATE}/{RET_DATE}/{N}adults/{cabin}
 * Format (one way):
 *   https://www.kayak.com/flights/{ORIG}-{DEST}/{DEP_DATE}/{N}adults/{cabin}
 *
 * Requires IATA airport codes (BNA, LAX, etc.).
 * All fields land on a fully-filtered results page — user can go straight to booking.
 */
export function buildKayakFlightsUrl(opts: GoogleFlightsOpts): string {
  const orig = opts.origin.toUpperCase();
  const dest = opts.dest.toUpperCase();
  const cabin = KAYAK_CABIN[opts.cabinClass ?? "economy"] ?? "economy";
  const pax = opts.passengers ?? 1;

  if (!opts.date) {
    // No date — use search query fallback on Kayak explore page
    return `https://www.kayak.com/flights/${orig}-${dest}`;
  }

  const paxPart = `${pax}adults`;
  if (opts.returnDate) {
    return `https://www.kayak.com/flights/${orig}-${dest}/${opts.date}/${opts.returnDate}/${paxPart}/${cabin}`;
  }
  return `https://www.kayak.com/flights/${orig}-${dest}/${opts.date}/${paxPart}/${cabin}`;
}

/**
 * Build an Expedia flight search URL — mirrors the startUrl our booking-autopilot
 * RPA constructs (see app/api/booking-jobs/[id]/start/route.ts). Keeping user-
 * facing "View details" links on the same platform the agent books on means
 * what the user sees pre-booking matches what the agent automates.
 *
 * Pattern:
 *   https://www.expedia.com/Flights-Search?trip={oneway|roundtrip}
 *     &leg1=from:{ORIG},to:{DEST},departure:{DATE}TANYT
 *     [&leg2=from:{DEST},to:{ORIG},departure:{RET}TANYT]
 *     &passengers=adults:{N}
 *     &options=cabinclass:{coach|premiumcoach|business|first}
 *     &mode=search
 */
const EXPEDIA_CABIN: Record<string, string> = {
  economy: "coach",
  premium_economy: "premiumcoach",
  business: "business",
  first: "first",
};
export function buildExpediaFlightsUrl(opts: GoogleFlightsOpts): string {
  const orig = opts.origin.toUpperCase();
  const dest = opts.dest.toUpperCase();
  const pax = opts.passengers ?? 1;
  const cabin = EXPEDIA_CABIN[opts.cabinClass ?? "economy"] ?? "coach";

  if (!opts.date) {
    return `https://www.expedia.com/Flights`;
  }

  const trip = opts.returnDate ? "roundtrip" : "oneway";
  const leg1 = `from:${orig},to:${dest},departure:${opts.date}TANYT`;
  const leg2 = opts.returnDate ? `&leg2=from:${dest},to:${orig},departure:${opts.returnDate}TANYT` : "";
  return `https://www.expedia.com/Flights-Search?trip=${trip}&leg1=${leg1}${leg2}&passengers=adults:${pax}&options=cabinclass:${cabin}&mode=search`;
}

/** Booking.com flights cabin class values */
const BOOKING_FLIGHTS_CABIN: Record<string, string> = {
  economy: "ECONOMY",
  premium_economy: "PREMIUM_ECONOMY",
  business: "BUSINESS",
  first: "FIRST",
};

/**
 * Build a Booking.com Flights search URL fully pre-filled.
 *
 * Pattern (round trip):
 *   https://flights.booking.com/flights/{ORIG}-{DEST}/?type=ROUNDTRIP
 *     &adults={N}&cabinClass={ECONOMY|...}
 *     &from={ORIG}.AIRPORT&to={DEST}.AIRPORT
 *     &depart={YYYY-MM-DD}&return={YYYY-MM-DD}&sort=BEST
 *
 * Booking.com flights deep links auto-fill the search form and show results
 * directly — no Akamai bot blocking on URL-level access (unlike Expedia).
 */
export function buildBookingFlightsUrl(opts: GoogleFlightsOpts): string {
  const orig = opts.origin.toUpperCase();
  const dest = opts.dest.toUpperCase();
  const pax = opts.passengers ?? 1;
  const cabin = BOOKING_FLIGHTS_CABIN[opts.cabinClass ?? "economy"] ?? "ECONOMY";

  if (!opts.date) {
    return `https://flights.booking.com/flights/${orig}-${dest}/`;
  }

  const tripType = opts.returnDate ? "ROUNDTRIP" : "ONEWAY";
  const params: Record<string, string> = {
    type: tripType,
    adults: String(pax),
    cabinClass: cabin,
    from: `${orig}.AIRPORT`,
    to: `${dest}.AIRPORT`,
    depart: opts.date,
    sort: "BEST",
  };
  if (opts.returnDate) params.return = opts.returnDate;

  return `https://flights.booking.com/flights/${orig}-${dest}/?${new URLSearchParams(params).toString()}`;
}

// ── Airline-specific deep links ──────────────────────────────────────────────

export interface AirlineDeepLinkOpts {
  airline: string;         // airline name as returned by SerpAPI (e.g. "Delta", "Southwest")
  origin: string;          // IATA code (e.g. "BNA")
  dest: string;            // IATA code (e.g. "LAX")
  date?: string;           // YYYY-MM-DD outbound — returns null when missing
  returnDate?: string;     // YYYY-MM-DD return (omit for one-way)
  passengers?: number;     // adults (default 1)
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

/** Internal opts type where date is guaranteed present */
type AirlineOpts = AirlineDeepLinkOpts & { date: string };

/** Convert YYYY-MM-DD → MM/DD/YYYY for airlines that need US date format */
function toMMDDYYYY(date: string): string {
  const [y, m, d] = date.split("-");
  return `${m}/${d}/${y}`;
}

function buildDeltaUrl(o: AirlineOpts): string {
  // Delta cabin codes: MAIN_CABIN, COMFORTPLUS, FIRST, BUSINESS_FIRST
  const cabin =
    o.cabinClass === "first" ? "FIRST" :
    o.cabinClass === "business" ? "BUSINESS_FIRST" :
    o.cabinClass === "premium_economy" ? "COMFORTPLUS" :
    "MAIN_CABIN";
  const p: Record<string, string> = {
    tripType: o.returnDate ? "ROUNDTRIP" : "ONEWAY",
    cabin,
    numberOfAdults: String(o.passengers ?? 1),
    departureDate: toMMDDYYYY(o.date),
    originCity: o.origin,
    destinationCity: o.dest,
  };
  if (o.returnDate) p.returnDate = toMMDDYYYY(o.returnDate);
  return `https://www.delta.com/us/en/book-a-flight/results?${new URLSearchParams(p)}`;
}

function buildUnitedUrl(o: AirlineOpts): string {
  // United cabin param: Economy/Business/First; travel_class for seat type
  const cabin =
    o.cabinClass === "business" ? "Business" :
    o.cabinClass === "first" ? "First" :
    "Economy";
  const p: Record<string, string> = {
    f: o.origin,
    t: o.dest,
    d: o.date,
    tt: o.returnDate ? "2" : "1", // 1=one-way, 2=round-trip
    at: String(o.passengers ?? 1),
    sc: cabin === "Business" ? "8" : cabin === "First" ? "5" : "7",
    px: "1",
    taxng: "1",
    newHP: "True",
    clm: "7",
  };
  if (o.returnDate) p.r = o.returnDate;
  return `https://www.united.com/en/us/fsr/choose-flights?${new URLSearchParams(p)}`;
}

function buildSouthwestUrl(o: AirlineOpts): string {
  const p: Record<string, string> = {
    adultPassengersCount: String(o.passengers ?? 1),
    departureDate: o.date,
    destinationAirportCode: o.dest,
    originationAirportCode: o.origin,
    fareType: "USD",
    tripType: o.returnDate ? "roundtrip" : "oneway",
    returnOrOneWay: o.returnDate ? "round-trip" : "point-to-point",
  };
  if (o.returnDate) p.returnDate = o.returnDate;
  return `https://www.southwest.com/air/booking/?${new URLSearchParams(p)}`;
}

function buildAmericanUrl(o: AirlineOpts): string {
  const cabin =
    o.cabinClass === "business" ? "B" :
    o.cabinClass === "first" ? "F" :
    o.cabinClass === "premium_economy" ? "W" : "Y";
  const p: Record<string, string> = {
    locale: "en_US",
    "passengers[0].type": "ADT",
    "passengers[0].count": String(o.passengers ?? 1),
    "segments[0].origin": o.origin,
    "segments[0].destination": o.dest,
    "segments[0].travelDate": o.date,
    tripType: o.returnDate ? "R" : "O",
    awardBooking: "false",
    cabin,
  };
  if (o.returnDate) {
    p["segments[1].origin"] = o.dest;
    p["segments[1].destination"] = o.origin;
    p["segments[1].travelDate"] = o.returnDate;
  }
  return `https://www.aa.com/booking/find-flights?${new URLSearchParams(p)}`;
}

function buildFrontierUrl(o: AirlineOpts): string {
  // Frontier class: 1=economy, 2=stretch
  const cls = o.cabinClass === "premium_economy" || o.cabinClass === "business" ? "2" : "1";
  if (o.returnDate) {
    const p = { language: "en", mode: "rt", from: o.origin, to: o.dest,
      adl: String(o.passengers ?? 1), inf: "0", cld: "0",
      startDate: o.date, endDate: o.returnDate, class: cls };
    return `https://booking.flyfrontier.com/flight/search?${new URLSearchParams(p)}`;
  }
  const p = { language: "en", mode: "ow", from: o.origin, to: o.dest,
    adl: String(o.passengers ?? 1), inf: "0", cld: "0", startDate: o.date, class: cls };
  return `https://booking.flyfrontier.com/flight/search?${new URLSearchParams(p)}`;
}

function buildJetBlueUrl(o: AirlineOpts): string {
  // JetBlue class: Y=economy (Blue), W=Even More Space, C=Mint (business)
  const cls =
    o.cabinClass === "business" ? "C" :
    o.cabinClass === "premium_economy" ? "W" : "Y";
  const p: Record<string, string> = {
    from: o.origin, to: o.dest, depart: o.date,
    adults: String(o.passengers ?? 1), children: "0", infants: "0",
    cabinclass: cls, action: "findFlights",
  };
  if (o.returnDate) { p.return = o.returnDate; p.isMultiCity = "false"; }
  return `https://book.jetblue.com/B6.cgi?${new URLSearchParams(p)}`;
}

function buildSpiritUrl(o: AirlineOpts): string {
  const p: Record<string, string> = {
    c1: o.origin, c2: o.dest, dd1: o.date,
    mon: String(o.passengers ?? 1), inf: "0", chd: "0",
    cat: o.returnDate ? "RT" : "OW",
  };
  if (o.returnDate) p.dd2 = o.returnDate;
  return `https://www.spirit.com/book?${new URLSearchParams(p)}`;
}

function buildAlaskaUrl(o: AirlineOpts): string {
  const cabin =
    o.cabinClass === "business" || o.cabinClass === "first" ? "first" : "coach";
  const p: Record<string, string> = {
    type: o.returnDate ? "roundTrip" : "oneWay",
    origin: o.origin, destination: o.dest,
    departureDate: o.date,
    adults: String(o.passengers ?? 1), children: "0", infants: "0",
    cabin,
  };
  if (o.returnDate) p.returnDate = o.returnDate;
  return `https://www.alaskaair.com/booking/choose-flights/1?${new URLSearchParams(p)}`;
}

/**
 * Build the deepest possible airline-specific booking link for a known carrier.
 * The returned URL lands on that airline's own flight search results page,
 * pre-filtered to the exact route, date, cabin class, and passenger count.
 * User just selects their specific departure time and clicks checkout.
 *
 * Returns null for unknown airlines (caller should fall back to buildKayakFlightsUrl).
 */
export function buildAirlineDeepLink(opts: AirlineDeepLinkOpts): string | null {
  if (!opts.date) return null; // can't deep-link without a departure date
  const o = opts as AirlineDeepLinkOpts & { date: string };
  const name = opts.airline.toLowerCase();
  if (name.includes("delta"))     return buildDeltaUrl(o);
  if (name.includes("united"))    return buildUnitedUrl(o);
  if (name.includes("southwest")) return buildSouthwestUrl(o);
  if (name.includes("american"))  return buildAmericanUrl(o);
  if (name.includes("frontier"))  return buildFrontierUrl(o);
  if (name.includes("jetblue"))   return buildJetBlueUrl(o);
  if (name.includes("spirit"))    return buildSpiritUrl(o);
  if (name.includes("alaska"))    return buildAlaskaUrl(o);
  return null;
}

export interface OpenTableOpts {
  restaurantName?: string;
  city?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM (24h)
  covers?: number;
}

const RESTAURANT_BOOKING_HOSTS = [
  "opentable.com",
  "resy.com",
  "yelp.com",
  // Unsupported platforms — preserve URL so the executor's
  // unsupported_platform early-return at stagehand-executor.ts:687 fires
  // instead of rewriting the URL into an OT search and ending up on a
  // listing page that doesn't match the venue (run 13 case 022-025 hit
  // this — Per Se / Atomix / Aquavit / Marea all rewrote to OT search).
  "exploretock.com",
  "sevenrooms.com",
] as const;

/**
 * Build an OpenTable search URL pre-filled with date, time, covers, and
 * restaurant or city as a search term.
 */
export function buildOpenTableUrl(opts: OpenTableOpts): string {
  const params: Record<string, string> = {};
  if (opts.covers) params.covers = String(opts.covers);
  if (opts.date) {
    const timeStr = opts.time ?? "19:00";
    params.dateTime = `${opts.date}T${timeStr}:00`;
  }
  const term = opts.restaurantName ?? opts.city ?? "";
  if (term) params.term = term;
  return `https://www.opentable.com/s?${new URLSearchParams(params).toString()}`;
}

/**
 * Structured restaurant tasks should generally begin from a canonical booking
 * surface (OpenTable search, Resy venue page, Yelp biz page), not an official
 * marketing site that drops the case date/time and can deep-link into the
 * wrong experience flow.
 */
export function shouldUseCanonicalRestaurantSearchUrl(startUrl?: string): boolean {
  if (!startUrl) return true;
  // Benchmark sentinel scheme (e.g. `benchmark://no_online?venue=Rao%27s`) —
  // must reach the executor unmodified so the deep_link_handoff early-return
  // at stagehand-executor.ts:717 fires. Without this guard, URL parse fails,
  // catch returns true, and the dispatcher rewrites it to an OT search,
  // breaking Rao's / Lucali handoff coverage (run 13 cases 021/030).
  if (/^benchmark:\/\//i.test(startUrl)) return false;
  try {
    const host = new URL(startUrl).hostname.toLowerCase();
    return !RESTAURANT_BOOKING_HOSTS.some(
      (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`),
    );
  } catch {
    return true;
  }
}
