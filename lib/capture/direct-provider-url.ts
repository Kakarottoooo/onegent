import {
  resolveTravelLinkFromUrl,
  type ResolvedTravelLink,
  type TravelLinkProvider,
  type TravelLinkPageType,
} from "@/lib/capture/travel-link-resolver";

export type DirectActivityProvider = Extract<
  TravelLinkProvider,
  "ticketmaster" | "stubhub" | "seatgeek" | "eventbrite"
>;
export type DirectActivityProviderPageType =
  | "event"
  | "artist"
  | "performer"
  | "grouping"
  | "search"
  | "listing";

export interface DirectActivityProviderUrl {
  provider: DirectActivityProvider;
  pageType: DirectActivityProviderPageType;
  url: string;
  host: string;
  providerPageId: string;
  titleHint?: string;
  needsUserChoice: boolean;
  executionMode: "direct_execution" | "provider_start";
  eventId?: string;
  artistId?: string;
  performerId?: string;
  groupingId?: string;
}

export function parseDirectActivityProviderUrl(value: unknown): DirectActivityProviderUrl | null {
  const resolved = resolveTravelLinkFromUrl(value);
  if (!resolved || resolved.vertical !== "activity") return null;
  if (!isDirectActivityProvider(resolved.provider)) return null;
  if (resolved.safe_next_action !== "start_task") return null;
  return directActivityFromResolved(resolved);
}

export function readDirectActivityProviderUrlFromConstraints(
  constraints: Record<string, unknown>,
): DirectActivityProviderUrl | null {
  const directKeys = [
    "source_url",
    "event_url",
    "provider_url",
    "booking_link",
    "startUrl",
  ] as const;
  for (const key of directKeys) {
    const parsed = parseDirectActivityProviderUrl(constraints[key]);
    if (parsed) return parsed;
  }

  const source = constraints._capture_source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const parsed = parseDirectActivityProviderUrl((source as { url?: unknown }).url);
    if (parsed) return parsed;
  }

  return null;
}

export function buildDirectActivityTask(input: {
  eventName: string;
  eventDate?: string | null;
  numTickets: number;
  providerUrl: string;
  provider?: DirectActivityProvider;
  pageType?: DirectActivityProviderPageType;
}): string {
  const datePart = input.eventDate ? ` on ${input.eventDate}` : "";
  const providerLabel = labelForProvider(input.provider ?? "ticketmaster");
  if (input.pageType && input.pageType !== "event") {
    const pageLabel = labelForPageType(input.pageType);
    return [
      `Start from this exact ${providerLabel} ${pageLabel} page URL: ${input.providerUrl}.`,
      `Book ${input.numTickets} ticket${input.numTickets === 1 ? "" : "s"} for "${input.eventName}"${datePart}.`,
      `Do not use generic event search or replace it with an unrelated ${providerLabel} page.`,
      "Use the events, listings, dates, or cities shown on this provider page to continue.",
      "If multiple events, dates, or seats require a choice, pause for the user to choose.",
      "Fill allowed saved profile fields after user selection and stop before the final purchase or confirmation action.",
    ].join(" ");
  }
  return [
    `Use this exact ${providerLabel} event URL: ${input.providerUrl}.`,
    `Book ${input.numTickets} ticket${input.numTickets === 1 ? "" : "s"} for "${input.eventName}"${datePart}.`,
    `Do not search for or replace it with a different ${providerLabel} event URL.`,
    "If this exact provider page is unavailable or not found, stop and report that exact provider-link problem.",
    "If ticket or seat selection is required, pause for the user to choose.",
    "Fill allowed saved profile fields after user selection and stop before the final purchase or confirmation action.",
  ].join(" ");
}

function directActivityFromResolved(resolved: ResolvedTravelLink): DirectActivityProviderUrl | null {
  if (!resolved.provider_page_id) return null;
  const pageType = mapPageType(resolved.page_type);
  if (!pageType) return null;
  const provider = resolved.provider as DirectActivityProvider;
  return {
    provider,
    pageType,
    url: resolved.normalized_url,
    host: resolved.host,
    providerPageId: resolved.provider_page_id,
    ...(resolved.title_hint ? { titleHint: resolved.title_hint } : {}),
    needsUserChoice: resolved.needs_user_choice,
    executionMode: resolved.execution_mode === "direct_execution" ? "direct_execution" : "provider_start",
    ...(pageType === "event" ? { eventId: resolved.provider_page_id } : {}),
    ...(pageType === "artist" ? { artistId: resolved.provider_page_id } : {}),
    ...(pageType === "performer" ? { performerId: resolved.provider_page_id } : {}),
    ...(pageType === "grouping" ? { groupingId: resolved.provider_page_id } : {}),
  };
}

function isDirectActivityProvider(provider: TravelLinkProvider): provider is DirectActivityProvider {
  return provider === "ticketmaster" || provider === "stubhub" || provider === "seatgeek" || provider === "eventbrite";
}

function mapPageType(pageType: TravelLinkPageType): DirectActivityProviderPageType | null {
  if (pageType === "exact_event") return "event";
  if (pageType === "artist") return "artist";
  if (pageType === "performer") return "performer";
  if (pageType === "grouping") return "grouping";
  if (pageType === "search_results") return "search";
  if (pageType === "provider_listing") return "listing";
  return null;
}

function labelForProvider(provider: DirectActivityProvider): string {
  if (provider === "ticketmaster") return "Ticketmaster";
  if (provider === "stubhub") return "StubHub";
  if (provider === "seatgeek") return "SeatGeek";
  if (provider === "eventbrite") return "Eventbrite";
  return "provider";
}

function labelForPageType(pageType: DirectActivityProviderPageType): string {
  if (pageType === "artist") return "artist";
  if (pageType === "performer") return "performer";
  if (pageType === "grouping") return "collection";
  if (pageType === "search") return "search results";
  return "listing";
}
