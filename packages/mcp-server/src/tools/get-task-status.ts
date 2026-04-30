import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
});

/**
 * Task-protocol alias of get_job_status with a description tailored to v2
 * task-oriented usage (modify → continue → poll). Identical wire-shape; the
 * separate tool exists so the LLM picks it naturally inside multi-turn task
 * conversations.
 */
export const getTaskStatusTool: ToolDefinition = {
  name: "get_task_status",
  description:
    "Check the status of a task created via create_travel_task (or any of the v1 book_* tools). " +
    "Use this to poll progress after creating, modifying, or continuing a task — typically " +
    "every 15-60 seconds until the status becomes terminal. Statuses: queued / running / done / " +
    "paused_payment (user must approve charge) / captcha (CAPTCHA blocked) / needs_login (provider " +
    "login required) / no_availability / error. When status='paused_payment', tell the user to " +
    "complete the payment step in Onegent's app, then call continue_task to finalise.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The task / job ID." },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Get task status",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler(rawArgs, client) {
    const { jobId } = InputSchema.parse(rawArgs);
    const result = await client.getExecutionJob(jobId);

    const lines = [`Task ${jobId} (${result.scenario}): ${result.status}`];
    if (result.provider) lines.push(`Provider: ${result.provider}`);

    switch (result.status) {
      case "pending":
      case "queued":
        lines.push("Waiting to start. Check again in 15-30 seconds.");
        break;
      case "running":
        lines.push("Agent is actively working. Check again in 30 seconds.");
        break;
      case "completed":
      case "done":
        if (result.confirmationCode) {
          lines.push(`Booking confirmed. Confirmation code: ${result.confirmationCode}`);
        } else {
          lines.push("Booking completed successfully.");
        }
        break;
      case "paused_payment":
        lines.push(
          "Reached the payment step. The user must approve the charge in Onegent's app, then call continue_task to finalise.",
        );
        break;
      case "captcha":
        lines.push("CAPTCHA blocked the run. Human assist needed; consider modify_task to a different time or platform.");
        break;
      case "needs_login":
        lines.push("Provider requires login. Tell the user to provide credentials or modify_task to a different platform.");
        break;
      case "no_availability":
        lines.push(
          "No matching availability. Suggest modify_task with a different time / wider time_window_minutes / different restaurant.",
        );
        break;
      case "error":
        if (result.error) {
          lines.push(`Failed: ${result.error.message} (${result.error.code})`);
        } else {
          lines.push("Failed with no diagnosis. Call get_task_audit for details.");
        }
        break;
    }

    lines.push(`Last updated: ${result.updatedAt}`);
    return lines.join("\n");
  },
};
