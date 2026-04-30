/**
 * Builds a configured MCP Server instance with all v1 + v2 tools wired up.
 * Shared between stdio mode (src/index.ts) and HTTP mode (src/http-server.ts)
 * so the tool surface is identical regardless of transport.
 *
 * v1 (single-action): book_restaurant / book_hotel / book_flight / book_activity
 *                     + get_job_status / get_job_audit. Stable, single-call shape.
 * v2 (task protocol): create_travel_task / modify_task / continue_task /
 *                     cancel_task / get_task_status / get_task_audit. Designed
 *                     for multi-turn conversations where the user adjusts a
 *                     task mid-flight ("change to 8pm", "add a person").
 *
 * Both surfaces are additive — the LLM picks whichever fits the prompt.
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
// v2 task-protocol tools (Phase 3)
import { createTravelTaskTool } from "./tools/create-travel-task.js";
import { modifyTaskTool } from "./tools/modify-task.js";
import { cancelTaskTool } from "./tools/cancel-task.js";
import { continueTaskTool } from "./tools/continue-task.js";
import { getTaskStatusTool } from "./tools/get-task-status.js";
import { getTaskAuditTool } from "./tools/get-task-audit.js";

export const SERVER_NAME = "onegent";
export const SERVER_VERSION = "0.2.0";

export const TOOLS: ToolDefinition[] = [
  // v1 — single-action surface (stable)
  bookRestaurantTool,
  bookHotelTool,
  bookFlightTool,
  bookActivityTool,
  getJobStatusTool,
  getJobAuditTool,
  // v2 — task protocol (Phase 3)
  createTravelTaskTool,
  modifyTaskTool,
  continueTaskTool,
  cancelTaskTool,
  getTaskStatusTool,
  getTaskAuditTool,
];

const SERVER_INSTRUCTIONS =
  "Onegent — AI books your trip end-to-end. Two tool surfaces are available:\n\n" +
  "v1 (single-action, stable): book_restaurant / book_hotel / book_flight / book_activity " +
  "return a jobId immediately; poll get_job_status until terminal (done / error / " +
  "paused_payment / captcha / needs_login); on error call get_job_audit for diagnosis.\n\n" +
  "v2 (task protocol, recommended for multi-turn): create_travel_task starts a task. " +
  "If the user asks to change the time / party size / fallback policy mid-flight, call " +
  "modify_task (NOT a new create_travel_task) — it patches constraints in place and " +
  "increments planVersion. After modify_task, call continue_task to re-execute. Use " +
  "get_task_status to poll, get_task_audit to diagnose, cancel_task to abandon. " +
  "modify_task is REJECTED with 409 while a task is 'running' — wait for the current " +
  "run to finish first, or cancel_task and start over.\n\n" +
  "The agent always stops before submitting credit-card CVV. When status='paused_payment' " +
  "the user must confirm the charge in Onegent's app, then continue_task to finalise.";

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
