/**
 * Streamable HTTP transport mode — required by ChatGPT Apps and useful
 * for remote MCP clients that don't spawn processes locally.
 *
 * Stateless mode (sessionIdGenerator=undefined) suits serverless hosts
 * like Vercel / Cloud Run where each invocation is a fresh worker.
 * All our tools are short request-response (book_* returns a jobId
 * immediately; get_* is a single REST round-trip), so we don't need
 * session affinity.
 *
 * Usage:
 *   node dist/index.js --http --port 3333
 *   # or as library:
 *   import { startHttpServer } from "@onegent/mcp-server/http-server";
 *   await startHttpServer({ port: 3333 });
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface HttpServerOptions {
  /** Port to listen on. Defaults to 3333. */
  port?: number;
  /** Factory that returns a fresh Server instance for each request. */
  createServer: () => Server;
}

/**
 * Start a Streamable HTTP MCP server. Resolves once the listener is
 * bound and ready to accept connections.
 */
export async function startHttpServer(opts: HttpServerOptions): Promise<{ close(): Promise<void> }> {
  const port = opts.port ?? 3333;

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Stateless: fresh Server + Transport per request. Costs a bit of
    // CPU but trivial given our request volume, and avoids leaking
    // state across users on shared hosts.
    try {
      const server = opts.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[onegent-mcp/http] handler crashed:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_server_error" }));
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.error(`[onegent-mcp] HTTP transport listening on :${port}`);

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
