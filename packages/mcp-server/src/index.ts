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
import { z } from "zod";

import { createClient, OnegentApiError, type OnegentClient } from "./api-client.js";
import type { ToolDefinition } from "./tools/types.js";
import { bookRestaurantTool } from "./tools/book-restaurant.js";
import { bookHotelTool } from "./tools/book-hotel.js";
import { bookFlightTool } from "./tools/book-flight.js";
import { bookActivityTool } from "./tools/book-activity.js";
import { getJobStatusTool } from "./tools/get-job-status.js";
import { getJobAuditTool } from "./tools/get-job-audit.js";

const SERVER_NAME = "onegent";
const SERVER_VERSION = "0.1.0";

const TOOLS: ToolDefinition[] = [
  bookRestaurantTool,
  bookHotelTool,
  bookFlightTool,
  bookActivityTool,
  getJobStatusTool,
  getJobAuditTool,
];

// Lazy client init: list_tools should work without an API key so Claude
// Desktop can show what's available before the user wires up auth. The
// key is only required when a tool is actually invoked.
let clientCache: OnegentClient | null = null;
function getClient(): OnegentClient {
  if (!clientCache) clientCache = createClient();
  return clientCache;
}

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      };
    }

    try {
      const client = getClient();
      const text = await tool.handler(request.params.arguments, client);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: formatError(err) }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[onegent-mcp] ${SERVER_NAME}@${SERVER_VERSION} ready on stdio (${TOOLS.length} tools)`);
}

function formatError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const details = err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return `Invalid tool arguments:\n${details}`;
  }
  if (err instanceof OnegentApiError) {
    const codePart = err.code ? ` (${err.code})` : "";
    return `Onegent API error${codePart}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

main().catch((err) => {
  console.error("[onegent-mcp] fatal:", err);
  process.exit(1);
});
