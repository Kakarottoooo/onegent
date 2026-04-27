/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * MCP-compliant clients (claude.ai web, ChatGPT Apps marketplace, etc.)
 * fetch this URL after seeing a `WWW-Authenticate: Bearer ... resource_metadata="..."`
 * header on a 401 from /api/mcp. The metadata tells them which authorization
 * server to use for OAuth (the `authorization_servers` array), which scopes
 * are valid, and how to present the bearer token (header).
 *
 * Without this endpoint claude.ai cannot complete the OAuth dance — it sees
 * a generic 401 with no discovery hint and gives up with "Couldn't reach the
 * MCP server". Combined with the `WWW-Authenticate` resource_metadata
 * parameter on /api/mcp's 401, this closes the discovery loop.
 *
 * Spec: https://datatracker.ietf.org/doc/html/rfc9728
 * MCP authorization spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

export const dynamic = "force-static";
export const runtime = "nodejs";

const ISSUER = "https://onegent.one";
const RESOURCE_URL = `${ISSUER}/api/mcp`;

export function GET(): Response {
  return new Response(
    JSON.stringify({
      // The canonical URL of the protected resource. Clients hash this to
      // detect token mismatches across multiple resources sharing one
      // authorization server.
      resource: RESOURCE_URL,

      // Which authorization server(s) issue valid tokens for this resource.
      // We are our own AS; clients then GET ${this[0]}/.well-known/
      // oauth-authorization-server for endpoint metadata (RFC 8414).
      authorization_servers: [ISSUER],

      // Bearer token presentation methods accepted by /api/mcp. We only
      // accept the Authorization request header (not query string or
      // POST body) — query strings leak in logs and bodies don't survive
      // streamable HTTP framing in some intermediaries.
      bearer_methods_supported: ["header"],

      // Scopes a client may request. Mirrors what /.well-known/
      // oauth-authorization-server advertises and what /oauth/authorize
      // will let users grant.
      scopes_supported: ["book", "read"],

      // Documentation pointer for humans debugging the integration.
      resource_documentation: `${ISSUER}/developers/docs/integrations/claude-mcp`,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        // CORS open: claude.ai browser fetches this from a different origin.
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
