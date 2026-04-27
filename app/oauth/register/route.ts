/**
 * POST /oauth/register — RFC 7591 Dynamic Client Registration.
 *
 * MCP clients (claude.ai web, ChatGPT Apps marketplace, third-party agent
 * builders) discover us via /.well-known/oauth-authorization-server, see the
 * `registration_endpoint` field, then POST here with their metadata to mint
 * an OAuth client_id + client_secret. They use those credentials in the
 * subsequent /oauth/authorize → /oauth/token dance.
 *
 * Without this endpoint the MCP authorization spec is incomplete — claude.ai
 * cannot pre-register because it doesn't know its own redirect_uri until the
 * connector is added, and we (the resource server) can't pre-mint a client
 * for "every possible MCP consumer in the world".
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc7591
 * MCP authorization: https://modelcontextprotocol.io/specification/draft/basic/authorization
 *
 * Trust model:
 * - DCR is intentionally permissive (per the spec — anonymous registration
 *   is the default). The phishing-mitigation is the consent page: every
 *   user must read the client_name + redirect_uri + scopes before clicking
 *   Approve. Brand-name impersonation (apps calling themselves "Onegent",
 *   "Anthropic", "Apple", etc.) is rejected here as a basic backstop.
 * - Spam mitigation: rate-limited at the Vercel edge per-IP, plus the
 *   client_secret is opaque and useless without a real user signing in.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { createOAuthClient } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Substring match (case-insensitive). If you can think of any legit reason a
// third-party app would have one of these in its client_name, talk to admin
// and we'll mint the client manually via scripts/admin/register-oauth-client.
const BRAND_BLOCKLIST = ["onegent", "anthropic", "openai", "apple", "google", "microsoft"];

// RFC 7591 §2 — only fields we actually consume. Everything else is ignored.
interface DCRRequest {
  redirect_uris?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  scope?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

interface DCRError {
  error:
    | "invalid_redirect_uri"
    | "invalid_client_metadata"
    | "invalid_software_statement";
  error_description?: string;
}

function dcrError(body: DCRError, status: number = 400): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function isBrandImpersonation(name: string): boolean {
  const lower = name.toLowerCase();
  return BRAND_BLOCKLIST.some((brand) => lower.includes(brand));
}

function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: DCRRequest;
  try {
    body = (await req.json()) as DCRRequest;
  } catch {
    return dcrError({
      error: "invalid_client_metadata",
      error_description: "Request body must be valid JSON.",
    });
  }

  // ── redirect_uris is the only field RFC 7591 makes hard-required for
  //    confidential clients using authorization_code (which is us). ────
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return dcrError({
      error: "invalid_redirect_uri",
      error_description: "redirect_uris must be a non-empty array.",
    });
  }
  const redirectUris: string[] = [];
  for (const uri of body.redirect_uris) {
    if (typeof uri !== "string") {
      return dcrError({
        error: "invalid_redirect_uri",
        error_description: "Each redirect_uri must be a string.",
      });
    }
    if (!isValidRedirectUri(uri)) {
      return dcrError({
        error: "invalid_redirect_uri",
        error_description: `redirect_uri must be https:// (or http://localhost): ${uri}`,
      });
    }
    redirectUris.push(uri);
  }

  // ── client_name (optional but encouraged) — phishing backstop here.
  const rawName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  const clientName = rawName || "Unnamed MCP client";
  if (rawName && isBrandImpersonation(rawName)) {
    return dcrError({
      error: "invalid_client_metadata",
      error_description:
        "client_name impersonates a protected brand. Email beta@onegent.one to register manually.",
    });
  }
  if (clientName.length > 200) {
    return dcrError({
      error: "invalid_client_metadata",
      error_description: "client_name must be ≤200 chars.",
    });
  }

  // ── client_uri (optional, surfaced on consent page).
  let clientUri: string | null = null;
  if (typeof body.client_uri === "string" && body.client_uri.length > 0) {
    try {
      const u = new URL(body.client_uri);
      if (u.protocol !== "https:" && u.hostname !== "localhost") {
        return dcrError({
          error: "invalid_client_metadata",
          error_description: "client_uri must be https://",
        });
      }
      clientUri = body.client_uri;
    } catch {
      return dcrError({
        error: "invalid_client_metadata",
        error_description: "client_uri is not a valid URL.",
      });
    }
  }

  // ── scope (optional). RFC 7591 says "space-separated string". We only
  //    expose book + read; intersect with what was requested.
  const requestedScopes =
    typeof body.scope === "string"
      ? body.scope.split(/\s+/).filter(Boolean)
      : ["book", "read"];
  const allowedScopes = ["book", "read"].filter((s) => requestedScopes.includes(s));
  if (allowedScopes.length === 0) {
    return dcrError({
      error: "invalid_client_metadata",
      error_description: "scope must include at least one of: book, read",
    });
  }

  // ── Mint client_id (opaque random) + client_secret (via createOAuthClient).
  const clientId = `dcr_${randomBytes(16).toString("base64url")}`;

  let result;
  try {
    result = await createOAuthClient({
      id: clientId,
      name: clientName,
      redirectUris,
      allowedScopes,
      dynamicallyRegistered: true,
      clientUri,
    });
  } catch (err) {
    console.error("[/oauth/register] DB insert failed:", err);
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Failed to persist client." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── RFC 7591 §3.2.1 success response. Include all metadata fields the
  //    client may need to drive the subsequent OAuth flow.
  return NextResponse.json(
    {
      client_id: result.row.id,
      client_secret: result.clientSecret,
      // 0 means "never expires" — we don't rotate dynamically registered
      // secrets automatically (admins can rotate via SQL if needed).
      client_secret_expires_at: 0,
      client_id_issued_at: Math.floor(new Date(result.row.created_at).getTime() / 1000),
      redirect_uris: result.row.redirect_uris,
      client_name: result.row.name,
      client_uri: result.row.client_uri,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      scope: result.row.allowed_scopes.join(" "),
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
