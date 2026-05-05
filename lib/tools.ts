import { Restaurant, ReviewSignals, GoogleReview, Hotel, Flight, AfterDinnerVenue } from "./types";
import { buildExpediaFlightsUrl } from "./agent/planners/booking-links";

const REVIEW_SIGNAL_TAVILY_TIMEOUT_MS = 4_000;
const REVIEW_SIGNAL_MODEL_TIMEOUT_MS = 6_000;
const TAVILY_SEARCH_TIMEOUT_MS = 6_000;

// ─── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeLocation(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
    };
  } catch {
    return null;
  }
}

// ─── Haversine distance (meters) ─────────────────────────────────────────────

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Google Places API ────────────────────────────────────────────────────────

export async function googlePlacesSearch(params: {
  query: string;
  location?: string;
  cityCenter?: { lat: number; lng: number };
  nearLocationCoords?: { lat: number; lng: number };
  maxResults?: number;
}): Promise<Restaurant[]> {
  const location = params.location ?? "San Francisco, CA";
  const textQuery = `${params.query} in ${location}`;
  const center =
    params.nearLocationCoords ??
    params.cityCenter ?? { lat: 37.7749, lng: -122.4194 };
  const radius = params.nearLocationCoords ? 5000 : 20000;

  const res = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.primaryTypeDisplayName,places.websiteUri,places.photos,places.regularOpeningHours,places.editorialSummary,places.location,places.reviews",
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: params.maxResults ?? 20,
        locationBias: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius,
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Places search failed: ${err}`);
  }

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: Restaurant[] = (data.places ?? []).map((p: any) => {
    // Map Google Places v1 reviews to GoogleReview[]
    const google_reviews: GoogleReview[] | undefined = p.reviews
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p.reviews.map((rv: any) => ({
          author_name: rv.authorAttribution?.displayName ?? "Anonymous",
          rating: rv.rating ?? 0,
          relative_time_description: rv.relativePublishTimeDescription ?? "",
          text: rv.text?.text ?? "",
        })).filter((rv: GoogleReview) => rv.text.length > 0)
      : undefined;

    return {
      id: p.id,
      name: p.displayName?.text ?? "",
      cuisine: p.primaryTypeDisplayName?.text ?? "Restaurant",
      price: priceLevelToSymbol(p.priceLevel),
      rating: p.rating ?? 0,
      review_count: p.userRatingCount ?? 0,
      address: p.formattedAddress ?? "",
      url: p.websiteUri,
      image_url: p.photos?.[0]
        ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=400&key=${process.env.GOOGLE_PLACES_API_KEY}`
        : undefined,
      images: Array.isArray(p.photos)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (p.photos as any[])
            .slice(0, 8)
            .map(
              (ph) =>
                `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=1600&key=${process.env.GOOGLE_PLACES_API_KEY}`,
            )
        : undefined,
      is_closed: false,
      description: p.editorialSummary?.text,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      google_reviews,
    };
  });

  // If nearLocationCoords provided, calculate distances and sort by proximity
  if (params.nearLocationCoords) {
    const { lat: tLat, lng: tLng } = params.nearLocationCoords;
    for (const r of results) {
      if (r.lat !== undefined && r.lng !== undefined) {
        r.distance = haversineDistance(tLat, tLng, r.lat, r.lng);
      }
    }
    results.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }

  return results;
}

// ─── After-Dinner Venue Search ────────────────────────────────────────────────

/**
 * Finds a cocktail bar, dessert spot, or wine bar near the given restaurant coords.
 * Returns the best single option, or null if restaurant coords are unknown or nothing is found.
 * @param venueType - filters the search by follow_up_preference: "cocktail", "dessert", or "open" (default)
 */
export async function searchAfterDinnerVenue(
  city: string,
  nearCoords: { lat: number; lng: number } | undefined,
  venueType: "cocktail" | "dessert" | "open" = "open"
): Promise<AfterDinnerVenue | null> {
  // Without restaurant coords we cannot compute an accurate walk time — skip search.
  if (!nearCoords) return null;
  try {
    const queryByType: Record<typeof venueType, string> = {
      cocktail: `craft cocktail bar OR wine bar in ${city}`,
      dessert: `dessert café OR ice cream shop OR dessert bar in ${city}`,
      open: `cocktail bar OR wine bar OR dessert cafe in ${city}`,
    };
    const query = queryByType[venueType];
    const radius = 1200;

    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.editorialSummary,places.location,places.googleMapsUri",
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 5,
          locationBias: {
            circle: {
              center: { latitude: nearCoords.lat, longitude: nearCoords.lng },
              radius,
            },
          },
        }),
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places: any[] = data.places ?? [];
    if (places.length === 0) return null;

    // Pick the highest-rated place
    const best = places.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

    const venueLat: number | undefined = best.location?.latitude;
    const venueLng: number | undefined = best.location?.longitude;
    let walkMinutes = 10;
    if (venueLat !== undefined && venueLng !== undefined) {
      const meters = haversineDistance(nearCoords.lat, nearCoords.lng, venueLat, venueLng);
      walkMinutes = Math.round(meters / 80); // ~80 m/min walking pace
      if (walkMinutes < 1) walkMinutes = 1;
    }

    return {
      name: best.displayName?.text ?? "",
      address: best.formattedAddress ?? "",
      walk_minutes: walkMinutes,
      vibe: best.editorialSummary?.text ?? "Great spot for drinks or dessert",
      google_maps_url: best.googleMapsUri ?? "",
    };
  } catch {
    return null;
  }
}

// ─── Review Signal Extraction ─────────────────────────────────────────────────

/**
 * Builds review text for a single restaurant from its Google reviews.
 * Returns null if insufficient reviews (< 2).
 */
function formatGoogleReviews(restaurant: Restaurant): string | null {
  const reviews = restaurant.google_reviews;
  if (!reviews || reviews.length < 2) return null;
  return reviews
    .map(
      (rv, i) =>
        `[Review ${i + 1} - ${rv.rating} stars - "${rv.relative_time_description}"]\n"${rv.text}"`
    )
    .join("\n\n");
}

export async function fetchReviewSignals(
  restaurants: Restaurant[],
  query: string,
  cityFullName: string
): Promise<Map<string, ReviewSignals>> {
  if (restaurants.length === 0) return new Map();

  const candidates = restaurants.slice(0, 12);
  const MINIMAX_API_URL = "https://api.minimaxi.chat/v1/chat/completions";

  const systemPrompt = `You are extracting review signals for restaurants from real user reviews. For each restaurant in the input, analyze the provided review text and extract structured signals. Return a JSON object where keys are exact restaurant names and values match the ReviewSignals schema. If a signal cannot be determined from the text, use "unknown" for noise_level, empty string for wait_time/service_pace, 5 for date_suitability, and [] for arrays. Only report signals that have clear evidence in the text. Be conservative: weight negative signals more when they appear in multiple reviews.

ReviewSignals schema:
{
  "noise_level": "quiet" | "moderate" | "loud" | "unknown",
  "wait_time": string,
  "date_suitability": number (1-10),
  "service_pace": string,
  "notable_dishes": string[],
  "red_flags": string[],
  "best_for": string[],
  "review_confidence": "high" | "medium" | "low"
}`;

  // Separate restaurants into those with Google reviews vs. those needing Tavily fallback
  const withGoogleReviews: Restaurant[] = [];
  const needsTavily: Restaurant[] = [];

  for (const r of candidates) {
    const formatted = formatGoogleReviews(r);
    if (formatted) {
      withGoogleReviews.push(r);
    } else {
      needsTavily.push(r);
    }
  }

  // Build combined review content for the AI prompt
  let combinedReviewText = "";

  // Add Google reviews for restaurants that have them
  if (withGoogleReviews.length > 0) {
    combinedReviewText += withGoogleReviews
      .map((r) => {
        const reviewsFormatted = formatGoogleReviews(r);
        return `=== ${r.name} (Google Maps reviews) ===\n${reviewsFormatted}`;
      })
      .join("\n\n");
  }

  // Fetch Tavily reviews for restaurants without Google reviews
  if (needsTavily.length > 0) {
    try {
      const names = needsTavily.map((r) => r.name).join(", ");
      const searchQuery = `${names} reviews ${cityFullName} noise atmosphere experience site:reddit.com OR site:yelp.com`;
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal: AbortSignal.timeout(REVIEW_SIGNAL_TAVILY_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: searchQuery,
          search_depth: "advanced",
          max_results: 8,
          include_domains: ["yelp.com", "tripadvisor.com", "reddit.com"],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const tavilyText = (data.results ?? [])
          .map((r: { title: string; content: string }) => `${r.title}: ${r.content}`)
          .join("\n\n");
        if (tavilyText) {
          combinedReviewText += (combinedReviewText ? "\n\n" : "") +
            `=== Additional review data (Yelp/Reddit) ===\n${tavilyText}`;
        }
      }
    } catch {
      // non-fatal
    }
  }

  if (!combinedReviewText) return new Map();

  const restaurantList = candidates.map((r) => r.name).join(", ");

  try {
    const res = await fetch(MINIMAX_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(REVIEW_SIGNAL_MODEL_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Restaurants to analyze: ${restaurantList}

Review content:
${combinedReviewText.slice(0, 10000)}

User query context: "${query}"

Return ONLY a JSON object with restaurant names as keys and ReviewSignals as values.`,
          },
        ],
        max_tokens: 2048,
      }),
    });

    if (!res.ok) return new Map();

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Map();

    const parsed = JSON.parse(jsonMatch[0]);
    const result = new Map<string, ReviewSignals>();
    for (const [name, signals] of Object.entries(parsed)) {
      result.set(name, signals as ReviewSignals);
    }
    return result;
  } catch {
    return new Map();
  }
}

function priceLevelToSymbol(level?: string): string {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE: "$",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return map[level ?? ""] ?? "$$";
}

// ─── Tavily ──────────────────────────────────────────────────────────────────

export async function tavilySearch(
  query: string
): Promise<{ results: string; failed: boolean }> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(TAVILY_SEARCH_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });

  if (!res.ok) {
    console.warn(`Tavily search failed (${res.status})`);
    return { results: "", failed: true };
  }

  const data = await res.json();
  const results = (data.results ?? [])
    .map((r: { title: string; content: string }) => `${r.title}: ${r.content}`)
    .join("\n\n");
  return { results, failed: false };
}

// ─── Phase 7.2: Hotel Search via SerpApi ─────────────────────────────────────

export interface HotelSearchResult {
  hotels: Hotel[];
  /**
   * Bug 2 (P1 systemic): when the upstream provider rejects the request or
   * errors out, downstream code used to see a silently empty array — making
   * "no hotels found" indistinguishable from a real empty result. This field
   * carries the cause forward so the chat layer can surface the right reason.
   */
  providerError: string | null;
}

export async function searchHotels(params: {
  location: string;
  check_in?: string;
  check_out?: string;
  guests?: number;
  hotel_class?: number;
  maxResults?: number;
}): Promise<HotelSearchResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn("SERPAPI_KEY not set, returning empty hotel results");
    return { hotels: [], providerError: "SERPAPI_KEY not set" };
  }

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(today.getDate() + 2);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  const checkIn = params.check_in ?? formatDate(tomorrow);
  const checkOut = params.check_out ?? formatDate(dayAfter);

  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_hotels");
  url.searchParams.set("q", `hotels in ${params.location}`);
  url.searchParams.set("check_in_date", checkIn);
  url.searchParams.set("check_out_date", checkOut);
  url.searchParams.set("adults", String(params.guests ?? 2));
  if (params.hotel_class) {
    url.searchParams.set("hotel_class", String(params.hotel_class));
  }
  url.searchParams.set("currency", "USD");
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", apiKey);

  const urlStr = url.toString();
  console.log(`[searchHotels] ${params.location} ${checkIn}→${checkOut} class=${params.hotel_class ?? "any"} URL=${urlStr.replace(apiKey, "HIDDEN")}`);

  try {
    const res = await fetch(urlStr, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn("SerpApi hotel search failed:", res.status);
      return { hotels: [], providerError: `SerpApi HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.error) {
      console.warn("[searchHotels] SerpAPI error:", data.error);
      return { hotels: [], providerError: `SerpApi: ${String(data.error).slice(0, 120)}` };
    }
    const properties: Array<Record<string, unknown>> = data.properties ?? [];
    console.log(`[searchHotels] got ${properties.length} properties (keys: ${Object.keys(data).join(",")})`);


    const hotels = properties.slice(0, params.maxResults ?? 20).map((p, i): Hotel => {
      const prices = p.rate_per_night as Record<string, unknown> | undefined;
      const pricePerNight = prices?.extracted_lowest
        ? Number(prices.extracted_lowest)
        : 0;

      const nights =
        params.check_in && params.check_out
          ? Math.max(
              1,
              Math.round(
                (new Date(params.check_out).getTime() -
                  new Date(params.check_in).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            )
          : 1;

      const amenities: string[] = Array.isArray(p.amenities)
        ? (p.amenities as string[]).slice(0, 8)
        : [];

      // SerpAPI's `hotel_class` is usually a string like "5-star hotel", not a
      // plain number — Number("5-star hotel") === NaN. Pull the first integer
      // out, and fall back to 0 (== "unknown") rather than the previous 3,
      // which lied about unrated properties.
      const starRating = (() => {
        const raw = p.hotel_class;
        if (typeof raw === "number" && Number.isFinite(raw)) return raw;
        if (typeof raw === "string") {
          const m = raw.match(/\d+/);
          if (m) return parseInt(m[0], 10);
        }
        return 0;
      })();
      return {
        id: String(p.property_token ?? `hotel-${i}`),
        name: String(p.name ?? "Unknown Hotel"),
        star_rating: starRating,
        price_per_night: pricePerNight,
        total_price: Math.round(pricePerNight * nights),
        rating: Number(p.overall_rating ?? 0),
        review_count: Number(p.reviews ?? 0),
        address: String(p.location ?? ""),
        neighborhood: String(p.neighborhood ?? ""),
        distance_to_center: String(p.distance ?? ""),
        amenities,
        ...(() => {
          // SerpAPI returns photos in a handful of shapes depending on the
          // property. Try every field we've seen in the wild so hotels without
          // the richer `images` array still show at least one picture.
          const urls: string[] = [];
          const pushUrl = (v: unknown) => {
            if (typeof v === "string" && v.startsWith("http") && !urls.includes(v)) {
              urls.push(v);
            }
          };
          const imgs = p.images as Array<Record<string, unknown>> | undefined;
          for (const entry of imgs ?? []) {
            if (urls.length >= 8) break;
            pushUrl(entry?.original_image);
            pushUrl(entry?.thumbnail);
            pushUrl(entry?.image);
            pushUrl(entry?.link);
          }
          // Fallback: some hotels only have a top-level thumbnail/image.
          pushUrl((p as Record<string, unknown>).thumbnail);
          pushUrl((p as Record<string, unknown>).image);
          pushUrl((p as Record<string, unknown>).hero_image);
          return { thumbnail: urls[0] ?? "", images: urls };
        })(),
        booking_link: String(p.link ?? `https://www.google.com/travel/hotels`),
        description: String(p.description ?? ""),
        lat: (p.gps_coordinates as Record<string, number> | undefined)?.latitude,
        lng: (p.gps_coordinates as Record<string, number> | undefined)?.longitude,
      };
    });
    return { hotels, providerError: null };
  } catch (err) {
    console.warn("searchHotels error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return { hotels: [], providerError: `searchHotels exception: ${message.slice(0, 120)}` };
  }
}

// ─── Phase 8: Flight Search via SerpApi Google Flights ────────────────────────

// Airport coordinates for map arc rendering (major US airports)
const AIRPORT_COORDS: Record<string, { lat: number; lng: number }> = {
  JFK: { lat: 40.6413, lng: -73.7781 }, LGA: { lat: 40.7772, lng: -73.8726 },
  EWR: { lat: 40.6895, lng: -74.1745 }, LAX: { lat: 33.9425, lng: -118.408 },
  SFO: { lat: 37.6213, lng: -122.379 }, ORD: { lat: 41.9742, lng: -87.9073 },
  MDW: { lat: 41.7868, lng: -87.7522 }, ATL: { lat: 33.6407, lng: -84.4277 },
  DFW: { lat: 32.8998, lng: -97.0403 }, IAH: { lat: 29.9902, lng: -95.3368 },
  MIA: { lat: 25.7959, lng: -80.2870 }, FLL: { lat: 26.0726, lng: -80.1527 },
  SEA: { lat: 47.4502, lng: -122.309 }, DEN: { lat: 39.8561, lng: -104.674 },
  BOS: { lat: 42.3656, lng: -71.0096 }, PHL: { lat: 39.8744, lng: -75.2424 },
  DCA: { lat: 38.8521, lng: -77.0377 }, IAD: { lat: 38.9531, lng: -77.4565 },
  BWI: { lat: 39.1754, lng: -76.6683 }, LAS: { lat: 36.0840, lng: -115.153 },
  PHX: { lat: 33.4373, lng: -112.007 }, MSP: { lat: 44.8848, lng: -93.2223 },
  DTW: { lat: 42.2162, lng: -83.3554 }, CLT: { lat: 35.2140, lng: -80.9431 },
  SLC: { lat: 40.7884, lng: -111.978 }, PDX: { lat: 45.5898, lng: -122.591 },
  SAN: { lat: 32.7338, lng: -117.190 }, HNL: { lat: 21.3245, lng: -157.925 },
  AUS: { lat: 30.1975, lng: -97.6664 }, MCO: { lat: 28.4312, lng: -81.3081 },
  BNA: { lat: 36.1263, lng: -86.6774 }, OAK: { lat: 37.7213, lng: -122.221 },
  SJC: { lat: 37.3626, lng: -121.929 }, TPA: { lat: 27.9755, lng: -82.5332 },
  RDU: { lat: 35.8776, lng: -78.7875 }, MSY: { lat: 29.9934, lng: -90.2580 },
  MCI: { lat: 39.2976, lng: -94.7139 }, STL: { lat: 38.7487, lng: -90.3700 },
  PIT: { lat: 40.4915, lng: -80.2329 }, CLE: { lat: 41.4117, lng: -81.8498 },
  CVG: { lat: 39.0488, lng: -84.6678 }, IND: { lat: 39.7173, lng: -86.2944 },
  MEM: { lat: 35.0424, lng: -89.9767 }, SAT: { lat: 29.5337, lng: -98.4698 },
  DAL: { lat: 32.8473, lng: -96.8517 }, HOU: { lat: 29.6454, lng: -95.2789 },
  ANC: { lat: 61.1743, lng: -149.996 },
};

function getAirportCoords(iata: string): { lat: number; lng: number } | undefined {
  return AIRPORT_COORDS[iata.toUpperCase()];
}

// Single-airport city name → IATA code lookup
const CITY_TO_IATA: Record<string, string> = {
  "nashville": "BNA",
  "boston": "BOS",
  "seattle": "SEA",
  "denver": "DEN",
  "phoenix": "PHX",
  "las vegas": "LAS",
  "atlanta": "ATL",
  "minneapolis": "MSP",
  "detroit": "DTW",
  "philadelphia": "PHL",
  "portland": "PDX",
  "salt lake city": "SLC",
  "san diego": "SAN",
  "charlotte": "CLT",
  "orlando": "MCO",
  "tampa": "TPA",
  "baltimore": "BWI",
  "raleigh": "RDU",
  "austin": "AUS",
  "san antonio": "SAT",
  "kansas city": "MCI",
  "st louis": "STL",
  "saint louis": "STL",
  "pittsburgh": "PIT",
  "cleveland": "CLE",
  "cincinnati": "CVG",
  "indianapolis": "IND",
  "memphis": "MEM",
  "new orleans": "MSY",
  "honolulu": "HNL",
  "anchorage": "ANC",
  "sf": "SFO",
  "sfo": "SFO",
  "la": "LAX",
  "lax": "LAX",
  "dc": "DCA",
  "ny": "JFK",
  "nyc": "JFK",
  "bna": "BNA",
};

/** Normalize a city name or IATA code to an IATA code for SerpAPI. */
/** Normalize various date formats to YYYY-MM-DD for SerpAPI. */
export function normalizeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // MM/DD (no year) — assume current or next year
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const now = new Date();
    const year = now.getFullYear();
    const candidate = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    // If the date is in the past, use next year
    return candidate < now.toISOString().split("T")[0]
      ? `${year + 1}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`
      : candidate;
  }
  // Try JS Date parsing as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

export function normalizeToIATA(input: string): string {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  // Check city name maps first (handles "sf"→SFO, "nashville"→BNA, etc.)
  if (CITY_TO_IATA[lower]) return CITY_TO_IATA[lower];
  if (MULTI_AIRPORT_CITIES[lower]) return MULTI_AIRPORT_CITIES[lower].primary;
  // Strip state suffix like "Nashville, TN" → "Nashville"
  const cityOnly = lower.replace(/,\s*[a-z]{2}$/, "").trim();
  if (cityOnly !== lower) {
    if (CITY_TO_IATA[cityOnly]) return CITY_TO_IATA[cityOnly];
    if (MULTI_AIRPORT_CITIES[cityOnly]) return MULTI_AIRPORT_CITIES[cityOnly].primary;
  }
  // If it's already a valid 3-letter IATA code, return as uppercase
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  // Log unrecognized input so we can debug
  console.warn(`[normalizeToIATA] unrecognized input: "${input}"`);
  return trimmed;
}

// Multi-airport city mapping: city name (lowercase) → primary IATA + all IATA codes
export const MULTI_AIRPORT_CITIES: Record<string, { primary: string; all: string[] }> = {
  "new york":       { primary: "JFK", all: ["JFK", "LGA", "EWR"] },
  "new york city":  { primary: "JFK", all: ["JFK", "LGA", "EWR"] },
  "nyc":            { primary: "JFK", all: ["JFK", "LGA", "EWR"] },
  "washington":     { primary: "DCA", all: ["DCA", "IAD", "BWI"] },
  "washington dc":  { primary: "DCA", all: ["DCA", "IAD", "BWI"] },
  "washington d.c.":{ primary: "DCA", all: ["DCA", "IAD", "BWI"] },
  "chicago":        { primary: "ORD", all: ["ORD", "MDW"] },
  "los angeles":    { primary: "LAX", all: ["LAX"] },
  "miami":          { primary: "MIA", all: ["MIA", "FLL"] },
  "san francisco":  { primary: "SFO", all: ["SFO", "OAK", "SJC"] },
  "bay area":       { primary: "SFO", all: ["SFO", "OAK", "SJC"] },
  "dallas":         { primary: "DFW", all: ["DFW", "DAL"] },
  "houston":        { primary: "IAH", all: ["IAH", "HOU"] },
};

/** Returns the multi-airport entry if the city input matches a known multi-airport city, else null. */
export function resolveMultiAirport(cityInput: string): { primary: string; all: string[] } | null {
  const lower = cityInput.toLowerCase().trim();
  return MULTI_AIRPORT_CITIES[lower] ?? null;
}

export async function searchFlights(params: {
  departure_city: string;
  arrival_city: string;
  date: string; // YYYY-MM-DD
  return_date?: string;
  passengers?: number;
  cabin_class?: "economy" | "business" | "first";
  is_round_trip?: boolean;
  prefer_direct?: boolean;
  max_stops?: number | null;
  maxResults?: number;
}): Promise<Flight[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn("SERPAPI_KEY not set, returning empty flight results");
    return [];
  }

  // Build SerpApi Google Flights URL
  const depIATA = normalizeToIATA(params.departure_city);
  const arrIATA = normalizeToIATA(params.arrival_city);
  const normalizedDate = normalizeDate(params.date) ?? params.date;
  console.log(`[searchFlights] ${depIATA} → ${arrIATA} on ${normalizedDate} (raw date: ${params.date})`);
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", depIATA);
  url.searchParams.set("arrival_id", arrIATA);
  url.searchParams.set("outbound_date", normalizedDate);
  if (params.is_round_trip && params.return_date) {
    url.searchParams.set("return_date", params.return_date);
    url.searchParams.set("type", "1"); // round trip
  } else {
    url.searchParams.set("type", "2"); // one way
  }
  url.searchParams.set("adults", String(params.passengers ?? 1));
  const classMap: Record<string, string> = { economy: "1", business: "2", first: "3" };
  url.searchParams.set("travel_class", classMap[params.cabin_class ?? "economy"]);
  url.searchParams.set("currency", "USD");
  url.searchParams.set("gl", "us");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", apiKey);

  try {
    // Log URL without API key for debugging
    const debugUrl = new URL(url.toString());
    debugUrl.searchParams.set("api_key", "REDACTED");
    console.log("[searchFlights] url:", debugUrl.toString());
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("SerpApi flight search failed:", res.status, errText.slice(0, 200));
      return [];
    }
    const data = await res.json();

    // SerpApi Google Flights returns best_flights and other_flights
    const allFlights: Array<Record<string, unknown>> = [
      ...((data.best_flights as Array<Record<string, unknown>>) ?? []),
      ...((data.other_flights as Array<Record<string, unknown>>) ?? []),
    ];

    if (allFlights.length === 0) return [];

    const parseFlightEntry = (entry: Record<string, unknown>, idx: number): Flight | null => {
      const flights = entry.flights as Array<Record<string, unknown>> | undefined;
      if (!flights || flights.length === 0) return null;

      const firstLeg = flights[0];
      const lastLeg = flights[flights.length - 1];
      const layovers = entry.layovers as Array<Record<string, unknown>> | undefined;
      const stops = (flights.length - 1);

      // Airline from first leg
      const airline = String(firstLeg.airline ?? "Unknown");
      const airlineLogo = String(firstLeg.airline_logo ?? "");
      const flightNumber = String(firstLeg.flight_number ?? "");

      const depAirport = String((firstLeg.departure_airport as Record<string, unknown>)?.id ?? params.departure_city);
      const arrAirport = String((lastLeg.arrival_airport as Record<string, unknown>)?.id ?? params.arrival_city);
      const depCity = String((firstLeg.departure_airport as Record<string, unknown>)?.name ?? params.departure_city);
      const arrCity = String((lastLeg.arrival_airport as Record<string, unknown>)?.name ?? params.arrival_city);
      const depTime = String((firstLeg.departure_airport as Record<string, unknown>)?.time ?? "");
      const arrTime = String((lastLeg.arrival_airport as Record<string, unknown>)?.time ?? "");

      const totalDurationMin = Number(entry.total_duration ?? 0);
      const durationHr = Math.floor(totalDurationMin / 60);
      const durationMin = totalDurationMin % 60;
      const duration = totalDurationMin > 0 ? `${durationHr}h ${durationMin}m` : "";

      const layoverCity = layovers?.[0]
        ? String((layovers[0] as Record<string, unknown>).name ?? "")
        : undefined;
      const layoverDurationMin = layovers?.[0]
        ? Number((layovers[0] as Record<string, unknown>).duration ?? 0)
        : 0;
      const layoverDuration = layoverDurationMin > 0
        ? `${Math.floor(layoverDurationMin / 60)}h${layoverDurationMin % 60 > 0 ? ` ${layoverDurationMin % 60}m` : ""}`
        : undefined;

      const price = Number(entry.price ?? 0);

      const bookingLink = buildExpediaFlightsUrl({
        origin: depAirport,
        dest: arrAirport,
        date: normalizedDate,
        returnDate: params.is_round_trip && params.return_date ? params.return_date : undefined,
        passengers: params.passengers ?? 1,
        cabinClass: (params.cabin_class ?? "economy") as "economy" | "premium_economy" | "business" | "first",
      });

      // Get airport coords for map arcs
      const depCoords = getAirportCoords(depAirport);
      const arrCoords = getAirportCoords(arrAirport);

      // Build per-leg detail for multi-segment map rendering
      const legs: import("./types").FlightLeg[] = flights.map((leg, i) => {
        const fromId = String((leg.departure_airport as Record<string, unknown>)?.id ?? "");
        const toId = String((leg.arrival_airport as Record<string, unknown>)?.id ?? "");
        const fromCoords = getAirportCoords(fromId);
        const toCoords = getAirportCoords(toId);
        const layoverAfter = layovers?.[i];
        const layoverMin = layoverAfter ? Number((layoverAfter as Record<string, unknown>).duration ?? 0) : 0;
        const legDurationMin = Number(leg.duration ?? 0);
        return {
          from_airport: fromId,
          to_airport: toId,
          departure_time: String((leg.departure_airport as Record<string, unknown>)?.time ?? ""),
          arrival_time: String((leg.arrival_airport as Record<string, unknown>)?.time ?? ""),
          duration: legDurationMin > 0 ? `${Math.floor(legDurationMin / 60)}h ${legDurationMin % 60}m` : undefined,
          from_lat: fromCoords?.lat,
          from_lng: fromCoords?.lng,
          to_lat: toCoords?.lat,
          to_lng: toCoords?.lng,
          layover_duration: layoverMin > 0 ? `${Math.floor(layoverMin / 60)}h${layoverMin % 60 > 0 ? ` ${layoverMin % 60}m` : ""}` : undefined,
        };
      });

      return {
        id: `flight-${idx}`,
        airline,
        airline_logo: airlineLogo || undefined,
        flight_number: flightNumber || undefined,
        departure_airport: depAirport,
        arrival_airport: arrAirport,
        departure_city: depCity,
        arrival_city: arrCity,
        departure_time: depTime,
        arrival_time: arrTime,
        duration,
        stops,
        layover_city: layoverCity,
        layover_duration: layoverDuration,
        price,
        booking_link: bookingLink,
        is_round_trip: params.is_round_trip,
        legs,
        departure_lat: depCoords?.lat,
        departure_lng: depCoords?.lng,
        arrival_lat: arrCoords?.lat,
        arrival_lng: arrCoords?.lng,
      };
    };

    const parsed = allFlights
      .map((entry, idx) => parseFlightEntry(entry, idx))
      .filter((f): f is Flight => f !== null);

    const maxResults = params.maxResults ?? 8;
    const direct  = parsed.filter((f) => f.stops === 0);
    const oneStop = parsed.filter((f) => f.stops === 1);
    const twoPlus = parsed.filter((f) => f.stops >= 2);

    // User explicitly requested nonstop / max_stops=0
    if (params.prefer_direct || params.max_stops === 0) {
      // Return all nonstop, fall back to 1-stop if none available
      return direct.length > 0
        ? direct.slice(0, maxResults)
        : oneStop.slice(0, maxResults);
    }
    // User explicitly requested max 1 stop
    if (params.max_stops === 1) {
      return [...direct, ...oneStop].slice(0, maxResults);
    }
    // Default: 4 direct + 3 one-stop + 1 two-stop + 1 cheapest overall
    const pickedDirect = direct.slice(0, 4);
    const pickedOne    = oneStop.slice(0, 3);
    const pickedTwo    = twoPlus.slice(0, 1);
    const picked = [...pickedDirect, ...pickedOne, ...pickedTwo];
    const pickedIds = new Set(picked.map(f => f.id));
    const cheapest = parsed
      .filter(f => !pickedIds.has(f.id) && f.price > 0)
      .sort((a, b) => a.price - b.price)[0];
    if (cheapest) picked.push(cheapest);
    return picked.slice(0, maxResults);
  } catch (err) {
    console.warn("searchFlights error:", err);
    return [];
  }
}
