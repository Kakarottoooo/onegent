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
    restaurant_name: z.string().min(1),
    city: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM (24h)"),
    covers: z.number().int().min(1).max(20),
    profile: ProfileSchema.optional(),
    profileId: z.number().int().positive().optional(),
  })
  .refine((v) => v.profile || v.profileId, {
    message: "Either 'profile' (inline) or 'profileId' (saved) must be provided",
  });

export const bookRestaurantTool: ToolDefinition = {
  name: "book_restaurant",
  description:
    "Reserve a table at a restaurant. Use this when the user wants to book a dining reservation. " +
    "Onegent's agent will navigate OpenTable / Resy / the restaurant's direct site and fill in " +
    "the user's details. Returns a jobId immediately — the actual booking runs asynchronously and " +
    "typically completes in 30-120 seconds. Call get_job_status with the jobId to check progress. " +
    "If the venue requires payment authorization, the job will pause at status='paused_payment' " +
    "and the user must confirm before the final booking is submitted.",
  inputSchema: {
    type: "object",
    properties: {
      restaurant_name: { type: "string", description: "e.g. 'Carbone', 'Le Bernardin'" },
      city: { type: "string", description: "City name, e.g. 'New York', 'San Francisco'" },
      date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Reservation date (YYYY-MM-DD)",
      },
      time: {
        type: "string",
        pattern: "^\\d{2}:\\d{2}$",
        description: "Reservation time in 24h format (HH:MM)",
      },
      covers: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Number of diners",
      },
      profile: {
        type: "object",
        description:
          "Inline diner contact info. Either this or profileId is required. " +
          "Name + email + phone are all mandatory; venues that don't need phone still need the field.",
        properties: {
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string", description: "E.164 preferred, e.g. +14155550123" },
        },
        required: ["first_name", "last_name", "email", "phone"],
      },
      profileId: {
        type: "integer",
        description: "ID of a saved BookingProfile. Mutually exclusive with 'profile' (inline).",
      },
    },
    required: ["restaurant_name", "city", "date", "time", "covers"],
    additionalProperties: false,
  },
  annotations: {
    title: "Book a restaurant reservation",
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { profile, profileId, ...params } = args;

    const job = await client.createExecutionJob({
      request: { scenario: "restaurant", params },
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      clientMetadata: { agentId: "onegent-mcp" },
    });

    return [
      `Restaurant booking job created for ${params.restaurant_name} in ${params.city}`,
      `on ${params.date} at ${params.time} (party of ${params.covers}).`,
      ``,
      `Job ID: ${job.jobId}`,
      `Status: ${job.status}`,
      ``,
      `The agent is navigating to the venue's reservation platform now. ` +
        `Call get_job_status with jobId='${job.jobId}' in 15-30 seconds to check progress.`,
    ].join("\n");
  },
};
