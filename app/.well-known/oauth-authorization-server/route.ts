/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Discovery endpoint that lets MCP clients (ChatGPT Apps, Claude.ai web)
 * auto-configure their OAuth integration with Onegent. They GET this URL,
 * read the JSON, and use the discovered URLs for the OAuth flow.
 *
 * Spec reference:
 *   - RFC 8414 (OAuth 2.0 Authorization Server Metadata)
 *   - RFC 7636 (PKCE — we require S256)
 *   - RFC 6749 (OAuth 2.0 core)
 */

export const dynamic = "force-static";
export const runtime = "nodejs";

const ISSUER = "https://onegent.one";

export function GET(): Response {
  return new Response(
    JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`,

      // Scopes: coarse-grained per Sprint 2 #1 architecture decision
      scopes_supported: ["book", "read"],

      // Auth code flow with PKCE; refresh tokens supported
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],

      // PKCE required (we accept S256 only — no plain)
      code_challenge_methods_supported: ["S256"],

      // Client auth at /oauth/token: HTTP Basic (header) OR form body
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],

      // Tokens are opaque (sha256 stored, not JWTs) — declare for clarity
      // even though it's not a registered RFC 8414 field; some clients
      // expect it.
      response_modes_supported: ["query"],

      // No userinfo endpoint — MCP clients call /api/mcp directly
      // No registration endpoint — clients are pre-registered via dashboard

      service_documentation:
        "https://onegent.one/developers/docs/integrations/claude-mcp",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
