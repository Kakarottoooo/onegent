#!/usr/bin/env node
/**
 * @onegent/mcp-server · Model Context Protocol server for Onegent
 *
 * Onegent — AI books your trip end-to-end.
 *
 * Exposes Onegent's trip-booking execution engine as MCP tools that Claude
 * Desktop / ChatGPT Apps can call. Each tool wraps a REST call to the
 * Onegent /api/v1/* surface; this package does not contain any booking
 * logic itself — it is a thin stdio ↔ HTTP adapter.
 *
 * Usage:
 *   onegent-mcp-server              # stdio mode (Claude Desktop, default)
 *   onegent-mcp-server --http       # Streamable HTTP mode (ChatGPT Apps)
 *   onegent-mcp-server --http --port 8080
 *
 * Claude Desktop config (stdio):
 *   {
 *     "mcpServers": {
 *       "onegent": {
 *         "command": "npx",
 *         "args": ["-y", "@onegent/mcp-server"],
 *         "env": { "ONEGENT_API_KEY": "ogk_live_..." }
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOnegentServer, SERVER_NAME, SERVER_VERSION, TOOLS } from "./server-factory.js";
import { startHttpServer } from "./http-server.js";

interface CliArgs {
  mode: "stdio" | "http";
  port: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: "stdio", port: 3333 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--http") args.mode = "http";
    else if (a === "--port") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--port expects a positive number, got: ${argv[i]}`);
      }
      args.port = n;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  console.error(
    [
      `${SERVER_NAME}-mcp-server v${SERVER_VERSION} — Travel Booking Agent`,
      ``,
      `Usage:`,
      `  onegent-mcp-server                     stdio mode (Claude Desktop, default)`,
      `  onegent-mcp-server --http [--port N]   Streamable HTTP mode (ChatGPT Apps, self-host)`,
      ``,
      `Env:`,
      `  ONEGENT_API_KEY        required (ogk_live_... or ogk_test_...)`,
      `  ONEGENT_API_BASE_URL   optional, defaults to https://onegent.com/api/v1`,
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "http") {
    await startHttpServer({ port: args.port, createServer: createOnegentServer });
    return; // http server keeps itself alive
  }

  const server = createOnegentServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[onegent-mcp] ${SERVER_NAME}@${SERVER_VERSION} ready on stdio (${TOOLS.length} tools)`);
}

main().catch((err) => {
  console.error("[onegent-mcp] fatal:", err);
  process.exit(1);
});
