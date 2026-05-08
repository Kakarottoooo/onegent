import {
  extractTextFromGoogleGmailMessage,
  getGoogleGmailHeader,
  type GoogleGmailMessage,
} from "@/lib/google-gmail";

export type ProviderOtpSource = "ticketmaster" | "resy" | "opentable";

export interface ProviderOtpConfig {
  provider: ProviderOtpSource;
  displayName: string;
  fromTerms: string[];
  textHints: string[];
}

export interface GmailOtpQueryParams {
  provider: ProviderOtpSource;
  windowMinutes?: number;
}

export interface GmailOtpMatch {
  status: "found";
  provider: ProviderOtpSource;
  code: string;
  messageId: string;
  receivedAt: string | null;
  from: string | null;
  subject: string | null;
  query: string;
}

export interface GmailOtpMiss {
  status: "not_found";
  provider: ProviderOtpSource;
  query: string;
  checkedMessageIds: string[];
  reason: "no_provider_message" | "no_recent_message" | "no_otp_code";
}

export type GmailOtpExtractionResult = GmailOtpMatch | GmailOtpMiss;

export const PROVIDER_OTP_CONFIGS: Readonly<Record<ProviderOtpSource, ProviderOtpConfig>> =
  Object.freeze({
    ticketmaster: {
      provider: "ticketmaster",
      displayName: "Ticketmaster",
      fromTerms: ["ticketmaster", "ticketmaster.com"],
      textHints: [
        "ticketmaster",
        "verification code",
        "one-time code",
        "security code",
        "sign in",
        "login",
      ],
    },
    resy: {
      provider: "resy",
      displayName: "Resy",
      fromTerms: ["resy", "resy.com"],
      textHints: ["resy", "verification code", "one-time code", "security code"],
    },
    opentable: {
      provider: "opentable",
      displayName: "OpenTable",
      fromTerms: ["opentable", "opentable.com"],
      textHints: [
        "opentable",
        "verification code",
        "one-time code",
        "security code",
      ],
    },
  });

export function buildProviderOtpGmailQuery(params: GmailOtpQueryParams): string {
  const config = PROVIDER_OTP_CONFIGS[params.provider];
  const windowMinutes = clampWindowMinutes(params.windowMinutes ?? 15);
  const fromClause = config.fromTerms
    .map((term) => `from:${escapeGmailQueryTerm(term)}`)
    .join(" OR ");
  return `newer_than:${windowMinutes}m (${fromClause}) ("verification code" OR "one-time code" OR "security code" OR OTP OR login OR signin)`;
}

export function findProviderOtpInGmailMessages(params: {
  provider: ProviderOtpSource;
  query: string;
  messages: GoogleGmailMessage[];
  requestedAt?: Date;
  windowMinutes?: number;
}): GmailOtpExtractionResult {
  const checkedMessageIds: string[] = [];
  const requestedAt = params.requestedAt ?? new Date();
  const oldestAllowed = requestedAt.getTime() - clampWindowMinutes(params.windowMinutes ?? 15) * 60_000;
  let sawProviderMessage = false;
  let sawRecentMessage = false;

  for (const message of params.messages) {
    checkedMessageIds.push(message.id);
    if (!messageMatchesProvider(params.provider, message)) continue;
    sawProviderMessage = true;

    const receivedAt = parseInternalDate(message.internalDate);
    if (receivedAt !== null && receivedAt < oldestAllowed) continue;
    sawRecentMessage = true;

    const text = extractTextFromGoogleGmailMessage(message);
    if (!looksLikeOtpText(params.provider, text)) continue;
    const code = extractOtpCodeFromText(text);
    if (!code) continue;

    return {
      status: "found",
      provider: params.provider,
      code,
      messageId: message.id,
      receivedAt: receivedAt === null ? null : new Date(receivedAt).toISOString(),
      from: getGoogleGmailHeader(message, "From"),
      subject: getGoogleGmailHeader(message, "Subject"),
      query: params.query,
    };
  }

  return {
    status: "not_found",
    provider: params.provider,
    query: params.query,
    checkedMessageIds,
    reason: !sawProviderMessage
      ? "no_provider_message"
      : !sawRecentMessage
        ? "no_recent_message"
        : "no_otp_code",
  };
}

export function extractOtpCodeFromText(text: string): string | null {
  const compact = text.replace(/\s+/g, " ");
  const preferred = /(?:code|otp|verification|security)[^\d]{0,40}(\d{6})(?!\d)/i.exec(compact);
  if (preferred) return preferred[1];
  const fallback = /(^|[^\d])(\d{6})(?!\d)/.exec(compact);
  return fallback?.[2] ?? null;
}

export function messageMatchesProvider(
  provider: ProviderOtpSource,
  message: GoogleGmailMessage,
): boolean {
  const config = PROVIDER_OTP_CONFIGS[provider];
  const from = (getGoogleGmailHeader(message, "From") ?? "").toLowerCase();
  const subject = (getGoogleGmailHeader(message, "Subject") ?? "").toLowerCase();
  const snippet = (message.snippet ?? "").toLowerCase();
  return config.fromTerms.some((term) => from.includes(term.toLowerCase())) ||
    config.textHints.some((term) => subject.includes(term.toLowerCase())) &&
      config.textHints.some((term) => snippet.includes(term.toLowerCase()));
}

function looksLikeOtpText(provider: ProviderOtpSource, text: string): boolean {
  const config = PROVIDER_OTP_CONFIGS[provider];
  const lower = text.toLowerCase();
  const hasProviderHint = config.textHints.some((term) => lower.includes(term.toLowerCase()));
  const hasOtpHint =
    lower.includes("verification") ||
    lower.includes("one-time") ||
    lower.includes("security code") ||
    lower.includes("otp") ||
    lower.includes("sign in") ||
    lower.includes("login");
  return hasProviderHint && hasOtpHint;
}

function parseInternalDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampWindowMinutes(value: number): number {
  if (!Number.isFinite(value)) return 15;
  return Math.min(60, Math.max(1, Math.round(value)));
}

function escapeGmailQueryTerm(value: string): string {
  return value.replace(/["\\]/g, "");
}
