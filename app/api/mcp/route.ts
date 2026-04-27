/**
 * Hosted MCP endpoint — Streamable HTTP transport mounted at /api/mcp.
 *
 * Wraps the same shared MCP server (createOnegentServer) that powers stdio mode
 * (`npx @onegent/mcp-server`), but accepts auth via Authorization header
 * instead of ONEGENT_API_KEY env var. This enables Claude.ai web,
 * ChatGPT Apps, and any other remote MCP client to discover + invoke
 * Onegent's 6 booking tools without installing anything locally.
 *
 * Auth — dual track (Sprint 2 #1 D4):
 *   1. Onegent API key      Authorization: Bearer ogk_live_xxxxxxxx...
 *      Resolves to a user via lib/api-auth/require-api-key (same path as
 *      /api/v1/*), so all booking jobs are properly attributed and billed.
 *      Old path; ChatGPT lipa integration uses this until it migrates.
 *
 *   2. OAuth 2.0 access     Authorization: Bearer <opaque-oauth-token>
 *      The token is issued by /oauth/token (RFC 6749 + PKCE). Discriminator:
 *      tokens that DON'T start with "ogk_" go down the OAuth path. We
 *      validate against oauth_access_tokens, scope-check the JSON-RPC body
 *      (book vs read), then bridge through to the API-key path via
 *      findOrCreateOAuthBridgeApiKey (HMAC-derived synthetic ogk_live_ key
 *      tied to the OAuth user_id, source='oauth-bridge' so it stays hidden
 *      from the user's "My Keys" dashboard).
 *
 * Stateless: each request creates a fresh server + transport (no session
 * affinity needed; all our tools are short request/response).
 *
 * Implementation: uses WebStandardStreamableHTTPServerTransport which
 * accepts a Web Request directly — no Node http req/res shim needed
 * (Next.js App Router speaks Web Fetch API natively).
 */
import { createOnegentServer } from "@onegent/mcp-server/server-factory";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { findOrCreateOAuthBridgeApiKey, validateAccessToken } from "@/lib/db";
import { checkScopeForRpc } from "@/lib/oauth/scope-check";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY_PREFIXES = ["ogk_live_", "ogk_test_"];

export async function POST(req: Request): Promise<Response> {
  // ── Auth — extract Bearer token ─────────────────────────────────────────
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    return jsonError(
      401,
      "missing_authorization",
      "Authorization: Bearer <token> header required. Get an API key at https://onegent.one/developers/keys, or run an OAuth flow per https://onegent.one/.well-known/oauth-authorization-server",
      { "WWW-Authenticate": 'Bearer realm="onegent-mcp"' },
    );
  }
  const bearerToken = auth.slice(7).trim();
  if (!bearerToken) {
    return jsonError(401, "empty_token", "Bearer token is empty.", {
      "WWW-Authenticate": 'Bearer realm="onegent-mcp"',
    });
  }

  // ── Parse body once so we can pass parsedBody to the transport AND scope-check it ─
  const bodyText = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON-RPC");
  }

  // ── Resolve to an effective ogk_live_* key (apiKey) ────────────────────
  // Old path: client gave us an ogk_live_* directly → pass through.
  // New path: client gave us an OAuth access_token → validate, scope-check,
  //           swap for the user's synthetic bridge key.
  const isOnegentApiKey = API_KEY_PREFIXES.some((p) => bearerToken.startsWith(p));
  let effectiveApiKey: string;

  if (isOnegentApiKey) {
    effectiveApiKey = bearerToken;
  } else {
    let oauth: { user_id: string; scopes: string[]; client_id: string } | null;
    try {
      oauth = await validateAccessToken(bearerToken);
    } catch (err) {
      console.error("[/api/mcp] validateAccessToken failed:", err);
      return jsonError(503, "auth_backend_unavailable", "Unable to verify token.");
    }
    if (!oauth) {
      return jsonError(
        401,
        "invalid_token",
        "Bearer token is not a valid Onegent API key (ogk_live_/ogk_test_) or active OAuth access token.",
        { "WWW-Authenticate": 'Bearer realm="onegent-mcp", error="invalid_token"' },
      );
    }

    // Scope check — tools/call must have the right scope. tools/list etc. pass.
    const scopeResult = checkScopeForRpc(parsedBody, oauth.scopes);
    if (!scopeResult.ok) {
      return jsonError(
        403,
        "insufficient_scope",
        `Tool "${scopeResult.toolName}" requires "${scopeResult.required}" scope; this token has [${scopeResult.granted.join(", ") || "none"}].`,
        {
          "WWW-Authenticate": `Bearer realm="onegent-mcp", error="insufficient_scope", scope="${scopeResult.required}"`,
        },
      );
    }

    try {
      const bridge = await findOrCreateOAuthBridgeApiKey(oauth.user_id);
      effectiveApiKey = bridge.plaintextKey;
    } catch (err) {
      console.error("[/api/mcp] bridge key derivation failed:", err);
      return jsonError(
        500,
        "bridge_key_failed",
        err instanceof Error ? err.message : "Failed to derive OAuth bridge key.",
      );
    }
  }

  // ── Reconstruct the request with the body intact ────────────────────────
  // We consumed req.body via .text() so the original Request can no longer
  // be passed to the transport. Wrap with a new Request that carries the
  // same headers + a fresh body stream.
  const reqForTransport = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: bodyText,
  });

  // ── Dispatch through MCP Streamable HTTP transport ─────────────────────
  // We do NOT cleanup transport/server in a finally block: the SDK's send()
  // call inside the JSON-response Promise races against any synchronous
  // close, and tearing down the streamMapping mid-flight leaves the
  // Promise hanging (Vercel then sends an empty SSE 200). GC reclaims the
  // per-request transport/server once the Response is consumed.
  try {
    const server = createOnegentServer({ apiKey: effectiveApiKey });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — each request is independent
      enableJsonResponse: true, // JSON request/response, no SSE
    });

    await server.connect(transport);
    return await transport.handleRequest(reqForTransport, { parsedBody });
  } catch (err) {
    console.error("[/api/mcp] handler crashed:", err);
    return jsonError(
      500,
      "internal_error",
      err instanceof Error ? err.message : "Unknown error",
    );
  }
}

// ── Friendly GET handler ──────────────────────────────────────────────────
// MCP clients always POST. A browser hitting GET /api/mcp gets a useful
// pointer to the docs instead of a confusing 405.
export function GET(): Response {
  return new Response(
    JSON.stringify({
      service: "onegent-mcp",
      protocol: "Model Context Protocol (Streamable HTTP)",
      method: "POST",
      authentication: {
        api_key: "Authorization: Bearer ogk_live_... (or ogk_test_...)",
        oauth: "Authorization: Bearer <access_token from /oauth/token>",
        discovery: "https://onegent.one/.well-known/oauth-authorization-server",
      },
      docs: "https://onegent.one/developers/docs/integrations/claude-mcp",
      keys: "https://onegent.one/developers/keys",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
