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
    origin: z.string().min(2).max(40),
    destination: z.string().min(2).max(40),
    depart_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "depart_date must be YYYY-MM-DD"),
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    passengers: z.number().int().min(1).max(9),
    cabin: z.enum(["economy", "premium_economy", "business", "first"]).optional(),
    profile: ProfileSchema.optional(),
    profileId: z.number().int().positive().optional(),
  })
  .refine((v) => v.profile || v.profileId, {
    message: "Either 'profile' (inline) or 'profileId' (saved) must be provided",
  })
  .refine((v) => !v.return_date || v.return_date > v.depart_date, {
    message: "return_date must be after depart_date",
  });

export const bookFlightTool: ToolDefinition = {
  name: "book_flight",
  description:
    "Search and reserve a flight (preview). Use this when the user wants to book airfare. " +
    "Onegent's agent will search Expedia / Google Flights and walk through the airline's checkout. " +
    "Omit return_date for one-way trips. Returns a jobId immediately — actual flight booking " +
    "typically takes 90-240 seconds because airline sites tend to be slow and validate heavily. " +
    "Call get_job_status to check progress. The agent always stops before CVV entry " +
    "(status='paused_payment') so the user confirms the charge. " +
    "Note: flight booking is in preview — confirm all details with the user before calling, " +
    "and be prepared for higher failure rates than restaurant/hotel.",
  inputSchema: {
    type: "object",
    properties: {
      origin: {
        type: "string",
        description: "Departure airport/city. IATA code ('JFK') or city ('New York') both work.",
      },
      destination: {
        type: "string",
        description: "Arrival airport/city. IATA code ('CDG') or city ('Paris') both work.",
      },
      depart_date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Outbound date (YYYY-MM-DD)",
      },
      return_date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Return date (YYYY-MM-DD). Omit for one-way.",
      },
      passengers: {
        type: "integer",
        minimum: 1,
        maximum: 9,
        description: "Total passengers (adults + children combined)",
      },
      cabin: {
        type: "string",
        enum: ["economy", "premium_economy", "business", "first"],
        description: "Cabin class. Defaults to economy.",
      },
      profile: {
        type: "object",
        description: "Inline primary passenger info. Either this or profileId is required.",
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
    required: ["origin", "destination", "depart_date", "passengers"],
    additionalProperties: false,
  },
  async handler(rawArgs, client) {
    const args = InputSchema.parse(rawArgs);
    const { profile, profileId, ...params } = args;

    const job = await client.createExecutionJob({
      request: { scenario: "flight", params },
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile !== undefined ? { profile } : {}),
      clientMetadata: { agentId: "onegent-mcp" },
    });

    const trip = params.return_date
      ? `${params.origin} → ${params.destination} on ${params.depart_date}, returning ${params.return_date}`
      : `${params.origin} → ${params.destination} on ${params.depart_date} (one-way)`;

    return [
      `Flight booking job created.`,
      `${trip} · ${params.passengers} passenger${params.passengers === 1 ? "" : "s"}${
        params.cabin ? ` · ${params.cabin.replace("_", " ")}` : ""
      }.`,
      ``,
      `Job ID: ${job.jobId}`,
      `Status: ${job.status}`,
      ``,
      `The agent is searching flights now — this typically takes 90-240s. ` +
        `Call get_job_status with jobId='${job.jobId}' every 30s to check progress.`,
    ].join("\n");
  },
};
