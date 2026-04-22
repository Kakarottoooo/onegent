/**
 * Activity search pipeline — fetches ticketed events from SeatGeek's public API.
 *
 * SeatGeek docs: https://platform.seatgeek.com/#events
 * Endpoint: GET https://api.seatgeek.com/2/events?client_id=<id>&q=<query>&...
 *
 * Auth: requires `SEATGEEK_CLIENT_ID` env var. On missing/invalid creds the
 * pipeline falls back to an empty list with `missing_fields=["seatgeek_client_id"]`.
 *
 * Ranking: three buckets mirroring flight.ts
 *   - best_match   → top textual match from SeatGeek's `score` field
 *   - cheapest     → sorted by stats.lowest_price
 *   - premium_seats → sorted by stats.highest_price (for premium seat_type ask)
 */

import type {
  Activity,
  ActivityIntent,
  ActivityRecommendationCard,
  ActivityEventType,
  ActivitySource,
  TicketmasterEvent,
} from "../../types";
import { searchConcertEvents } from "../../ticketmaster";
import { mergeBySource } from "./activity-merge";

const SEATGEEK_BASE = "https://api.seatgeek.com/2";

interface SeatGeekPerformer {
  name?: string;
  short_name?: string;
  image?: string;
  images?: { huge?: string; large?: string; medium?: string };
}

interface SeatGeekVenue {
  name?: string;
  name_v2?: string;
  city?: string;
  state?: string;
  address?: string;
  extended_address?: string;
}

interface SeatGeekStats {
  lowest_price?: number | null;
  highest_price?: number | null;
  average_price?: number | null;
  median_price?: number | null;
  listing_count?: number | null;
  visible_listing_count?: number | null;
}

interface SeatGeekEvent {
  id: number;
  title: string;
  short_title?: string;
  datetime_local?: string;
  datetime_utc?: string;
  url: string;
  type?: string;
  taxonomies?: Array<{ name?: string; id?: number }>;
  venue?: SeatGeekVenue;
  performers?: SeatGeekPerformer[];
  stats?: SeatGeekStats;
  score?: number;
}

interface SeatGeekResponse {
  events?: SeatGeekEvent[];
  meta?: { total?: number; took?: number };
}

function mapTaxonomy(taxonomies?: Array<{ name?: string }>, type?: string): ActivityEventType {
  const names = (taxonomies ?? []).map((t) => (t.name ?? "").toLowerCase());
  const all = [type?.toLowerCase() ?? "", ...names].filter(Boolean);
  for (const n of all) {
    if (n.includes("concert") || n.includes("music")) return "concert";
    if (n.includes("theater") || n.includes("broadway") || n.includes("opera") || n.includes("musical")) return "theater";
    if (n.includes("sports") || n.includes("nba") || n.includes("nfl") || n.includes("mlb") || n.includes("nhl") || n.includes("soccer")) return "sports";
    if (n.includes("comedy")) return "comedy";
    if (n.includes("festival")) return "festival";
    if (n.includes("exhibit")) return "exhibition";
  }
  return "other";
}

function formatDisplayDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toActivity(e: SeatGeekEvent): Activity | null {
  if (!e.id || !e.title || !e.venue?.city) return null;
  const perf = (e.performers ?? []).map((p) => p.name ?? p.short_name ?? "").filter(Boolean);
  const image =
    e.performers?.[0]?.images?.huge ??
    e.performers?.[0]?.images?.large ??
    e.performers?.[0]?.image ??
    undefined;
  const priceMin = e.stats?.lowest_price ?? 0;
  const priceMax = e.stats?.highest_price ?? undefined;
  const priceAvg = e.stats?.average_price ?? e.stats?.median_price ?? undefined;
  const listingCount = e.stats?.listing_count ?? e.stats?.visible_listing_count ?? undefined;
  const source: ActivitySource = {
    provider: "seatgeek",
    provider_event_id: String(e.id),
    booking_link: e.url,
    price_min: priceMin,
    price_max: priceMax,
    price_avg: priceAvg,
    listing_count: listingCount,
  };
  return {
    id: String(e.id),
    title: e.title,
    short_title: e.short_title,
    event_type: mapTaxonomy(e.taxonomies, e.type),
    datetime_local: e.datetime_local ?? e.datetime_utc ?? "",
    datetime_display: formatDisplayDate(e.datetime_local ?? e.datetime_utc),
    venue_name: e.venue.name_v2 ?? e.venue.name ?? "",
    venue_city: e.venue.city ?? "",
    venue_state: e.venue.state,
    venue_address: e.venue.extended_address ?? e.venue.address,
    price_min: priceMin,
    price_max: priceMax,
    price_avg: priceAvg,
    listing_count: listingCount,
    image_url: image,
    booking_link: e.url,
    performers: perf,
    sources: [source],
  };
}

function buildTaxonomyFilter(event_type?: ActivityEventType): string | null {
  switch (event_type) {
    case "concert":
      return "concert";
    case "theater":
      return "theater";
    case "sports":
      return "sports";
    case "comedy":
      return "comedy";
    case "festival":
      return "music_festival";
    default:
      return null;
  }
}

async function fetchSeatGeek(intent: ActivityIntent): Promise<SeatGeekEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) {
    console.warn("[activity-pipeline] SEATGEEK_CLIENT_ID not set — returning empty results");
    return [];
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("per_page", "25");

  if (intent.event_name) params.set("q", intent.event_name);
  if (intent.city) params.set("venue.city", intent.city);
  if (intent.date_from) params.set("datetime_local.gte", `${intent.date_from}T00:00:00`);
  if (intent.date_to) params.set("datetime_local.lte", `${intent.date_to}T23:59:59`);

  const tax = buildTaxonomyFilter(intent.event_type);
  if (tax) params.set("taxonomies.name", tax);

  if (typeof intent.budget_max_per_ticket === "number" && intent.budget_max_per_ticket > 0) {
    // SeatGeek supports listing_count/price filtering; be lenient: only set
    // a ceiling on lowest_price (so at least GA tickets must fit the budget).
    params.set("stats.lowest_price.lte", String(intent.budget_max_per_ticket));
  }

  const url = `${SEATGEEK_BASE}/events?${params.toString()}`;
  console.log("[activity-pipeline] GET", url.replace(clientId, "<redacted>"));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn("[activity-pipeline] SeatGeek returned", res.status);
      return [];
    }
    const data = (await res.json()) as SeatGeekResponse;
    const events = data.events ?? [];
    console.log(`[activity-pipeline] SeatGeek raw events=${events.length} (total=${data.meta?.total ?? "?"})`);
    return events;
  } catch (err) {
    console.warn("[activity-pipeline] fetch failed", err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ticketmaster adapter ──────────────────────────────────────────────────────

function tmClassification(event_type?: ActivityEventType): string | undefined {
  switch (event_type) {
    case "concert":
    case "festival":
      return "Music";
    case "theater":
    case "exhibition":
      return "Arts & Theatre";
    case "sports":
      return "Sports";
    case "comedy":
      return "Arts & Theatre"; // Comedy sits under Arts & Theatre in TM taxonomy
    default:
      return undefined;
  }
}

function tmGenreToEventType(genre: string | undefined, fallback: ActivityEventType): ActivityEventType {
  if (!genre) return fallback;
  const g = genre.toLowerCase();
  if (g.includes("rock") || g.includes("pop") || g.includes("jazz") ||
      g.includes("country") || g.includes("hip-hop") || g.includes("r&b") ||
      g.includes("classical") || g.includes("metal") || g.includes("electronic")) return "concert";
  if (g.includes("theatre") || g.includes("musical") || g.includes("opera") ||
      g.includes("dance") || g.includes("ballet")) return "theater";
  if (g.includes("basketball") || g.includes("football") || g.includes("baseball") ||
      g.includes("hockey") || g.includes("soccer") || g.includes("tennis")) return "sports";
  if (g.includes("comedy")) return "comedy";
  return fallback;
}

function ticketmasterToActivity(e: TicketmasterEvent, intentType?: ActivityEventType): Activity | null {
  if (!e.id || !e.name || !e.city) return null;
  const isoDatetime = e.time ? `${e.date}T${e.time}:00` : `${e.date}T00:00:00`;
  const priceMin = e.price_min ?? 0;
  const source: ActivitySource = {
    provider: "ticketmaster",
    provider_event_id: e.id,
    booking_link: e.url,
    price_min: priceMin,
    price_max: e.price_max,
  };
  return {
    id: `tm-${e.id}`,
    title: e.name,
    event_type: tmGenreToEventType(e.genre, intentType ?? "other"),
    datetime_local: isoDatetime,
    datetime_display: formatDisplayDate(isoDatetime),
    venue_name: e.venue_name,
    venue_city: e.city,
    venue_address: e.venue_address,
    price_min: priceMin,
    price_max: e.price_max,
    price_avg: undefined,
    listing_count: undefined,
    image_url: e.image_url,
    booking_link: e.url,
    performers: [], // TM wrapper doesn't expose attractions; deriveable from name if needed
    sources: [source],
  };
}

function offsetDateIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

async function fetchTicketmaster(intent: ActivityIntent): Promise<Activity[]> {
  if (!process.env.TICKETMASTER_API_KEY) return [];

  // Widen the API window by ±1 day to absorb UTC/venue-local timezone edges.
  // TM's startDateTime/endDateTime filter is UTC, but event.dates.start.localDate
  // is in the venue's local timezone — a 7 PM NY show lands near midnight UTC
  // and strict single-day UTC ranges miss it. We requery wider, then filter
  // back client-side against the user's exact window using event.date (local).
  const queryStart = intent.date_from ? `${offsetDateIso(intent.date_from, -1)}T00:00:00Z` : undefined;
  const queryEnd = intent.date_to ? `${offsetDateIso(intent.date_to, 1)}T23:59:59Z` : undefined;

  const params = {
    keyword: intent.event_name,
    city: intent.city,
    startDateTime: queryStart,
    endDateTime: queryEnd,
    classificationName: tmClassification(intent.event_type),
    size: 25,
  };
  console.log("[activity-pipeline] Ticketmaster params", JSON.stringify(params));
  const events = await searchConcertEvents(params);
  console.log(`[activity-pipeline] Ticketmaster raw events=${events.length}`);

  const inWindow = intent.date_from && intent.date_to
    ? events.filter((e) => e.date && e.date >= intent.date_from! && e.date <= intent.date_to!)
    : events;
  if (inWindow.length !== events.length) {
    console.log(`[activity-pipeline] Ticketmaster after local-date filter=${inWindow.length}`);
  }

  return inWindow
    .map((e) => ticketmasterToActivity(e, intent.event_type))
    .filter((a): a is Activity => a !== null);
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

export async function runActivityPipeline(
  intent: ActivityIntent
): Promise<{
  activityRecommendations: ActivityRecommendationCard[];
  missing_fields: string[];
}> {
  console.log("[activity-pipeline] intent", JSON.stringify({
    event_type: intent.event_type,
    event_name: intent.event_name,
    city: intent.city,
    date_from: intent.date_from,
    date_to: intent.date_to,
    seat_type: intent.seat_type,
    num_tickets: intent.num_tickets,
  }));
  const missing: string[] = [];
  if (!intent.city) missing.push("city");
  if (!intent.event_name && !intent.event_type) missing.push("event_name or event_type");
  if (missing.length > 0) {
    return { activityRecommendations: [], missing_fields: missing };
  }

  const haveSeatGeek = Boolean(process.env.SEATGEEK_CLIENT_ID);
  const haveTicketmaster = Boolean(process.env.TICKETMASTER_API_KEY);
  console.log(`[activity-pipeline] env haveSeatGeek=${haveSeatGeek} haveTicketmaster=${haveTicketmaster}`);
  if (!haveSeatGeek && !haveTicketmaster) {
    console.warn("[activity-pipeline] no provider keys configured");
    return { activityRecommendations: [], missing_fields: ["provider_api_key"] };
  }

  // Parallel fetch — always call both providers when their keys exist. We used
  // to short-circuit unset providers here, but that swallowed fetchSeatGeek's
  // internal "GET <url>" / "client_id not set" logs, making it impossible to
  // tell from the trace whether SG returned zero or was never called.
  // fetchSeatGeek already returns [] with a warn when env is missing.
  const [sgEvents, tmActivitiesRaw] = await Promise.all([
    fetchSeatGeek(intent),
    haveTicketmaster ? fetchTicketmaster(intent) : Promise.resolve([] as Activity[]),
  ]);
  const sgActivities = sgEvents.map(toActivity).filter((a): a is Activity => a !== null);
  const mergedActivities = mergeBySource([...sgActivities, ...tmActivitiesRaw]);
  const multiSource = mergedActivities.filter((a) => a.sources.length > 1).length;
  console.log(
    `[activity-pipeline] sg=${sgActivities.length} tm=${tmActivitiesRaw.length} merged=${mergedActivities.length} multi_source=${multiSource}`
  );

  if (mergedActivities.length === 0) {
    return { activityRecommendations: [], missing_fields: [] };
  }

  const activities = mergedActivities;

  // Filter by budget if provided (belt-and-suspenders).
  const budgeted =
    typeof intent.budget_max_per_ticket === "number" && intent.budget_max_per_ticket > 0
      ? activities.filter((a) => a.price_min > 0 && a.price_min <= intent.budget_max_per_ticket!)
      : activities;
  const pool = budgeted.length > 0 ? budgeted : activities;

  // Three-bucket ranking.
  const bestMatch = pool.slice(0, 3).map((a, i) => buildCard(a, i + 1, "best_match", intent));

  const cheapest = [...pool]
    .filter((a) => a.price_min > 0)
    .sort((a, b) => a.price_min - b.price_min)
    .slice(0, 2)
    .map((a, i) => buildCard(a, bestMatch.length + i + 1, "cheapest", intent));

  const premiumSeats =
    intent.seat_type === "premium"
      ? [...pool]
          .filter((a) => (a.price_max ?? 0) > 0)
          .sort((a, b) => (b.price_max ?? 0) - (a.price_max ?? 0))
          .slice(0, 2)
          .map((a, i) => buildCard(a, bestMatch.length + cheapest.length + i + 1, "premium_seats", intent))
      : [];

  // De-dupe by activity.id across buckets (keep first occurrence).
  const seen = new Set<string>();
  const merged: ActivityRecommendationCard[] = [];
  for (const card of [...bestMatch, ...cheapest, ...premiumSeats]) {
    if (seen.has(card.activity.id)) continue;
    seen.add(card.activity.id);
    merged.push({ ...card, rank: merged.length + 1 });
  }

  return { activityRecommendations: merged.slice(0, 5), missing_fields: [] };
}

function buildCard(
  activity: Activity,
  rank: number,
  group: ActivityRecommendationCard["group"],
  intent: ActivityIntent
): ActivityRecommendationCard {
  const reasons: string[] = [];
  if (group === "best_match") reasons.push("Top match for your search");
  if (group === "cheapest") reasons.push(`Lowest available ticket at $${activity.price_min}`);
  if (group === "premium_seats") reasons.push(`Premium seating up to $${activity.price_max ?? "?"}`);
  if (activity.listing_count) reasons.push(`${activity.listing_count} listings`);
  if (intent.num_tickets && intent.num_tickets > 1) reasons.push(`Seats together for ${intent.num_tickets}`);
  return {
    activity,
    rank,
    group,
    why_recommended: reasons.join(" · "),
  };
}
