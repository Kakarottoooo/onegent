export type DirectActivityProvider = "ticketmaster";
export type DirectActivityProviderPageType = "event" | "artist";

export interface DirectActivityProviderUrl {
  provider: DirectActivityProvider;
  pageType: DirectActivityProviderPageType;
  url: string;
  host: string;
  providerPageId: string;
  eventId?: string;
  artistId?: string;
}

const TICKETMASTER_HOSTS = [
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
] as const;

const EVENT_ID_RE = /^(.*\/event\/)([A-Za-z0-9_-]+)/i;
const ARTIST_ID_RE = /^(.*\/artist\/)([A-Za-z0-9_-]+)/i;

export function parseDirectActivityProviderUrl(value: unknown): DirectActivityProviderUrl | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase();
  if (!isTicketmasterHost(host)) return null;

  const eventMatch = parsed.pathname.match(EVENT_ID_RE);
  if (eventMatch) {
    const eventId = eventMatch[2];
    if (!eventId) return null;

    const cleanPath = `${eventMatch[1]}${eventId}`;
    return {
      provider: "ticketmaster",
      pageType: "event",
      url: `${parsed.origin}${cleanPath}${parsed.search}${parsed.hash}`,
      host,
      providerPageId: eventId,
      eventId,
    };
  }

  const artistMatch = parsed.pathname.match(ARTIST_ID_RE);
  if (artistMatch) {
    const artistId = artistMatch[2];
    if (!artistId) return null;

    const cleanPath = `${artistMatch[1]}${artistId}`;
    return {
      provider: "ticketmaster",
      pageType: "artist",
      url: `${parsed.origin}${cleanPath}${parsed.search}${parsed.hash}`,
      host,
      providerPageId: artistId,
      artistId,
    };
  }

  return null;
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
  pageType?: DirectActivityProviderPageType;
}): string {
  const datePart = input.eventDate ? ` on ${input.eventDate}` : "";
  if (input.pageType === "artist") {
    return [
      `Start from this exact Ticketmaster artist page URL: ${input.providerUrl}.`,
      `Book ${input.numTickets} ticket${input.numTickets === 1 ? "" : "s"} for "${input.eventName}"${datePart}.`,
      "Do not use generic event search or replace it with an unrelated Ticketmaster page.",
      "Use the events shown on this provider page to continue.",
      "If multiple events, dates, or seats require a choice, pause for the user to choose.",
      "Fill allowed saved profile fields after user selection and stop before the final purchase or confirmation action.",
    ].join(" ");
  }
  return [
    `Use this exact Ticketmaster event URL: ${input.providerUrl}.`,
    `Book ${input.numTickets} ticket${input.numTickets === 1 ? "" : "s"} for "${input.eventName}"${datePart}.`,
    "Do not search for or replace it with a different Ticketmaster event URL.",
    "If this exact provider page is unavailable or not found, stop and report that exact provider-link problem.",
    "If ticket or seat selection is required, pause for the user to choose.",
    "Fill allowed saved profile fields after user selection and stop before the final purchase or confirmation action.",
  ].join(" ");
}

function isTicketmasterHost(host: string): boolean {
  return TICKETMASTER_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
