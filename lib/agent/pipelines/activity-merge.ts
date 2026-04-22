/**
 * Activity cross-source merge.
 *
 * SeatGeek and Ticketmaster don't share event ids, so we aggregate by
 * (normalizedTitle, localDate, showtime±2h). Same show on the same night
 * across both providers becomes a single Activity card with two ticket sources.
 *
 * Matching rule (per design discussion + Wicked-on-Broadway incident):
 *   1. Dates must match exactly (YYYY-MM-DD, local timezone)
 *   2. Showtimes must be within 120 minutes of each other (separates 2pm
 *      matinee from 8pm evening, tolerates SG/TM time-reporting jitter)
 *   3. Titles match when normalized strings are equal, OR one is a prefix of
 *      the other, OR token intersection >= 80% of the shorter token set.
 *
 * Belt-and-suspenders: never merge two entries from the same provider — the
 * provider's API already distinguishes them, so collapsing is always wrong
 * (seen in the wild: TM returning 4 "Wicked" attraction variants same day).
 *
 * The first entry in each merged group wins for display-only fields (image,
 * venue metadata, performers). Aggregate price fields come from min/max
 * across all sources.
 */
import type { Activity, ActivitySource } from "../../types";

/** Lowercase, strip punctuation/brackets, collapse whitespace. */
export function normalizeTitle(s: string): string {
  return (s ?? "")
    .toLowerCase()
    // Remove bracketed qualifiers like "(NY)" or "[Broadway]"
    .replace(/[\[({][^\])}]*[\])}]/g, " ")
    // Strip punctuation
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract YYYY-MM-DD from an ISO-like local datetime. "" if unparseable. */
export function extractDateYMD(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}

/**
 * Extract minutes-since-midnight from the HH:MM portion of an ISO datetime.
 * Returns -1 when the time component is absent (date-only strings). We use -1
 * as a sentinel meaning "time unknown" — isSameEvent treats that as permissive.
 */
export function extractMinutesSinceMidnight(iso: string): number {
  if (!iso) return -1;
  const m = iso.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Split on whitespace after normalisation. Filters empty tokens. */
function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/**
 * True when two titles refer to the same event per our matching rule.
 * Requires the callers to pass already-normalized strings (via normalizeTitle)
 * to keep the hot path cheap — we call this inside O(n·m) pair comparisons.
 */
export function titlesMatch(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  // Prefix match — common when one side appends "(Broadway)" / ": Live".
  if (normA.startsWith(normB + " ") || normB.startsWith(normA + " ")) return true;

  // Token overlap: Jaccard-style on the smaller token set.
  const ta = new Set(tokenize(normA));
  const tb = new Set(tokenize(normB));
  if (ta.size === 0 || tb.size === 0) return false;
  const small = ta.size <= tb.size ? ta : tb;
  const large = ta.size <= tb.size ? tb : ta;
  let overlap = 0;
  for (const t of small) if (large.has(t)) overlap += 1;
  return overlap / small.size >= 0.8;
}

/** Max allowed showtime drift (minutes) between providers to still call it the
 * same event. 120 min is the Linus-style cut: wide enough to absorb "19:00 vs
 * 19:30" reporting jitter, narrow enough that a 2pm matinee never eats the 8pm
 * evening. */
const SHOWTIME_TOLERANCE_MIN = 120;

/** True when two Activities refer to the same event — same day, showtimes
 * within 2h, and titles match. If either side lacks a time component, we fall
 * back to date-only match (best we can do with partial data). */
export function isSameEvent(a: Activity, b: Activity): boolean {
  const dayA = extractDateYMD(a.datetime_local);
  const dayB = extractDateYMD(b.datetime_local);
  if (!dayA || !dayB || dayA !== dayB) return false;

  const tA = extractMinutesSinceMidnight(a.datetime_local);
  const tB = extractMinutesSinceMidnight(b.datetime_local);
  if (tA >= 0 && tB >= 0 && Math.abs(tA - tB) > SHOWTIME_TOLERANCE_MIN) return false;

  return titlesMatch(normalizeTitle(a.title), normalizeTitle(b.title));
}

/**
 * Merge a list of Activities so that same-event entries from different sources
 * collapse into a single Activity with multiple `sources`. Preserves the order
 * of the first appearance of each group (so SG-first ranking survives).
 */
export function mergeBySource(activities: Activity[]): Activity[] {
  const groups: Activity[] = [];

  for (const incoming of activities) {
    const incomingSources = incoming.sources?.length
      ? incoming.sources
      : fallbackSource(incoming);
    const incomingProviders = new Set(incomingSources.map(s => s.provider));

    // Try to find an existing group that:
    //   a) is the same event (date + showtime + title), AND
    //   b) doesn't already carry a source from the incoming's provider.
    // Rule (b) is critical: if TM returns 4 "Wicked" variants for May 20,
    // they're distinct per TM's API — collapsing them gives the user a card
    // with four identical "Book on Ticketmaster" buttons pointing at
    // different URLs. Keep them separate instead.
    const hostIdx = groups.findIndex(g => {
      if (!isSameEvent(g, incoming)) return false;
      for (const existing of g.sources) {
        if (incomingProviders.has(existing.provider)) return false;
      }
      return true;
    });
    if (hostIdx === -1) {
      // Fresh group — take incoming as-is. Guarantee sources is non-empty.
      if (!incoming.sources || incoming.sources.length === 0) {
        groups.push({ ...incoming, sources: incomingSources });
      } else {
        groups.push(incoming);
      }
      continue;
    }

    const host = groups[hostIdx];
    // Merge sources (dedupe by provider+provider_event_id — a defensive guard
    // in case the same event gets fetched twice).
    const combined: ActivitySource[] = [...host.sources];
    for (const s of incomingSources) {
      const dupe = combined.some(
        c => c.provider === s.provider && c.provider_event_id === s.provider_event_id
      );
      if (!dupe) combined.push(s);
    }

    // Recompute aggregate price fields across all sources.
    const minPrices = combined.map(c => c.price_min).filter(p => p > 0);
    const maxPrices = combined
      .map(c => c.price_max)
      .filter((p): p is number => typeof p === "number" && p > 0);

    groups[hostIdx] = {
      ...host,
      sources: combined,
      price_min: minPrices.length ? Math.min(...minPrices) : host.price_min,
      price_max: maxPrices.length ? Math.max(...maxPrices) : host.price_max,
      // Keep primary booking_link (first source's), performers/image from host.
      booking_link: combined[0].booking_link,
      listing_count: combined[0].listing_count,
    };
  }

  return groups;
}

/**
 * Synthesize a single-source list from a legacy Activity that doesn't carry
 * sources yet (defensive — new code always provides sources, but keeping this
 * guard makes the function safe to call on any Activity).
 */
function fallbackSource(a: Activity): ActivitySource[] {
  // Heuristic: SeatGeek activity ids are pure digits; Ticketmaster adapter
  // prefixes with "tm-".
  const provider: ActivitySource["provider"] = a.id.startsWith("tm-")
    ? "ticketmaster"
    : "seatgeek";
  const provider_event_id = a.id.replace(/^tm-/, "");
  return [{
    provider,
    provider_event_id,
    booking_link: a.booking_link,
    price_min: a.price_min,
    price_max: a.price_max,
    price_avg: a.price_avg,
    listing_count: a.listing_count,
  }];
}
