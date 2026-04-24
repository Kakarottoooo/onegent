import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const InputSchema = z.object({
  jobId: z.string().min(1),
});

export const getJobStatusTool: ToolDefinition = {
  name: "get_job_status",
  description:
    "Check the status of a booking job. Call this after book_restaurant / book_hotel / " +
    "book_flight / book_activity returned a jobId — typically 15-60 seconds after creation " +
    "and again every 30s until terminal. Returns one of: queued, running, done, error, " +
    "paused_payment (user must approve charge), captcha (human CAPTCHA needed), " +
    "needs_login (provider credentials required). When status='done' the response includes " +
    "confirmationCode — relay it to the user. On error, a short diagnosis is included.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: {
        type: "string",
        description: "The job ID returned by book_* tools",
      },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  async handler(rawArgs, client) {
    const { jobId } = InputSchema.parse(rawArgs);
    const result = await client.getExecutionJob(jobId);

    const lines = [`Job ${jobId} (${result.scenario}): ${result.status}`];
    if (result.provider) lines.push(`Provider: ${result.provider}`);

    switch (result.status) {
      case "queued":
        lines.push("Waiting to start. Check again in 15-30 seconds.");
        break;
      case "running":
        lines.push("Agent is actively booking. Check again in 30 seconds.");
        break;
      case "done":
        if (result.confirmationCode) {
          lines.push(`Booking confirmed. Confirmation code: ${result.confirmationCode}`);
        } else {
          lines.push("Booking completed successfully.");
        }
        break;
      case "paused_payment":
        lines.push(
          "The agent reached the payment step and stopped for user authorization. " +
            "The user must approve the charge before the booking finalizes.",
        );
        break;
      case "captcha":
        lines.push("Hit a CAPTCHA challenge the agent cannot solve. Human assist needed.");
        break;
      case "needs_login":
        lines.push("Provider requires login credentials. User action required.");
        break;
      case "error":
        if (result.error) {
          lines.push(`Failed: ${result.error.message} (${result.error.code})`);
        } else {
          lines.push("Failed with no additional diagnosis. Call get_job_audit for details.");
        }
        break;
    }

    lines.push(`Last updated: ${result.updatedAt}`);
    return lines.join("\n");
  },
};
