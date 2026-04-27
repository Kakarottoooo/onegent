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
    destination: z.string().min(1),
    check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "check_in must be YYYY-MM-DD"),
    check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "check_out must be YYYY-MM-DD"),
    guests: z.number().int().min(1).max(10),
    rooms: z.number().int().min(1).max(5).optional(),
    profile: ProfileSchema.optional(),
    profileId: z.number().int().positive().optional(),
  })
  .refine((v) => v.profile || v.profileId, {
    message: "Either 'profile' (inline) or 'profileId' (saved) must be provided",
  })
  .refine((v) => v.check_out > v.check_in, {
    message: "check_out must be after check_in",
  });

export const bookHotelTool: ToolDefinition = {
  name: "book_hotel",
  description:
    "Book a hotel stay. Use this when the user wants to reserve accommodation. " +
    "Onegent's agent will search Booking.com / Expedia / Hotels.com, pick a matching room, " +
    "and fill in the user's details. Returns a jobId immediately — the booking runs " +
    "asynchronously and typically completes in 60-180 seconds depending on the provider. " +
    "Call get_job_status to check progress. The agent stops before submitting credit card " +
    "details (status='paused_payment') so the user can confirm the final charge.",
  inputSchema: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        description: "City, area, or hotel name. e.g. 'Paris', 'Times Square NYC', 'The Pierre'",
      },
      check_in: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Check-in date (YYYY-MM-DD)",
      },
      check_out: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Check-out date (YYYY-MM-DD), must be after check_in",
      },
      guests: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Total number of guests across all rooms",
      },
      rooms: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "Number of rooms. Defaults to 1.",
      },
      profile: {
        type: "object",
        description: "Inline guest contact info. Either this or profileId is required.",
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
        description: "ID of a saved BookingProfile. Mutually exclusive with 'profile'.",
      },
    },
    required: ["destination", "check_in", "check_out", "guests"],
    additionalProperties: false,
  },
  annotations: {
    title: "Book a hotel stay",
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { profile, profileId, ...params } = args;

    const job = await client.createExecutionJob({
      request: { scenario: "hotel", params },
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      clientMetadata: { agentId: "onegent-mcp" },
    });

    return [
      `Hotel booking job created for ${params.destination}`,
      `check-in ${params.check_in}, check-out ${params.check_out} (${params.guests} guest${
        params.guests === 1 ? "" : "s"
      }${params.rooms ? `, ${params.rooms} room${params.rooms === 1 ? "" : "s"}` : ""}).`,
      ``,
      `Job ID: ${job.jobId}`,
      `Status: ${job.status}`,
      ``,
      `The agent is searching for availability now. Call get_job_status with ` +
        `jobId='${job.jobId}' in 30-60 seconds to check progress.`,
    ].join("\n");
  },
};
