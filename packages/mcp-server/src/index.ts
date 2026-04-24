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
 * Config (Claude Desktop → claude_desktop_config.json):
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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "onegent";
const SERVER_VERSION = "0.1.0";

// Tool registry — filled in by US-W4-003 ~ 005. Each entry pairs the tool
// metadata (shown to the LLM) with a handler that makes the REST call.
const TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> = [];

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // MCP protocol owns stdout — always log to stderr.
  console.error(`[onegent-mcp] ${SERVER_NAME}@${SERVER_VERSION} ready on stdio`);
}

main().catch((err) => {
  console.error("[onegent-mcp] fatal:", err);
  process.exit(1);
});
