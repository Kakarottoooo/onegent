import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const ProfileSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.email(),
  phone: z.string().min(1),
});

const InputSchema = z
  .object({
    city: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    activity_name: z.string().min(1).optional(),
    participants: z.number().int().min(1).max(20),
    profile: ProfileSchema.optional(),
    profileId: z.number().int().positive().optional(),
  })
  .refine((v) => v.profile || v.profileId, {
    message: "Either 'profile' (inline) or 'profileId' (saved) must be provided",
  });

export const bookActivityTool: ToolDefinition = {
  name: "book_activity",
  description:
    "Book an activity, tour, or attraction ticket (preview). Use this for museum tickets, " +
    "guided tours, experiences, day passes, etc. Onegent's agent will search Viator / " +
    "GetYourGuide / the venue's direct site. If activity_name is provided, the agent " +
    "targets that specific activity; otherwise it picks a well-reviewed option matching " +
    "the city + date. Returns a jobId immediately; typical completion 60-180s. " +
    "Call get_job_status to track. Note: activity booking is in preview and success rates " +
    "vary by destination — confirm with the user before calling for non-standard requests.",
  inputSchema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City where the activity takes place, e.g. 'Paris', 'Tokyo'",
      },
      date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Activity date (YYYY-MM-DD)",
      },
      activity_name: {
        type: "string",
        description:
          "Specific activity to target, e.g. 'Eiffel Tower Summit Tickets', 'Louvre Skip-the-Line'. " +
          "Omit to let the agent pick.",
      },
      participants: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Number of people attending",
      },
      profile: {
        type: "object",
        description: "Inline lead booker info. Either this or profileId is required.",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string", description: "E.164 preferred" },
        },
        required: ["first_name", "last_name", "email", "phone"],
      },
      profileId: {
        type: "integer",
        description: "ID of a saved BookingProfile.",
      },
    },
    required: ["city", "date", "participants"],
    additionalProperties: false,
  },
  annotations: {
    title: "Book an activity or tour",
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { profile, profileId, ...params } = args;

    const job = await client.createExecutionJob({
      request: { scenario: "activity", params },
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      clientMetadata: { agentId: "onegent-mcp" },
    });

    const label = params.activity_name ? `'${params.activity_name}' in ${params.city}` : `an activity in ${params.city}`;

    return [
      `Activity booking job created for ${label} on ${params.date}`,
      `(${params.participants} participant${params.participants === 1 ? "" : "s"}).`,
      ``,
      `Job ID: ${job.jobId}`,
      `Status: ${job.status}`,
      ``,
      `The agent is searching availability now. Call get_job_status with ` +
        `jobId='${job.jobId}' in 30-60 seconds.`,
    ].join("\n");
  },
};
