/**
 * Restaurant deep-link generator.
 *
 * Pure function: takes the same fields the runner already has on
 * step.body / job.constraints and returns a URL that lands the user on the
 * target platform with date / time / party-size pre-filled. Used by the
 * DeepLinkExecutor and by the runUniversalStep failure-enrichment path.
 *
 * Goal: when automatic booking falls over (login wall, captcha, payment
 * gate, generic error) the user shouldn't be dumped on a bare search page.
 * They should land at the most-progressed point of the platform with their
 * details already filled.
 */

export type RestaurantPlatform = "opentable" | "resy";

export interface DeepLinkInput {
  restaurant_name: string;
  city: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  time: string;
  party_size: number;
  /** Original platform URL (if any) — drives platform pick + detail-page deep-linking. */
  restaurant_url?: string;
  /** Force a specific platform; otherwise auto-detect from URL or default to OpenTable. */
  platform?: RestaurantPlatform;
}

export interface DeepLinkOutput {
  url: string;
  platform: RestaurantPlatform;
  /** UI-friendly button label, e.g. "Continue on OpenTable". */
  label: string;
  /** Whether we landed on a restaurant detail page or fell back to search. */
  kind: "detail" | "search";
}

// ─── Top-level pick + dispatch ──────────────────────────────────────────────

export function generateRestaurantDeepLink(input: DeepLinkInput): DeepLinkOutput {
  const platform = pickPlatform(input);
  return platform === "resy" ? buildResyLink(input) : buildOpenTableLink(input);
}

function pickPlatform(input: DeepLinkInput): RestaurantPlatform {
  if (input.platform === "opentable" || input.platform === "resy") return input.platform;
  if (input.restaurant_url) {
    if (/resy\.com/i.test(input.restaurant_url)) return "resy";
    if (/opentable\.com/i.test(input.restaurant_url)) return "opentable";
  }
  return "opentable"; // default — broader coverage in US
}

// ─── OpenTable ──────────────────────────────────────────────────────────────

function buildOpenTableLink(input: DeepLinkInput): DeepLinkOutput {
  // 1. Detail page: if we already have a /r/<slug> or /<slug> URL, append
  //    query params so OpenTable opens the booking widget pre-filled.
  if (input.restaurant_url && isOpenTableDetail(input.restaurant_url)) {
    const url = withParams(input.restaurant_url, {
      covers: String(input.party_size),
      dateTime: `${input.date}T${input.time}:00`,
    });
    return { url, platform: "opentable", label: "Continue on OpenTable", kind: "detail" };
  }

  // 2. Search fallback — bias to the right metro by including city in `term`.
  //    OpenTable carries forward whatever city the most-recent session viewed,
  //    so without this you'd routinely get Nashville matches for NY queries.
  const term = input.city ? `${input.restaurant_name} ${input.city}` : input.restaurant_name;
  const params = new URLSearchParams({
    term,
    covers: String(input.party_size),
    dateTime: `${input.date}T${input.time}:00`,
  });
  return {
    url: `https://www.opentable.com/s?${params.toString()}`,
    platform: "opentable",
    label: "Continue on OpenTable",
    kind: "search",
  };
}

function isOpenTableDetail(rawUrl: string): boolean {
  if (!/opentable\.com/i.test(rawUrl)) return false;
  // Detail pages: /r/<slug>, /<slug>-<id>, /<slug>; explicitly NOT /s (search).
  try {
    const u = new URL(rawUrl);
    if (u.pathname.startsWith("/s")) return false;
    return u.pathname.length > 1; // anything other than "/"
  } catch {
    return false;
  }
}

// ─── Resy ───────────────────────────────────────────────────────────────────

function buildResyLink(input: DeepLinkInput): DeepLinkOutput {
  // 1. Detail page (resy.com/cities/<city>/<slug>): append date / seats / time.
  if (input.restaurant_url && isResyDetail(input.restaurant_url)) {
    const url = withParams(input.restaurant_url, {
      date: input.date,
      seats: String(input.party_size),
      time: input.time,
    });
    return { url, platform: "resy", label: "Continue on Resy", kind: "detail" };
  }

  // 2. City-page fallback with restaurant name as query — Resy doesn't have
  //    a clean cross-city search URL; we bias to a city slug we recognise.
  const citySlug = guessResyCitySlug(input.city);
  const params = new URLSearchParams({
    date: input.date,
    seats: String(input.party_size),
    query: input.restaurant_name,
  });
  return {
    url: `https://resy.com/cities/${citySlug}?${params.toString()}`,
    platform: "resy",
    label: "Continue on Resy",
    kind: "search",
  };
}

function isResyDetail(rawUrl: string): boolean {
  if (!/resy\.com/i.test(rawUrl)) return false;
  try {
    const u = new URL(rawUrl);
    // /cities/<city>/<slug> = detail. /cities/<city> alone = city homepage.
    const segments = u.pathname.split("/").filter(Boolean);
    return segments[0] === "cities" && segments.length >= 3;
  } catch {
    return false;
  }
}

function guessResyCitySlug(city: string): string {
  const slug = city.toLowerCase().trim();
  // Conservative: only map known matches. Unknown city → default to "ny"
  // since the seed cases skew there. Adding cities is one-line additive.
  const map: Record<string, string> = {
    "new york": "ny",
    "nyc": "ny",
    "brooklyn": "ny",
    "los angeles": "la",
    "la": "la",
    "chicago": "chi",
    "miami": "miami",
    "san francisco": "sf",
    "sf": "sf",
    "boston": "boston",
    "washington": "dc",
    "dc": "dc",
  };
  return map[slug] ?? "ny";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Return a copy of rawUrl with the given query params SET (overwriting any
 * pre-existing values for those keys). Preserves the rest of the URL.
 */
function withParams(rawUrl: string, params: Record<string, string>): string {
  try {
    const u = new URL(rawUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    // Malformed URL — fall back to a naive concat so we never throw.
    const sep = rawUrl.includes("?") ? "&" : "?";
    const qs = new URLSearchParams(params).toString();
    return `${rawUrl}${sep}${qs}`;
  }
}
