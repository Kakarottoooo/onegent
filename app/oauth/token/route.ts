/**
 * POST /oauth/token — RFC 6749 §3.2 token endpoint.
 *
 * Exchanges an authorization_code (with PKCE verifier) for an opaque
 * access_token + refresh_token, OR rotates a refresh_token for a fresh
 * pair. Per RFC 6749 every error is JSON {error, error_description}
 * with appropriate status, and Cache-Control: no-store is required.
 *
 * Client authentication accepted (per .well-known discovery):
 *   - client_secret_basic: Authorization: Basic base64(client_id:client_secret)
 *   - client_secret_post:  form fields client_id + client_secret
 *
 * PKCE (RFC 7636) is mandatory for grant_type=authorization_code. We
 * accept S256 only — verify by computing base64url(sha256(code_verifier))
 * and comparing it to the code_challenge we stored at /oauth/authorize.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { base64url } from "oslo/encoding";

import {
  consumeAuthorizationCode,
  issueAccessAndRefreshTokens,
  rotateRefreshToken,
  verifyOAuthClient,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TokenError {
  error:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unauthorized_client"
    | "unsupported_grant_type"
    | "invalid_scope";
  error_description?: string;
}

function errorResponse(
  body: TokenError,
  status: number,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...extraHeaders,
    },
  });
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

function parseBasicAuth(header: string | null): ClientCredentials | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  // RFC 6749 §2.3.1: client_id and client_secret in Basic auth are
  // application/x-www-form-urlencoded. Decode after splitting.
  const clientId = decodeURIComponent(decoded.slice(0, idx));
  const clientSecret = decodeURIComponent(decoded.slice(idx + 1));
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function verifyPKCE(verifier: string, storedChallenge: string): boolean {
  const hash = createHash("sha256").update(verifier).digest();
  const computed = base64url.encode(hash, { includePadding: false });
  return computed === storedChallenge;
}

export async function POST(req: NextRequest) {
  // Body must be application/x-www-form-urlencoded per RFC 6749 §3.2
  const form = await req.formData().catch(() => null);
  if (!form) {
    return errorResponse(
      { error: "invalid_request", error_description: "Body must be form-urlencoded." },
      400,
    );
  }

  // ── Resolve client credentials (Basic header takes precedence per RFC)
  const basic = parseBasicAuth(req.headers.get("authorization"));
  const formClientId = form.get("client_id");
  const formClientSecret = form.get("client_secret");

  let creds: ClientCredentials | null = basic;
  if (!creds && typeof formClientId === "string" && typeof formClientSecret === "string") {
    creds = { clientId: formClientId, clientSecret: formClientSecret };
  }

  if (!creds) {
    return errorResponse(
      { error: "invalid_client", error_description: "Client credentials missing." },
      401,
      { "WWW-Authenticate": 'Basic realm="oauth"' },
    );
  }

  const client = await verifyOAuthClient(creds.clientId, creds.clientSecret);
  if (!client) {
    return errorResponse(
      { error: "invalid_client", error_description: "Client authentication failed." },
      401,
      { "WWW-Authenticate": 'Basic realm="oauth"' },
    );
  }

  const grantType = form.get("grant_type");
  if (typeof grantType !== "string" || !grantType) {
    return errorResponse(
      { error: "invalid_request", error_description: "grant_type required." },
      400,
    );
  }

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(form, client.id);
  }

  if (grantType === "refresh_token") {
    return handleRefreshToken(form, client.id);
  }

  return errorResponse(
    {
      error: "unsupported_grant_type",
      error_description: `Only authorization_code and refresh_token are supported (got ${grantType}).`,
    },
    400,
  );
}

async function handleAuthorizationCode(form: FormData, clientId: string): Promise<NextResponse> {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");

  if (typeof code !== "string" || !code) {
    return errorResponse({ error: "invalid_request", error_description: "code required." }, 400);
  }
  if (typeof redirectUri !== "string" || !redirectUri) {
    return errorResponse(
      { error: "invalid_request", error_description: "redirect_uri required." },
      400,
    );
  }
  if (typeof codeVerifier !== "string" || !codeVerifier) {
    return errorResponse(
      { error: "invalid_request", error_description: "code_verifier required (PKCE)." },
      400,
    );
  }
  // RFC 7636: 43–128 chars from [A-Z][a-z][0-9]-._~
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return errorResponse(
      { error: "invalid_request", error_description: "code_verifier must be 43–128 chars." },
      400,
    );
  }

  // Atomically consume — single-use, expires in 10 min
  const row = await consumeAuthorizationCode(code);
  if (!row) {
    return errorResponse(
      {
        error: "invalid_grant",
        error_description: "Authorization code is invalid, expired, or already used.",
      },
      400,
    );
  }

  // Bind code → client (don't let client A redeem client B's code)
  if (row.client_id !== clientId) {
    return errorResponse(
      {
        error: "invalid_grant",
        error_description: "Authorization code was issued to a different client.",
      },
      400,
    );
  }

  // RFC 6749 §4.1.3: redirect_uri at /token must match the one at /authorize
  if (row.redirect_uri !== redirectUri) {
    return errorResponse(
      { error: "invalid_grant", error_description: "redirect_uri does not match the original request." },
      400,
    );
  }

  // PKCE — only S256 stored at /authorize, but assert defensively
  if (row.code_challenge_method !== "S256") {
    return errorResponse(
      { error: "invalid_grant", error_description: "Unsupported code_challenge_method." },
      400,
    );
  }

  if (!verifyPKCE(codeVerifier, row.code_challenge)) {
    return errorResponse(
      { error: "invalid_grant", error_description: "PKCE verifier does not match the challenge." },
      400,
    );
  }

  const { accessToken, refreshToken, expiresIn } = await issueAccessAndRefreshTokens({
    clientId: row.client_id,
    userId: row.user_id,
    scopes: row.scopes,
  });

  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: row.scopes.join(" "),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}

async function handleRefreshToken(form: FormData, clientId: string): Promise<NextResponse> {
  const refreshToken = form.get("refresh_token");
  if (typeof refreshToken !== "string" || !refreshToken) {
    return errorResponse(
      { error: "invalid_request", error_description: "refresh_token required." },
      400,
    );
  }

  const result = await rotateRefreshToken(refreshToken, clientId);
  if (!result) {
    return errorResponse(
      {
        error: "invalid_grant",
        error_description: "Refresh token is invalid, expired, revoked, or belongs to another client.",
      },
      400,
    );
  }

  return NextResponse.json(
    {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}
