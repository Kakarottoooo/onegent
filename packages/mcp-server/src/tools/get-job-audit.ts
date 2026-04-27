import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
});

const DEFAULT_LIMIT = 50;

export const getJobAuditTool: ToolDefinition = {
  name: "get_job_audit",
  description:
    "Fetch the audit trail for a booking job — a chronological list of what the agent " +
    "observed and decided. Use this when a job ends in 'error' to diagnose what went wrong, " +
    "or to explain what the agent did after a successful booking. Returns up to 50 events " +
    "by default, newest first; pass 'limit' to change (max 500).",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The job ID to fetch audit events for" },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "Max number of events to return. Defaults to 50.",
      },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Read booking job audit trail",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler(rawArgs, client) {
    const { jobId, limit } = InputSchema.parse(rawArgs);
    const result = await client.getExecutionJobAudit(jobId, limit ?? DEFAULT_LIMIT);

    if (result.events.length === 0) {
      return `No audit events recorded yet for job ${jobId}.`;
    }

    const lines = [`Audit trail for job ${jobId} (${result.events.length} events):`, ""];
    for (const ev of result.events) {
      const marker = ev.level === "error" ? "[ERR]" : ev.level === "warn" ? "[WARN]" : "[INFO]";
      lines.push(`${ev.ts} ${marker} ${ev.message}`);
      if (ev.data && typeof ev.data === "object") {
        const preview = JSON.stringify(ev.data).slice(0, 200);
        lines.push(`  data: ${preview}${preview.length === 200 ? "…" : ""}`);
      }
    }

    return lines.join("\n");
  },
};
