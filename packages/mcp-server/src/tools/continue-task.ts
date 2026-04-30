import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
});

export const continueTaskTool: ToolDefinition = {
  name: "continue_task",
  description:
    "Resume a paused / failed / pending booking task. Equivalent to a user clicking 'Run again'. " +
    "Common use cases: (1) right after modify_task to re-execute with the new constraints, " +
    "(2) after the user finishes a paused_payment step out-of-band, (3) retrying a transient " +
    "error. Returns 409 if the task is already 'running' (would be a duplicate trigger). " +
    "The actual run is asynchronous — call get_task_status afterwards to track progress.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The task / job ID to resume." },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Continue / resume a travel task",
    readOnlyHint: false,
    openWorldHint: true, // fires off browser automation against third-party sites
    destructiveHint: false,
    idempotentHint: false,
  },
  async handler(rawArgs, client) {
    const { jobId } = InputSchema.parse(rawArgs);
    const result = await client.continueTask(jobId);
    return [
      `Task ${jobId} resumed (was: ${result.priorStatus}).`,
      `Execution is running asynchronously — call get_task_status with jobId='${jobId}' in 15-30 seconds to check progress.`,
    ].join("\n");
  },
};
