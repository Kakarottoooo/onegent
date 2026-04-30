import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
});

export const cancelTaskTool: ToolDefinition = {
  name: "cancel_task",
  description:
    "Cancel a booking task. Use when the user explicitly says they want to stop or abandon a " +
    "task they previously started. Idempotent — cancelling an already-terminal task succeeds " +
    "with no side effect. For 'running' tasks the cancellation force-removes the row; the " +
    "underlying browser session is abandoned on the worker's next heartbeat.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The task / job ID to cancel." },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Cancel a travel task",
    readOnlyHint: false,
    openWorldHint: false,
    destructiveHint: true, // permanent removal of the row
    idempotentHint: true,
  },
  async handler(rawArgs, client) {
    const { jobId } = InputSchema.parse(rawArgs);
    const result = await client.cancelTask(jobId);
    return `Task ${jobId} cancelled (was: ${result.priorStatus}).`;
  },
};
