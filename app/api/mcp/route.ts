/**
 * Hosted MCP endpoint — Streamable HTTP transport mounted at /api/mcp.
 *
 * Wraps the same shared server (createOnegentServer) that powers stdio mode
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
 * affinity needed; all our tools are short request/response). This matches
 * Vercel serverless's per-invocation worker model.
 */
import { createOnegentServer } from "@onegent/mcp-server/server-factory";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

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

  // ── Body ────────────────────────────────────────────────────────────────
  const bodyText = await req.text();
  let parsedBody: unknown;
  try {
    parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON-RPC");
  }

  // ── Bridge Next.js Web Request/Response to Node http types the SDK wants ─
  const reqShim = createReqShim(req);
  const { resShim, response } = createResShim();

  // ── Dispatch through MCP Streamable HTTP transport ─────────────────────
  let server: Awaited<ReturnType<typeof createOnegentServer>> | null = null;
  let transport: StreamableHTTPServerTransport | null = null;
  try {
    server = createOnegentServer({ apiKey });
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — each request is independent
    });

    await server.connect(transport);
    await transport.handleRequest(reqShim, resShim, parsedBody);

    return await response;
  } catch (err) {
    console.error("[/api/mcp] handler crashed:", err);
    return jsonError(
      500,
      "internal_error",
      err instanceof Error ? err.message : "Unknown error",
    );
  } finally {
    // Stateless cleanup — close in reverse order
    if (transport) await transport.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

// ── Friendly GET handler ──────────────────────────────────────────────────
// MCP clients always POST to the endpoint. A browser hitting GET /api/mcp
// gets a useful pointer to the docs instead of a confusing 405.
export function GET(): Response {
  return new Response(
    JSON.stringify({
      service: "onegent-mcp",
      protocol: "Model Context Protocol (Streamable HTTP)",
      method: "POST",
      authentication: "Bearer token in Authorization header (ogk_live_... or ogk_test_...)",
      docs: "https://onegent.one/developers/docs/integrations/claude-mcp",
      keys: "https://onegent.one/developers/keys",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a minimal IncomingMessage-shaped object the SDK transport reads.
 * We only need: method, url, headers, and EventEmitter behavior.
 *
 * The transport reads body via `parsedBody` 3rd argument so we don't need
 * to actually emit "data" / "end" — the EventEmitter shape is just for the
 * SDK to attach close/error listeners without crashing.
 */
function createReqShim(req: Request): IncomingMessage {
  const ee = new EventEmitter();
  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers) headers[k.toLowerCase()] = v;

  return Object.assign(ee, {
    method: req.method,
    url: "/api/mcp",
    headers,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    socket: null,
    connection: null,
    // Readable stream surface — SDK may call destroy/pause/resume during
    // cleanup. We've already passed the parsed body, so these are no-ops.
    destroy(): void {
      ee.emit("close");
    },
    pause(): unknown {
      return undefined;
    },
    resume(): unknown {
      return undefined;
    },
    pipe<T>(dest: T): T {
      return dest;
    },
    unpipe(): unknown {
      return undefined;
    },
    read(): null {
      return null;
    },
    readable: false,
    readableEnded: true,
    complete: true,
  }) as unknown as IncomingMessage;
}

/**
 * Build a minimal ServerResponse-shaped object that captures writes into
 * a Buffer + headers + status, and resolves to a Web Response after `end()`.
 */
function createResShim(): {
  resShim: ServerResponse;
  response: Promise<Response>;
} {
  let resolveResponse: (r: Response) => void;
  const response = new Promise<Response>((r) => {
    resolveResponse = r;
  });

  const ee = new EventEmitter();
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let ended = false;

  const finish = (): void => {
    if (ended) return;
    ended = true;
    const body = Buffer.concat(chunks);
    resolveResponse(new Response(body, { status: statusCode, headers }));
    ee.emit("close");
    ee.emit("finish");
  };

  const shim = Object.assign(ee, {
    get statusCode(): number {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    headersSent: false,

    setHeader(k: string, v: string | number | string[]): unknown {
      headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
      return shim;
    },

    getHeader(k: string): string | undefined {
      return headers[k];
    },

    removeHeader(k: string): void {
      delete headers[k];
    },

    writeHead(
      code: number,
      hdrsOrReason?: string | Record<string, string | string[]>,
      hdrs?: Record<string, string | string[]>,
    ): unknown {
      statusCode = code;
      const merged = typeof hdrsOrReason === "object" ? hdrsOrReason : hdrs;
      if (merged) {
        for (const [k, v] of Object.entries(merged)) {
          headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
        }
      }
      return shim;
    },

    write(chunk: string | Buffer): boolean {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      chunks.push(buf);
      return true;
    },

    end(chunk?: string | Buffer): unknown {
      if (chunk) {
        const buf =
          typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        chunks.push(buf);
      }
      finish();
      return shim;
    },

    flushHeaders(): void {
      // no-op — we batch into a single Response
    },

    // Writable stream surface — SDK may call destroy during cleanup.
    destroy(): void {
      finish();
    },

    cork(): void {},
    uncork(): void {},

    writable: true,
    writableEnded: false,
    writableFinished: false,
  }) as unknown as ServerResponse;

  return { resShim: shim, response };
}
