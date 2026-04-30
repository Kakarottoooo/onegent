import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
});

/**
 * Task-protocol alias of get_job_audit. Identical wire-shape; the separate
 * tool exists so the LLM picks it naturally inside multi-turn task
 * conversations and so users see "audit" not "job audit" in tool listings.
 */
export const getTaskAuditTool: ToolDefinition = {
  name: "get_task_audit",
  description:
    "Fetch the audit log for a task — every retry, fallback decision, time adjustment, venue " +
    "switch, modification (task_modified), and terminal status the agent recorded. Call this " +
    "when get_task_status returned an error or unexpected outcome and you need to diagnose " +
    "what happened. The log is append-only; entries from earlier runs are preserved across " +
    "modify_task / continue_task cycles.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The task / job ID." },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "Cap how many recent events to return (default: server picks).",
      },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Get task audit log",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler(rawArgs, client) {
    const { jobId, limit } = InputSchema.parse(rawArgs);
    const result = await client.getExecutionJobAudit(jobId, limit);
    if (result.events.length === 0) {
      return `Task ${jobId}: no audit events recorded yet.`;
    }
    const lines = [`Task ${jobId} — ${result.events.length} audit event(s):`];
    for (const ev of result.events) {
      lines.push(`  [${ev.ts}] ${ev.level.toUpperCase()}: ${ev.message}`);
    }
    return lines.join("\n");
  },
};
