/**
 * Hosted MCP endpoint — Streamable HTTP transport mounted at /api/mcp.
 *
 * Wraps the same shared MCP server (createOnegentServer) that powers stdio mode
 * (`npx @onegent/mcp-server`), but accepts the API key via Authorization
 * header instead of ONEGENT_API_KEY env var. This enables Claude.ai web,
 * ChatGPT Apps, and any other remote MCP client to discover + invoke
 * Onegent's 6 booking tools without installing anything locally.
 *
 * Auth (this route, #22): Bearer token in Authorization header.
 *   Authorization: Bearer ogk_live_xxxxxxxx...
 * The key resolves to a user via lib/api-auth/require-api-key (same path as
 * /api/v1/*), so all booking jobs are properly attributed and billed.
 *
 * Auth (planned, #23): OAuth 2.0 — Claude.ai / ChatGPT will run an OAuth
 * dance against Onegent so end users don't need to copy/paste API keys.
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

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KEY_PREFIXES = ["ogk_live_", "ogk_test_"];

export async function POST(req: Request): Promise<Response> {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    return jsonError(
      401,
      "missing_authorization",
      "Authorization: Bearer <ogk_live_...> header required. Get a key at https://onegent.one/developers/keys",
    );
  }
  const apiKey = auth.slice(7).trim();
  if (!VALID_KEY_PREFIXES.some((p) => apiKey.startsWith(p))) {
    return jsonError(
      401,
      "invalid_api_key_format",
      "API key must start with ogk_live_ or ogk_test_",
    );
  }

  // ── Parse body once so we can pass parsedBody to the transport ─────────
  // (the transport accepts a Request whose body has already been consumed,
  // as long as we hand it the parsed form via options.parsedBody)
  const bodyText = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON-RPC");
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
  // build_marker so we can verify Vercel actually deployed this version
  console.log(`[/api/mcp] BUILD=v3-jsonresponse method=${(parsedBody as { method?: string })?.method ?? "?"}`);

  try {
    const server = createOnegentServer({ apiKey });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — each request is independent
      enableJsonResponse: true, // JSON request/response, no SSE
    });

    console.log(`[/api/mcp] transport options: enableJsonResponse=true, sessionIdGenerator=undefined`);

    await server.connect(transport);
    const response = await transport.handleRequest(reqForTransport, { parsedBody });

    console.log(`[/api/mcp] response: status=${response.status} content-type=${response.headers.get("content-type")}`);

    // Note: NOT cleaning up transport/server here. For SSE mode, the response
    // body is a ReadableStream that Vercel needs to consume after we return.
    // For JSON mode, the response is fully buffered so cleanup *would* be
    // safe — but we have no way to discriminate, so play it safe and let GC
    // reclaim once the response is sent.
    return response;
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
      authentication:
        "Bearer token in Authorization header (ogk_live_... or ogk_test_...)",
      docs: "https://onegent.one/developers/docs/integrations/claude-mcp",
      keys: "https://onegent.one/developers/keys",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
