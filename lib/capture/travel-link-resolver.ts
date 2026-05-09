import type { NluCategory } from "@/lib/agent/nlu-v2/types";

export type TravelLinkVertical = NluCategory | "unknown";

export type TravelLinkProvider =
  | "ticketmaster"
  | "stubhub"
  | "seatgeek"
  | "eventbrite"
  | "axs"
  | "unknown";

export type TravelLinkPageType =
  | "exact_event"
  | "artist"
  | "performer"
  | "grouping"
  | "search_results"
  | "provider_listing"
  | "unknown_provider_page";

export type TravelLinkExecutionMode =
  | "direct_execution"
  | "provider_start"
  | "review_capture";

export interface ResolvedTravelLink {
  original_url: string;
  normalized_url: string;
  host: string;
  provider: TravelLinkProvider;
  vertical: TravelLinkVertical;
  page_type: TravelLinkPageType;
  provider_page_id?: string;
  title_hint?: string;
  confidence: number;
  execution_mode: TravelLinkExecutionMode;
  needs_user_choice: boolean;
  safe_next_action: "start_task" | "review_capture";
  evidence: {
    source: "url_pattern";
    matched_pattern: string;
    title_source?: "slug";
  };
}

const KNOWN_ACTIVITY_HOSTS: Array<{
  provider: Exclude<TravelLinkProvider, "unknown">;
  hosts: readonly string[];
}> = [
  {
    provider: "ticketmaster",
    hosts: [
      "ticketmaster.com",
      "ticketmaster.ca",
      "ticketmaster.co.uk",
      "ticketmaster.com.au",
      "ticketmaster.de",
      "ticketmaster.fr",
      "ticketmaster.es",
      "ticketmaster.it",
      "ticketmaster.nl",
      "ticketmaster.ie",
    ],
  },
  { provider: "stubhub", hosts: ["stubhub.com"] },
  { provider: "seatgeek", hosts: ["seatgeek.com"] },
  { provider: "eventbrite", hosts: ["eventbrite.com"] },
  { provider: "axs", hosts: ["axs.com"] },
];

const EVENT_ID_RE = /\/event\/([A-Za-z0-9_-]+)/i;
const ARTIST_ID_RE = /\/artist\/([A-Za-z0-9_-]+)/i;
const STUBHUB_PERFORMER_RE = /\/performer\/([A-Za-z0-9_-]+)/i;
const STUBHUB_GROUPING_RE = /\/grouping\/([A-Za-z0-9_-]+)/i;
const STUBHUB_EVENT_RE = /\/event\/([A-Za-z0-9_-]+)/i;
const SEATGEEK_EVENT_ID_RE = /\/(?:[^/?#]+\/)*([0-9]{5,})(?:[/?#]|$)/i;
const SEATGEEK_DATE_SEGMENT_RE = /\b20\d{2}-\d{2}-\d{2}(?:-\d{1,2}(?:-\d{2})?-(?:am|pm))?\b/i;
const EVENTBRITE_EVENT_RE = /\/e\/.+?(?:tickets-)?([0-9]{5,})(?:[/?#]|$)/i;
const AXS_EVENT_RE = /\/events\/([A-Za-z0-9_-]+)/i;
const AXS_ARTIST_RE = /\/artists\/([A-Za-z0-9_-]+)/i;
const AXS_SERIES_RE = /\/series\/([A-Za-z0-9_-]+)/i;

export function resolveTravelLinkFromUrl(value: unknown): ResolvedTravelLink | null {
  const parsed = normalizeTravelUrl(value);
  if (!parsed) return null;
  const provider = detectActivityProvider(parsed.hostname);
  if (!provider) {
    return {
      original_url: parsed.original,
      normalized_url: parsed.url,
      host: parsed.hostname,
      provider: "unknown",
      vertical: "unknown",
      page_type: "unknown_provider_page",
      confidence: 0.2,
      execution_mode: "review_capture",
      needs_user_choice: true,
      safe_next_action: "review_capture",
      evidence: {
        source: "url_pattern",
        matched_pattern: "unknown_host",
      },
    };
  }

  if (provider.provider === "ticketmaster") {
    return resolveTicketmaster(parsed, provider.provider);
  }
  if (provider.provider === "stubhub") {
    return resolveStubHub(parsed, provider.provider);
  }
  if (provider.provider === "seatgeek") {
    return resolveSeatGeek(parsed, provider.provider);
  }
  if (provider.provider === "eventbrite") {
    return resolveEventbrite(parsed, provider.provider);
  }
  if (provider.provider === "axs") {
    return resolveAxs(parsed, provider.provider);
  }
  return null;
}

export function normalizeTravelUrl(value: unknown): {
  original: string;
  url: string;
  hostname: string;
  pathname: string;
} | null {
  if (typeof value !== "string") return null;
  const original = value.trim();
  if (!original) return null;
  const normalized = /^ttps:\/\//i.test(original) ? `h${original}` : original;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return {
    original,
    url: parsed.toString(),
    hostname: parsed.hostname.toLowerCase(),
    pathname: parsed.pathname,
  };
}

export function titleizeTravelSlug(value: string): string {
  const cleaned = safeDecode(value)
    .replace(/\.(html?|aspx?)$/i, "")
    .replace(/(?:^|-)(?:tickets?|events?|artist|performer|grouping|find-your-tickets)$/gi, "")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      if (/^(nba|mls|bts|r&b)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function resolveTicketmaster(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: "ticketmaster",
): ResolvedTravelLink {
  const eventMatch = parsed.pathname.match(EVENT_ID_RE);
  if (eventMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "exact_event",
      providerPageId: eventMatch[1],
      normalizedUrl: cleanUrlThroughMarker(parsed, "event", eventMatch[1]),
      titleHint: titleHintBeforeMarker(parsed.pathname, "event"),
      confidence: 0.93,
      executionMode: "direct_execution",
      needsUserChoice: false,
      matchedPattern: "ticketmaster_event",
    });
  }

  const artistMatch = parsed.pathname.match(ARTIST_ID_RE);
  if (artistMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "artist",
      providerPageId: artistMatch[1],
      normalizedUrl: cleanUrlThroughMarker(parsed, "artist", artistMatch[1]),
      titleHint: titleHintBeforeMarker(parsed.pathname, "artist"),
      confidence: 0.88,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "ticketmaster_artist",
    });
  }

  if (pathSegments(parsed.pathname)[0]?.toLowerCase() === "search") {
    return activityLink({
      parsed,
      provider,
      pageType: "search_results",
      providerPageId: "search",
      titleHint: "Ticketmaster Search",
      confidence: 0.58,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "ticketmaster_search",
    });
  }

  return genericActivityLink(parsed, provider, "ticketmaster_provider_listing");
}

function resolveStubHub(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: "stubhub",
): ResolvedTravelLink {
  if (isProviderCheckoutBoundary(parsed)) {
    return activityLink({
      parsed,
      provider,
      pageType: "unknown_provider_page",
      providerPageId: "checkout",
      titleHint: "StubHub Checkout",
      confidence: 0.94,
      executionMode: "review_capture",
      needsUserChoice: true,
      safeNextAction: "review_capture",
      matchedPattern: "stubhub_checkout_boundary",
    });
  }

  const eventMatch = parsed.pathname.match(STUBHUB_EVENT_RE);
  if (eventMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "exact_event",
      providerPageId: eventMatch[1],
      titleHint: titleHintBeforeMarker(parsed.pathname, "event"),
      confidence: 0.86,
      executionMode: "direct_execution",
      needsUserChoice: false,
      matchedPattern: "stubhub_event",
    });
  }

  const performerMatch = parsed.pathname.match(STUBHUB_PERFORMER_RE);
  if (performerMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "performer",
      providerPageId: performerMatch[1],
      titleHint: titleHintBeforeMarker(parsed.pathname, "performer"),
      confidence: 0.88,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "stubhub_performer",
    });
  }

  const groupingMatch = parsed.pathname.match(STUBHUB_GROUPING_RE);
  if (groupingMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "grouping",
      providerPageId: groupingMatch[1],
      titleHint: titleHintBeforeMarker(parsed.pathname, "grouping"),
      confidence: 0.84,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "stubhub_grouping",
    });
  }

  return genericActivityLink(parsed, provider, "stubhub_provider_listing");
}

function resolveSeatGeek(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: "seatgeek",
): ResolvedTravelLink {
  const segments = pathSegments(parsed.pathname);
  const idMatch = parsed.pathname.match(SEATGEEK_EVENT_ID_RE);
  const hasDateSegment = segments.some((segment) => SEATGEEK_DATE_SEGMENT_RE.test(segment));
  if (idMatch?.[1] && hasDateSegment) {
    return activityLink({
      parsed,
      provider,
      pageType: "exact_event",
      providerPageId: idMatch[1],
      titleHint: titleizeTravelSlug(segments[0] ?? ""),
      confidence: 0.9,
      executionMode: "direct_execution",
      needsUserChoice: false,
      matchedPattern: "seatgeek_dated_event",
    });
  }

  return activityLink({
    parsed,
    provider,
    pageType: "provider_listing",
    providerPageId: segments[0] ?? parsed.hostname,
    titleHint: titleizeTravelSlug(segments[0] ?? ""),
    confidence: 0.78,
    executionMode: "provider_start",
    needsUserChoice: true,
    matchedPattern: "seatgeek_listing",
  });
}

function resolveEventbrite(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: "eventbrite",
): ResolvedTravelLink {
  const eventMatch = parsed.pathname.match(EVENTBRITE_EVENT_RE);
  if (eventMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "exact_event",
      providerPageId: eventMatch[1],
      titleHint: titleHintBeforeMarker(parsed.pathname, "e"),
      confidence: 0.82,
      executionMode: "direct_execution",
      needsUserChoice: false,
      matchedPattern: "eventbrite_event",
    });
  }
  return genericActivityLink(parsed, provider, "eventbrite_provider_listing");
}

function resolveAxs(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: "axs",
): ResolvedTravelLink {
  const eventMatch = parsed.pathname.match(AXS_EVENT_RE);
  if (eventMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "exact_event",
      providerPageId: eventMatch[1],
      normalizedUrl: cleanUrlThroughMarker(parsed, "events", eventMatch[1]),
      titleHint: titleHintAfterMarkerId(parsed.pathname, "events"),
      confidence: 0.84,
      executionMode: "direct_execution",
      needsUserChoice: false,
      matchedPattern: "axs_event",
    });
  }

  const artistMatch = parsed.pathname.match(AXS_ARTIST_RE);
  if (artistMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "artist",
      providerPageId: artistMatch[1],
      normalizedUrl: cleanUrlThroughMarker(parsed, "artists", artistMatch[1]),
      titleHint: titleHintAfterMarkerId(parsed.pathname, "artists"),
      confidence: 0.78,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "axs_artist",
    });
  }

  const seriesMatch = parsed.pathname.match(AXS_SERIES_RE);
  if (seriesMatch?.[1]) {
    return activityLink({
      parsed,
      provider,
      pageType: "grouping",
      providerPageId: seriesMatch[1],
      normalizedUrl: cleanUrlThroughMarker(parsed, "series", seriesMatch[1]),
      titleHint: titleHintAfterMarkerId(parsed.pathname, "series"),
      confidence: 0.74,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "axs_series",
    });
  }

  if (pathSegments(parsed.pathname)[0]?.toLowerCase() === "search") {
    return activityLink({
      parsed,
      provider,
      pageType: "search_results",
      providerPageId: "search",
      titleHint: "AXS Search",
      confidence: 0.62,
      executionMode: "provider_start",
      needsUserChoice: true,
      matchedPattern: "axs_search",
    });
  }

  return genericActivityLink(parsed, provider, "axs_provider_listing");
}

function genericActivityLink(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: Exclude<TravelLinkProvider, "unknown">,
  matchedPattern: string,
): ResolvedTravelLink {
  const firstSegment = pathSegments(parsed.pathname)[0] ?? "";
  return activityLink({
    parsed,
    provider,
    pageType: "provider_listing",
    providerPageId: firstSegment || parsed.hostname,
    titleHint: titleizeTravelSlug(firstSegment),
    confidence: 0.62,
    executionMode: "provider_start",
    needsUserChoice: true,
    matchedPattern,
  });
}

function activityLink(input: {
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>;
  provider: Exclude<TravelLinkProvider, "unknown">;
  pageType: TravelLinkPageType;
  providerPageId: string;
  normalizedUrl?: string;
  titleHint: string;
  confidence: number;
  executionMode: TravelLinkExecutionMode;
  needsUserChoice: boolean;
  safeNextAction?: ResolvedTravelLink["safe_next_action"];
  matchedPattern: string;
}): ResolvedTravelLink {
  return {
    original_url: input.parsed.original,
    normalized_url: input.normalizedUrl ?? input.parsed.url,
    host: input.parsed.hostname,
    provider: input.provider,
    vertical: "activity",
    page_type: input.pageType,
    provider_page_id: input.providerPageId,
    ...(input.titleHint ? { title_hint: input.titleHint } : {}),
    confidence: input.confidence,
    execution_mode: input.executionMode,
    needs_user_choice: input.needsUserChoice,
    safe_next_action: input.safeNextAction ?? "start_task",
    evidence: {
      source: "url_pattern",
      matched_pattern: input.matchedPattern,
      ...(input.titleHint ? { title_source: "slug" } : {}),
    },
  };
}

function cleanUrlThroughMarker(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  marker: string,
  id: string,
): string {
  const path = parsed.pathname;
  const markerPath = `/${marker}/`;
  const markerIndex = path.toLowerCase().indexOf(markerPath);
  if (markerIndex < 0) return parsed.url;
  const prefix = path.slice(0, markerIndex + markerPath.length);
  const url = new URL(parsed.url);
  return `${url.origin}${prefix}${id}${url.search}${url.hash}`;
}

function detectActivityProvider(host: string): { provider: Exclude<TravelLinkProvider, "unknown"> } | null {
  for (const entry of KNOWN_ACTIVITY_HOSTS) {
    if (entry.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return { provider: entry.provider };
    }
  }
  return null;
}

function isProviderCheckoutBoundary(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
): boolean {
  return /^checkout\./i.test(parsed.hostname) ||
    /\/(?:secure\/buy\/)?checkout(?:[/?#]|$)/i.test(parsed.pathname);
}

function titleHintBeforeMarker(pathname: string, marker: string): string {
  const segments = pathSegments(pathname);
  const markerIndex = segments.findIndex((segment) => segment.toLowerCase() === marker.toLowerCase());
  const source = markerIndex > 0 ? segments[markerIndex - 1] : segments[0] ?? "";
  return titleizeTravelSlug(source);
}

function titleHintAfterMarkerId(pathname: string, marker: string): string {
  const segments = pathSegments(pathname);
  const markerIndex = segments.findIndex((segment) => segment.toLowerCase() === marker.toLowerCase());
  const source = markerIndex >= 0 ? segments[markerIndex + 2] ?? "" : segments[0] ?? "";
  return titleizeTravelSlug(source);
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
