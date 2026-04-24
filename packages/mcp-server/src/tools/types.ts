import type { OnegentClient } from "../api-client.js";

/**
 * Shape every MCP tool in this server exports. The server's request
 * handlers iterate over a TOOLS array of these to build the
 * list_tools response and route call_tool invocations.
 *
 * Handlers return plain strings; the dispatcher in index.ts wraps
 * them into MCP's { content: [{ type: "text", text }] } envelope.
 * Errors thrown by the handler (including OnegentApiError) surface
 * to the LLM as tool errors — don't swallow them.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler(args: unknown, client: OnegentClient): Promise<string>;
}
