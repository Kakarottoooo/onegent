export type DirectActivityProvider = "ticketmaster";

export interface DirectActivityProviderUrl {
  provider: DirectActivityProvider;
  url: string;
  host: string;
  eventId: string;
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
  if (!eventMatch) return null;

  const eventId = eventMatch[2];
  if (!eventId) return null;

  const cleanPath = `${eventMatch[1]}${eventId}`;
  return {
    provider: "ticketmaster",
    url: `${parsed.origin}${cleanPath}${parsed.search}${parsed.hash}`,
    host,
    eventId,
  };
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
}): string {
  const datePart = input.eventDate ? ` on ${input.eventDate}` : "";
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
