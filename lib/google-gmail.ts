import type { GmailConnectionRow } from "@/lib/gmail-db";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export const GOOGLE_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

export interface GoogleGmailTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string | null;
  scope: string | null;
}

export interface GoogleGmailProfile {
  emailAddress: string | null;
  messagesTotal: number | null;
  threadsTotal: number | null;
  historyId: string | null;
}

export interface GoogleGmailMessageListItem {
  id: string;
  threadId?: string;
}

export interface GoogleGmailHeader {
  name?: string;
  value?: string;
}

export interface GoogleGmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: GoogleGmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GoogleGmailPayloadPart[];
}

export interface GoogleGmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GoogleGmailPayloadPart;
}

function getGoogleGmailClientId(): string {
  const value =
    process.env.GOOGLE_GMAIL_CLIENT_ID ?? process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!value) {
    throw new Error(
      "GOOGLE_GMAIL_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_ID is not configured.",
    );
  }
  return value;
}

function getGoogleGmailClientSecret(): string {
  const value =
    process.env.GOOGLE_GMAIL_CLIENT_SECRET ??
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!value) {
    throw new Error(
      "GOOGLE_GMAIL_CLIENT_SECRET or GOOGLE_CALENDAR_CLIENT_SECRET is not configured.",
    );
  }
  return value;
}

export function buildGoogleGmailAuthUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set("client_id", getGoogleGmailClientId());
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeGoogleGmailCode(params: {
  code: string;
  redirectUri: string;
}): Promise<GoogleGmailTokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: getGoogleGmailClientId(),
    client_secret: getGoogleGmailClientSecret(),
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseTokenResponse(res, "Google Gmail token exchange failed.");
}

export async function refreshGoogleGmailAccessToken(
  refreshToken: string,
): Promise<Omit<GoogleGmailTokenResponse, "refreshToken">> {
  const body = new URLSearchParams({
    client_id: getGoogleGmailClientId(),
    client_secret: getGoogleGmailClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await parseTokenResponse(res, "Google Gmail token refresh failed.");
  return {
    accessToken: token.accessToken,
    expiresIn: token.expiresIn,
    tokenType: token.tokenType,
    scope: token.scope,
  };
}

export async function fetchGoogleGmailProfile(
  accessToken: string,
): Promise<GoogleGmailProfile> {
  const res = await fetch(`${GOOGLE_GMAIL_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(extractGoogleError(data, "Failed to fetch Gmail profile."));
  }
  return {
    emailAddress: typeof data.emailAddress === "string" ? data.emailAddress : null,
    messagesTotal: typeof data.messagesTotal === "number" ? data.messagesTotal : null,
    threadsTotal: typeof data.threadsTotal === "number" ? data.threadsTotal : null,
    historyId: typeof data.historyId === "string" ? data.historyId : null,
  };
}

export async function searchGoogleGmailMessages(params: {
  accessToken: string;
  query: string;
  maxResults?: number;
}): Promise<GoogleGmailMessageListItem[]> {
  const url = new URL(`${GOOGLE_GMAIL_BASE}/users/me/messages`);
  url.searchParams.set("q", params.query);
  url.searchParams.set("maxResults", String(params.maxResults ?? 5));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(extractGoogleError(data, "Failed to search Gmail messages."));
  }
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return messages
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: item.id as string,
      threadId: typeof item.threadId === "string" ? item.threadId : undefined,
    }));
}

export async function fetchGoogleGmailMessage(params: {
  accessToken: string;
  id: string;
}): Promise<GoogleGmailMessage> {
  const url = new URL(
    `${GOOGLE_GMAIL_BASE}/users/me/messages/${encodeURIComponent(params.id)}`,
  );
  url.searchParams.set("format", "full");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as GoogleGmailMessage &
    Record<string, unknown>;
  if (!res.ok || typeof data.id !== "string") {
    throw new Error(extractGoogleError(data, "Failed to fetch Gmail message."));
  }
  return data;
}

export async function revokeGoogleGmailToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {});
}

export function isGoogleGmailTokenFresh(connection: GmailConnectionRow): boolean {
  if (!connection.access_token_expires_at) return false;
  const expiresAt = Date.parse(connection.access_token_expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - Date.now() > 60_000;
}

export function getGoogleGmailHeader(
  message: GoogleGmailMessage,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  const headers = message.payload?.headers ?? [];
  const header = headers.find(
    (entry) => typeof entry.name === "string" && entry.name.toLowerCase() === wanted,
  );
  return typeof header?.value === "string" ? header.value : null;
}

export function extractTextFromGoogleGmailMessage(
  message: GoogleGmailMessage,
): string {
  const parts = [message.snippet ?? "", extractPayloadText(message.payload)]
    .filter(Boolean)
    .join("\n");
  return stripHtml(parts);
}

export function decodeGmailBodyData(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64").toString("utf8");
}

async function parseTokenResponse(
  res: Response,
  fallbackMessage: string,
): Promise<GoogleGmailTokenResponse> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(extractGoogleError(data, fallbackMessage));
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
    tokenType: typeof data.token_type === "string" ? data.token_type : null,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

function extractPayloadText(part?: GoogleGmailPayloadPart): string {
  if (!part) return "";
  const chunks: string[] = [];
  if (part.body?.data && isTextMimeType(part.mimeType)) {
    chunks.push(decodeGmailBodyData(part.body.data));
  }
  for (const child of part.parts ?? []) {
    const text = extractPayloadText(child);
    if (text) chunks.push(text);
  }
  return chunks.join("\n");
}

function isTextMimeType(mimeType: string | undefined): boolean {
  return !mimeType || mimeType === "text/plain" || mimeType === "text/html";
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGoogleError(data: Record<string, unknown>, fallback: string): string {
  if (typeof data.error_description === "string") return data.error_description;
  const error = data.error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as Record<string, unknown>).message);
  }
  if (typeof error === "string") return error;
  return fallback;
}
