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
/**
 * MCP tool annotations (per the MCP spec). Surfaced via tools/list so
 * marketplace reviewers (ChatGPT Apps, Claude.ai) and host apps can show
 * users what kind of action a tool actually performs before it's invoked.
 *
 * - title: human-readable name (preferred over `name` for UI display)
 * - readOnlyHint: true ⇢ tool reads but doesn't modify state
 * - destructiveHint: true ⇢ tool may perform destructive / irreversible
 *   updates (only meaningful when readOnlyHint=false). For Onegent's
 *   booking tools we set this to false: the tool enqueues an async job
 *   that always pauses before the irreversible CVV submission, so the
 *   tool invocation itself has no destructive side effect.
 * - idempotentHint: true ⇢ calling the tool N times has the same effect
 *   as calling once. Read tools are idempotent; booking tools are not
 *   (each call enqueues a separate job).
 * - openWorldHint: true ⇢ tool interacts with an open external world
 *   (third-party booking sites, OTAs, etc). Read-from-our-DB tools are
 *   closed-world.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: ToolAnnotations;
  handler(args: unknown, client: OnegentClient): Promise<string>;
}
