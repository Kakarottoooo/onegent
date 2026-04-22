import { TicketmasterEvent } from "./types";

const BASE_URL = "https://app.ticketmaster.com/discovery/v2/events.json";

export interface TicketmasterSearchParams {
  keyword?: string;
  city?: string;
  startDateTime?: string; // ISO 8601 e.g. "2026-04-12T00:00:00Z"
  endDateTime?: string;
  classificationName?: string; // "Music" | "Sports" | "Arts & Theatre" | "Comedy"
  size?: number;
}

interface TmVenue {
  name?: string;
  address?: { line1?: string };
  city?: { name?: string };
  location?: { latitude?: string; longitude?: string };
}

interface TmAttraction {
  url?: string;
  name?: string;
}

interface TmEvent {
  id?: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  _embedded?: { venues?: TmVenue[]; attractions?: TmAttraction[] };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  classifications?: Array<{ genre?: { name?: string }; subGenre?: { name?: string } }>;
  images?: Array<{ url?: string; width?: number; ratio?: string }>;
}

// Ticketmaster's Discovery API returns two flavors of event ID:
//   - "Long IDs" (>= 18 chars, often with underscores) — these resolve under
//     the canonical URL pattern /{slug}-{mm-dd-yyyy}/event/{id} that TM
//     redirects to the public ticket page.
//   - "Short IDs" (~13 chars, alphanumeric only) — standard entries for
//     long-running resident productions (e.g. Hamilton on Broadway). Their
//     /event/{id} URL is NOT public-facing and 404s in normal browsers.
//     For these we fall back to the attraction (artist/show) page URL, which
//     is stable, or ultimately to a search URL.
function isShortTmId(id: string): boolean {
  return id.length < 18 && !id.includes("_");
}

function buildCanonicalTmUrl(
  name: string,
  city: string,
  localDate: string,
  id: string
): string {
  const slugBase = `${name} ${city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const [y, m, d] = localDate.split("-");
  const datePart = y && m && d ? `${m}-${d}-${y}` : "";
  const slug = [slugBase, datePart].filter(Boolean).join("-");
  return `https://www.ticketmaster.com/${slug}/event/${id}`;
}

function buildTmSearchUrl(name: string, city: string): string {
  const q = encodeURIComponent(`${name} ${city}`.trim());
  return `https://www.ticketmaster.com/search?q=${q}`;
}

function pickEventUrl(event: TmEvent, name: string, city: string, localDate: string): string {
  const id = event.id ?? "";
  const attractionUrl = event._embedded?.attractions?.[0]?.url;
  if (isShortTmId(id)) {
    // Short ID: /event/{id} is guaranteed to 404. Prefer attraction page
    // (stable artist/show hub), fall back to site search.
    return attractionUrl ?? buildTmSearchUrl(name, city);
  }
  // Long ID: canonical URL pattern is reliable.
  return localDate
    ? buildCanonicalTmUrl(name, city, localDate, id)
    : attractionUrl ?? event.url ?? buildTmSearchUrl(name, city);
}

function parseTmEvent(event: TmEvent, fallbackCity: string): TicketmasterEvent | null {
  if (!event.name || !event.id) return null;

  // Filter: only keep events that are live for ticketing.
  //   (B) Official `status.code === "onsale"` — if the field is missing
  //       entirely we pass through (some entries legitimately omit it).
  // NOTE: we intentionally do NOT require `priceRanges` any more — Ticketmaster
  // omits them for many long-running Broadway residencies (Hamilton etc.)
  // whose tickets are very much on sale via partner inventory.
  const statusCode = event.dates?.status?.code;
  if (statusCode && statusCode !== "onsale") return null;

  const venue = event._embedded?.venues?.[0];
  const venueName = venue?.name ?? "Venue TBD";
  const venueAddress = [venue?.address?.line1, venue?.city?.name].filter(Boolean).join(", ");
  const city = venue?.city?.name ?? fallbackCity;

  const date = event.dates?.start?.localDate ?? "";
  const time = event.dates?.start?.localTime?.slice(0, 5); // "20:00"

  const price = event.priceRanges?.[0];
  const genre = event.classifications?.[0]?.genre?.name;

  // Pick largest image or first one
  const image =
    event.images?.find((img) => img.ratio === "16_9" && (img.width ?? 0) >= 640)?.url ??
    event.images?.[0]?.url;

  const venueLat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const venueLng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : undefined;

  const canonicalUrl = pickEventUrl(event, event.name, city, date);

  return {
    id: event.id,
    name: event.name,
    url: canonicalUrl,
    date,
    time,
    venue_name: venueName,
    venue_address: venueAddress,
    city,
    genre: genre && genre !== "Undefined" ? genre : undefined,
    price_min: price?.min,
    price_max: price?.max,
    image_url: image,
    venue_lat: Number.isFinite(venueLat) ? venueLat : undefined,
    venue_lng: Number.isFinite(venueLng) ? venueLng : undefined,
  };
}

export async function searchConcertEvents(
  params: TicketmasterSearchParams
): Promise<TicketmasterEvent[]> {
  const API_KEY = process.env.TICKETMASTER_API_KEY ?? "";
  if (!API_KEY) {
    console.warn("[ticketmaster] TICKETMASTER_API_KEY not set — returning empty results");
    return [];
  }

  const query = new URLSearchParams({
    apikey: API_KEY,
    size: String(params.size ?? 10),
  });
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.city) query.set("city", params.city);
  if (params.startDateTime) query.set("startDateTime", params.startDateTime);
  if (params.endDateTime) query.set("endDateTime", params.endDateTime);
  if (params.classificationName) query.set("classificationName", params.classificationName);

  try {
    const res = await fetch(`${BASE_URL}?${query.toString()}`, {
      headers: { Accept: "application/json" },
      // Next.js fetch cache: revalidate every 10 minutes
      next: { revalidate: 600 },
    } as RequestInit);

    if (!res.ok) {
      console.warn(`[ticketmaster] API error ${res.status}: ${await res.text().catch(() => "")}`);
      return [];
    }

    const data = await res.json();
    const rawEvents: TmEvent[] = data?._embedded?.events ?? [];
    const fallbackCity = params.city ?? "";
    console.log(`[ticketmaster] API returned ${rawEvents.length} raw events (pre-filter)`);
    if (rawEvents.length > 0) {
      console.log("[ticketmaster] raw sample", JSON.stringify(rawEvents.slice(0, 3).map((e) => ({
        id: e.id,
        name: e.name,
        localDate: e.dates?.start?.localDate,
        statusCode: e.dates?.status?.code,
        hasPriceRanges: Boolean(e.priceRanges?.length),
        url: e.url,
      }))));
    }

    return rawEvents
      .map((e) => parseTmEvent(e, fallbackCity))
      .filter((e): e is TicketmasterEvent => e !== null && e.date !== "");
  } catch (err) {
    console.warn("[ticketmaster] fetch failed:", err);
    return [];
  }
}
