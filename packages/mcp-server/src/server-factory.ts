/**
 * Builds a configured MCP Server instance with all 6 tools wired up.
 * Shared between stdio mode (src/index.ts) and HTTP mode (src/http-server.ts)
 * so the tool surface is identical regardless of transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { createClient, configFromApiKey, loadConfig, OnegentApiError, type OnegentClient } from "./api-client.js";
import type { ToolDefinition } from "./tools/types.js";
import { bookRestaurantTool } from "./tools/book-restaurant.js";
import { bookHotelTool } from "./tools/book-hotel.js";
import { bookFlightTool } from "./tools/book-flight.js";
import { bookActivityTool } from "./tools/book-activity.js";
import { getJobStatusTool } from "./tools/get-job-status.js";
import { getJobAuditTool } from "./tools/get-job-audit.js";

export const SERVER_NAME = "onegent";
export const SERVER_VERSION = "0.1.0";

export const TOOLS: ToolDefinition[] = [
  bookRestaurantTool,
  bookHotelTool,
  bookFlightTool,
  bookActivityTool,
  getJobStatusTool,
  getJobAuditTool,
];

const SERVER_INSTRUCTIONS =
  "Onegent — AI books your trip end-to-end. Use book_restaurant, book_hotel, " +
  "book_flight, or book_activity to start a booking; each returns a jobId. " +
  "Then call get_job_status every 15-60 seconds until the status is terminal " +
  "(done, error, paused_payment, captcha, needs_login). If a booking errors, " +
  "call get_job_audit for diagnostic context. The agent always stops before " +
  "submitting credit card CVV — when status='paused_payment' the user must " +
  "confirm the charge in Onegent's app before the booking finalizes.";

export interface CreateOnegentServerOptions {
  /**
   * Per-request API key, used by the hosted HTTP transport (Next.js
   * /api/mcp route extracts from Authorization header). When omitted,
   * falls back to ONEGENT_API_KEY env var (stdio mode default).
   */
  apiKey?: string;
}

export function createOnegentServer(opts: CreateOnegentServerOptions = {}): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: "Travel Booking Agent",
    },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  let clientCache: OnegentClient | null = null;
  const getClient = (): OnegentClient => {
    if (!clientCache) {
      const cfg = opts.apiKey ? configFromApiKey(opts.apiKey) : loadConfig();
      clientCache = createClient(cfg);
    }
    return clientCache;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
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

  return server;
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
