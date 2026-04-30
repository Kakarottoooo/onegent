import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const ConstraintsSchema = z
  .object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24h)").optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
    party_size: z.number().int().min(1).max(20).optional(),
    restaurant_name: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
  })
  .strict();

const PolicySchema = z
  .object({
    time_window_minutes: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)]).optional(),
    allow_venue_switch: z.boolean().optional(),
    allow_platform_switch: z.boolean().optional(),
  })
  .strict();

const InputSchema = z.object({
  jobId: z.string().min(1),
  constraints: ConstraintsSchema.optional(),
  policy: PolicySchema.optional(),
  message: z.string().max(500).optional(),
});

export const modifyTaskTool: ToolDefinition = {
  name: "modify_task",
  description:
    "Mutate the constraints or policy of an in-flight (or paused / failed / pending) booking task " +
    "WITHOUT recreating it. Use when the user asks to change the time / party size / fallback " +
    "tolerance after a booking has started, e.g. \"actually make it 8pm\" or \"add one more person\". " +
    "Increments planVersion and resets all step statuses to pending — call continue_task afterwards " +
    "to re-execute with the new values. Refuses 409 if the task is currently 'running' (wait for " +
    "the current run to finish first) or 'done' (create a new task instead).",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The task / job ID returned by create_travel_task." },
      constraints: {
        type: "object",
        description:
          "Partial constraint patch. Only listed fields overwrite; others preserved. " +
          "Restaurant supports time / date / party_size / restaurant_name / city.",
        properties: {
          time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "24h HH:MM" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" },
          party_size: { type: "integer", minimum: 1, maximum: 20 },
          restaurant_name: { type: "string" },
          city: { type: "string" },
        },
      },
      policy: {
        type: "object",
        description:
          "Partial policy patch. time_window_minutes ∈ {0,30,60,90}; switch flags are booleans.",
        properties: {
          time_window_minutes: { type: "integer", enum: [0, 30, 60, 90] },
          allow_venue_switch: { type: "boolean" },
          allow_platform_switch: { type: "boolean" },
        },
      },
      message: {
        type: "string",
        maxLength: 500,
        description: "Optional human-readable note attached to the audit log entry.",
      },
    },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: {
    title: "Modify a travel task",
    readOnlyHint: false,
    openWorldHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { jobId, constraints, policy, message } = args;

    if (!constraints && !policy) {
      return "modify_task called with no constraint or policy fields — nothing to change. Pass at least one of `constraints` or `policy`.";
    }

    const result = await client.modifyTask(jobId, {
      patch: {
        ...(constraints ? { constraints } : {}),
        ...(policy ? { policy } : {}),
        ...(message ? { message } : {}),
      },
    });

    return [
      `Task ${jobId} updated.`,
      `planVersion: ${result.planVersion}`,
      `status: ${result.status}`,
      `Changes: ${result.summary}`,
      ``,
      `Call continue_task with jobId='${jobId}' to re-execute with the new constraints.`,
    ].join("\n");
  },
};
