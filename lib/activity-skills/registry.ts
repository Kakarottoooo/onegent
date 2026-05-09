import {
  normalizeTravelUrl,
  titleizeTravelSlug,
} from "@/lib/capture/travel-link-resolver";
import type {
  ActivityProviderSkill,
  ActivitySkillEvidenceContract,
  ActivitySkillHardStop,
  ActivitySkillPageType,
  ActivitySkillProvider,
  ActivitySkillResolvedProvider,
  ActivitySkillSafeNextAction,
  ActivitySkillUrlMatch,
} from "./types";

const COMMON_HARD_STOPS: ActivitySkillHardStop[] = [
  "seat_selection",
  "login",
  "account_verification",
  "captcha",
  "otp",
  "payment",
  "final_purchase",
  "final_confirmation",
];

const ACTIVITY_EVIDENCE_CONTRACT: ActivitySkillEvidenceContract = {
  requiredSources: [
    "provider",
    "page_type",
    "input_url",
    "current_url",
    "visible_title_or_event_name",
    "visible_candidate_facts",
    "screenshot",
    "action_log",
    "final_state",
    "safe_next_action",
  ],
  minimumForLabRun: [
    "provider",
    "page_type",
    "current_url",
    "screenshot",
    "action_log",
    "visible_candidate_facts",
    "safe_next_action",
  ],
};

const HOSTS: Record<ActivitySkillProvider, readonly string[]> = {
  ticketmaster: [
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
  seatgeek: ["seatgeek.com"],
  stubhub: ["stubhub.com"],
  eventbrite: ["eventbrite.com"],
  axs: ["axs.com"],
};

const TICKETMASTER_EVENT_RE = /\/event\/([A-Za-z0-9_-]+)/i;
const TICKETMASTER_ARTIST_RE = /\/artist\/([A-Za-z0-9_-]+)/i;
const SEATGEEK_EVENT_ID_RE = /\/(?:[^/?#]+\/)*([0-9]{5,})(?:[/?#]|$)/i;
const SEATGEEK_DATE_SEGMENT_RE = /\b20\d{2}-\d{2}-\d{2}(?:-\d{1,2}(?:-\d{2})?-(?:am|pm))?\b/i;
const STUBHUB_PERFORMER_RE = /\/performer\/([A-Za-z0-9_-]+)/i;
const STUBHUB_GROUPING_RE = /\/grouping\/([A-Za-z0-9_-]+)/i;
const STUBHUB_EVENT_RE = /\/event\/([A-Za-z0-9_-]+)/i;
const EVENTBRITE_EVENT_RE = /\/e\/.+?(?:tickets-)?([0-9]{5,})(?:[/?#]|$)/i;
const EVENTBRITE_ORGANIZER_RE = /\/o\/(?:[^/?#]+-)?([0-9]{5,})(?:[/?#]|$)/i;
const AXS_EVENT_RE = /\/events\/([A-Za-z0-9_-]+)/i;
const AXS_ARTIST_RE = /\/artists\/([A-Za-z0-9_-]+)/i;
const AXS_SERIES_RE = /\/series\/([A-Za-z0-9_-]+)/i;

export const ACTIVITY_PROVIDER_SKILLS: ActivityProviderSkill[] = [
  buildSkill("ticketmaster", ["exact_event", "artist_or_performer", "listing", "search_results"], resolveTicketmasterUrl),
  buildSkill("seatgeek", ["exact_event", "listing"], resolveSeatGeekUrl),
  buildSkill("stubhub", ["exact_event", "artist_or_performer", "grouping", "listing"], resolveStubHubUrl),
  buildSkill("eventbrite", ["exact_event", "listing", "search_results"], resolveEventbriteUrl),
  buildSkill("axs", ["exact_event", "artist_or_performer", "grouping", "listing", "search_results"], resolveAxsUrl),
];

export function resolveActivityProviderSkillUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = normalizeTravelUrl(value);
  if (!parsed) return null;
  for (const skill of ACTIVITY_PROVIDER_SKILLS) {
    const match = skill.canHandleUrl(parsed.url);
    if (match) return match;
  }
  return unknownProviderMatch(parsed);
}

export function findActivityProviderSkill(
  provider: ActivitySkillProvider,
): ActivityProviderSkill | null {
  return ACTIVITY_PROVIDER_SKILLS.find((skill) => skill.provider === provider) ?? null;
}

export function isActivitySkillExactEvent(match: ActivitySkillUrlMatch): boolean {
  return match.provider !== "unknown" &&
    match.pageType === "exact_event" &&
    match.executionMode === "direct_execution" &&
    !match.needsUserChoice;
}

function buildSkill(
  provider: ActivitySkillProvider,
  pageTypes: ActivitySkillPageType[],
  resolver: (value: unknown) => ActivitySkillUrlMatch | null,
): ActivityProviderSkill {
  return {
    provider,
    pageTypes,
    requiredInputs: ["input_url"],
    safeActions: [
      "open provider page",
      "inspect visible events and dates",
      "collect candidate evidence",
      "click through only before user-controlled boundaries",
      "stop and ask the user when choices are ambiguous",
    ],
    hardStops: [...COMMON_HARD_STOPS],
    evidenceContract: ACTIVITY_EVIDENCE_CONTRACT,
    canHandleUrl: resolver,
  };
}

function resolveTicketmasterUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = parseProviderUrl(value, "ticketmaster");
  if (!parsed) return null;
  const event = parsed.pathname.match(TICKETMASTER_EVENT_RE)?.[1];
  if (event) {
    return providerMatch({
      parsed,
      provider: "ticketmaster",
      pageType: "exact_event",
      providerPageId: event,
      titleHint: titleHintBeforeMarker(parsed.pathname, "event"),
      confidence: 0.93,
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      matchedPattern: "ticketmaster_event",
    });
  }
  const artist = parsed.pathname.match(TICKETMASTER_ARTIST_RE)?.[1];
  if (artist) {
    return providerMatch({
      parsed,
      provider: "ticketmaster",
      pageType: "artist_or_performer",
      providerPageId: artist,
      titleHint: titleHintBeforeMarker(parsed.pathname, "artist"),
      confidence: 0.88,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "ticketmaster_artist",
    });
  }
  if (firstSegment(parsed.pathname) === "search") {
    return providerMatch({
      parsed,
      provider: "ticketmaster",
      pageType: "search_results",
      providerPageId: "search",
      titleHint: "Ticketmaster Search",
      confidence: 0.58,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "ticketmaster_search",
    });
  }
  return listingMatch(parsed, "ticketmaster", "ticketmaster_listing");
}

function resolveSeatGeekUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = parseProviderUrl(value, "seatgeek");
  if (!parsed) return null;
  const id = parsed.pathname.match(SEATGEEK_EVENT_ID_RE)?.[1];
  const hasDate = pathSegments(parsed.pathname).some((segment) => SEATGEEK_DATE_SEGMENT_RE.test(segment));
  if (id && hasDate) {
    return providerMatch({
      parsed,
      provider: "seatgeek",
      pageType: "exact_event",
      providerPageId: id,
      titleHint: titleizeTravelSlug(firstSegment(parsed.pathname)),
      confidence: 0.9,
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      matchedPattern: "seatgeek_dated_event",
    });
  }
  return listingMatch(parsed, "seatgeek", "seatgeek_listing");
}

function resolveStubHubUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = parseProviderUrl(value, "stubhub");
  if (!parsed) return null;
  if (isProviderCheckoutBoundary(parsed)) {
    return boundaryMatch(parsed, "stubhub", "stubhub_checkout_boundary");
  }
  const event = parsed.pathname.match(STUBHUB_EVENT_RE)?.[1];
  if (event) {
    return providerMatch({
      parsed,
      provider: "stubhub",
      pageType: "exact_event",
      providerPageId: event,
      titleHint: titleHintBeforeMarker(parsed.pathname, "event"),
      confidence: 0.86,
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      matchedPattern: "stubhub_event",
    });
  }
  const performer = parsed.pathname.match(STUBHUB_PERFORMER_RE)?.[1];
  if (performer) {
    return providerMatch({
      parsed,
      provider: "stubhub",
      pageType: "artist_or_performer",
      providerPageId: performer,
      titleHint: titleHintBeforeMarker(parsed.pathname, "performer"),
      confidence: 0.88,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "stubhub_performer",
    });
  }
  const grouping = parsed.pathname.match(STUBHUB_GROUPING_RE)?.[1];
  if (grouping) {
    return providerMatch({
      parsed,
      provider: "stubhub",
      pageType: "grouping",
      providerPageId: grouping,
      titleHint: titleHintBeforeMarker(parsed.pathname, "grouping"),
      confidence: 0.84,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "stubhub_grouping",
    });
  }
  return listingMatch(parsed, "stubhub", "stubhub_listing");
}

function resolveEventbriteUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = parseProviderUrl(value, "eventbrite");
  if (!parsed) return null;
  const segments = pathSegments(parsed.pathname);
  const event = parsed.pathname.match(EVENTBRITE_EVENT_RE)?.[1];
  if (event) {
    return providerMatch({
      parsed,
      provider: "eventbrite",
      pageType: "exact_event",
      providerPageId: event,
      titleHint: titleHintBeforeMarker(parsed.pathname, "e"),
      confidence: 0.82,
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      matchedPattern: "eventbrite_event",
    });
  }
  const organizer = parsed.pathname.match(EVENTBRITE_ORGANIZER_RE)?.[1];
  if (organizer) {
    return providerMatch({
      parsed,
      provider: "eventbrite",
      pageType: "listing",
      providerPageId: organizer,
      titleHint: titleHintBeforeMarker(parsed.pathname, "o"),
      confidence: 0.76,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "eventbrite_organizer",
    });
  }
  const first = segments[0]?.toLowerCase();
  if (first === "search") {
    return providerMatch({
      parsed,
      provider: "eventbrite",
      pageType: "search_results",
      providerPageId: "search",
      titleHint: "Eventbrite Search",
      confidence: 0.62,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "eventbrite_search",
    });
  }
  if (first === "d" || first === "b") {
    const pageId = segments.slice(1).join("/") || first;
    const titleSource =
      [...segments]
        .reverse()
        .find((segment) => !/^(events?|tickets?)$/i.test(segment)) ?? first;
    return providerMatch({
      parsed,
      provider: "eventbrite",
      pageType: "listing",
      providerPageId: pageId,
      titleHint: titleizeTravelSlug(titleSource),
      confidence: 0.72,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "eventbrite_city_category_listing",
    });
  }
  return listingMatch(parsed, "eventbrite", "eventbrite_listing");
}

function resolveAxsUrl(value: unknown): ActivitySkillUrlMatch | null {
  const parsed = parseProviderUrl(value, "axs");
  if (!parsed) return null;
  const event = parsed.pathname.match(AXS_EVENT_RE)?.[1];
  if (event) {
    return providerMatch({
      parsed,
      provider: "axs",
      pageType: "exact_event",
      providerPageId: event,
      titleHint: titleHintBeforeMarker(parsed.pathname, "events"),
      confidence: 0.84,
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
      matchedPattern: "axs_event",
    });
  }
  const artist = parsed.pathname.match(AXS_ARTIST_RE)?.[1];
  if (artist) {
    return providerMatch({
      parsed,
      provider: "axs",
      pageType: "artist_or_performer",
      providerPageId: artist,
      titleHint: titleHintBeforeMarker(parsed.pathname, "artists"),
      confidence: 0.78,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "axs_artist",
    });
  }
  const series = parsed.pathname.match(AXS_SERIES_RE)?.[1];
  if (series) {
    return providerMatch({
      parsed,
      provider: "axs",
      pageType: "grouping",
      providerPageId: series,
      titleHint: titleHintBeforeMarker(parsed.pathname, "series"),
      confidence: 0.74,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "axs_series",
    });
  }
  if (firstSegment(parsed.pathname).toLowerCase() === "search") {
    return providerMatch({
      parsed,
      provider: "axs",
      pageType: "search_results",
      providerPageId: "search",
      titleHint: "AXS Search",
      confidence: 0.62,
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
      matchedPattern: "axs_search",
    });
  }
  return listingMatch(parsed, "axs", "axs_listing");
}

function parseProviderUrl(value: unknown, provider: ActivitySkillProvider) {
  const parsed = normalizeTravelUrl(value);
  if (!parsed) return null;
  return hostMatchesProvider(parsed.hostname, provider) ? parsed : null;
}

function hostMatchesProvider(host: string, provider: ActivitySkillProvider): boolean {
  return HOSTS[provider].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function listingMatch(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: ActivitySkillProvider,
  matchedPattern: string,
): ActivitySkillUrlMatch {
  const segment = firstSegment(parsed.pathname);
  return providerMatch({
    parsed,
    provider,
    pageType: "listing",
    providerPageId: segment || parsed.hostname,
    titleHint: titleizeTravelSlug(segment),
    confidence: 0.62,
    executionMode: "provider_start",
    needsUserChoice: true,
    safeNextAction: "ask_user_to_choose",
    matchedPattern,
  });
}

function providerMatch(input: {
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>;
  provider: ActivitySkillProvider;
  pageType: ActivitySkillPageType;
  providerPageId: string;
  titleHint: string;
  confidence: number;
  executionMode: "direct_execution" | "provider_start";
  needsUserChoice: boolean;
  safeNextAction: ActivitySkillSafeNextAction;
  matchedPattern: string;
}): ActivitySkillUrlMatch {
  return {
    provider: input.provider,
    pageType: input.pageType,
    inputUrl: input.parsed.original,
    normalizedUrl: input.parsed.url,
    host: input.parsed.hostname,
    providerPageId: input.providerPageId,
    ...(input.titleHint ? { titleHint: input.titleHint } : {}),
    confidence: input.confidence,
    executionMode: input.executionMode,
    needsUserChoice: input.needsUserChoice,
    safeNextAction: input.safeNextAction,
    evidence: {
      source: "url_pattern",
      matchedPattern: input.matchedPattern,
      ...(input.titleHint ? { titleSource: "slug" } : {}),
    },
  };
}

function boundaryMatch(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
  provider: ActivitySkillProvider,
  matchedPattern: string,
): ActivitySkillUrlMatch {
  return {
    provider,
    pageType: "unknown_provider_page",
    inputUrl: parsed.original,
    normalizedUrl: parsed.url,
    host: parsed.hostname,
    providerPageId: "checkout",
    titleHint: `${providerLabel(provider)} Checkout`,
    confidence: 0.94,
    executionMode: "review_capture",
    needsUserChoice: true,
    safeNextAction: "review_capture",
    evidence: {
      source: "url_pattern",
      matchedPattern,
      titleSource: "slug",
    },
  };
}

function isProviderCheckoutBoundary(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
): boolean {
  return /^checkout\./i.test(parsed.hostname) ||
    /\/(?:secure\/buy\/)?checkout(?:[/?#]|$)/i.test(parsed.pathname);
}

function providerLabel(provider: ActivitySkillProvider): string {
  if (provider === "ticketmaster") return "Ticketmaster";
  if (provider === "seatgeek") return "SeatGeek";
  if (provider === "stubhub") return "StubHub";
  if (provider === "eventbrite") return "Eventbrite";
  return "AXS";
}

function unknownProviderMatch(
  parsed: NonNullable<ReturnType<typeof normalizeTravelUrl>>,
): ActivitySkillUrlMatch {
  return {
    provider: "unknown",
    pageType: "unknown_provider_page",
    inputUrl: parsed.original,
    normalizedUrl: parsed.url,
    host: parsed.hostname,
    confidence: 0.2,
    executionMode: "review_capture",
    needsUserChoice: true,
    safeNextAction: "review_capture",
    evidence: {
      source: "url_pattern",
      matchedPattern: "unknown_host",
    },
  };
}

function titleHintBeforeMarker(pathname: string, marker: string): string {
  const segments = pathSegments(pathname);
  const markerIndex = segments.findIndex((segment) => segment.toLowerCase() === marker.toLowerCase());
  const source = markerIndex > 0 ? segments[markerIndex - 1] : segments[0] ?? "";
  return titleizeTravelSlug(source);
}

function firstSegment(pathname: string): string {
  return pathSegments(pathname)[0] ?? "";
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}
